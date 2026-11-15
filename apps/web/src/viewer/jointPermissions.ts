import { allNodeKeys, type GameModel } from "../game/model";
import { CONNECTION_PROFILES, conflictingJointAxes, connectionDefinition, connectionLabel, type ConnectionProfile } from "../game/jointFreedom";
import type { TurnState } from "../game/turns";

export type JointDisplay = "selected" | "all" | "off";
export type JointState = "locked" | "free" | "elastic" | "coupled" | "unavailable" | "conflict" | "inactive";
export type JointComponents = readonly [JointState, JointState, JointState, JointState, JointState, JointState];
type Connection = TurnState["board"]["connections"][number];
export interface JointPermission {
  id: string;
  point: string;
  profile: string;
  components: JointComponents;
  frame?: ReturnType<typeof connectionDefinition>["axes"];
  global?: JointComponents;
  ground?: JointComponents;
  attachments: string[];
  parent?: string;
}

/** The shared-table scene picker reports a point in the display mesh. Only
 * resolve it when every end there belongs to the same committed identity.
 * The inspector's explicit joint-id selector is available for every overlap. */
export function jointAtSceneSelection(joints: JointPermission[], key: string, turn?: TurnState | null) {
  if (!turn || !key.includes(",")) return joints.find(j => j.id === key);
  const at = joints.filter(j => j.point === key);
  if (at.length !== 1) return undefined;
  const ends = [...turn.board.connections, ...turn.draft.connections];
  const attached = new Set(ends.filter(end => end.jointId === at[0].id).map(end => `${end.memberId}:${end.end}`));
  for (const member of [...turn.board.members, ...turn.draft.members]) {
    for (const end of ["a", "b"] as const) {
      if (member[end] === key && !attached.has(`${member.id}:${end}`)) return undefined;
    }
  }
  return at[0];
}

const unknown: JointComponents = ["unavailable", "unavailable", "unavailable", "unavailable", "unavailable", "unavailable"];
const conflict: JointComponents = ["conflict", "conflict", "conflict", "conflict", "conflict", "conflict"];
const axialOnly: JointComponents = ["locked", "locked", "locked", "inactive", "inactive", "inactive"];

/** A world direction crossing distinct eigenspaces cannot be described with
 * a single independent release. Elastic directions also retain their real axes. */
function globalComponents(connection: Connection): JointComponents {
  const { axes, laws } = connectionDefinition(connection.profile, connection.axes);
  function component(index: number): JointState {
    const group = index < 3 ? 0 : 3;
    const active = axes.flatMap((axis, i) => Math.abs(axis[index % 3]) > 1e-12 ? [laws[group + i]] : []);
    if (!active.length) return "unavailable";
    if (active.some(law => law.kind !== active[0].kind) || (active.length > 1 && active[0].kind === "elastic")) return "coupled";
    return active[0].kind;
  }
  return [component(0), component(1), component(2), component(3), component(4), component(5)];
}

/** Read committed attachments by identifier. Geometrically coincident loose
 * endpoints, inactive original ports and internal subdivision nodes are absent. */
export function sharedJointPermissions(board: TurnState["board"]): JointPermission[] {
  const connections = new Map<string, Connection[]>();
  for (const end of board.connections) {
    const group = connections.get(end.jointId);
    if (group) group.push(end);
    else connections.set(end.jointId, [end]);
  }
  return board.joints.map(joint => {
    const attached = connections.get(joint.id) ?? [];
    const profile = attached[0]?.profile;
    const valid = profile && Object.hasOwn(CONNECTION_PROFILES, profile);
    const established = valid ? connectionDefinition(profile, attached[0].axes) : undefined;
    const invalid = attached.some(end => !Object.hasOwn(CONNECTION_PROFILES, end.profile));
    const mixed = !invalid && established && attached.some(end => {
      const other = connectionDefinition(end.profile, end.axes);
      return conflictingJointAxes(established.laws, other.laws, established.axes, other.axes).length > 0;
    });
    const varied = !mixed && established?.laws.some((law, i) => law.kind === "elastic" && attached.some(end => {
      if (invalid) return false;
      const other = connectionDefinition(end.profile, end.axes);
      const axis = established.axes[i % 3];
      const aligned = other.axes.findIndex(b => Math.abs(axis[0]*b[0] + axis[1]*b[1] + axis[2]*b[2]) > 1 - 1e-12);
      const matched = other.laws[(i < 3 ? 0 : 3) + aligned];
      return matched?.kind === "elastic" && matched.stiffness !== law.stiffness;
    }));
    const port = /^port:(\d+):([123])$/.exec(joint.id);
    return {
      id: joint.id, point: joint.point ?? joint.id,
      profile: mixed ? "Conflicting attached-end freedoms" : !valid || invalid ? "Connection unavailable"
        : varied ? "Elastic · stiffness varies" : connectionLabel(profile),
      components: mixed ? conflict : valid && !invalid ? CONNECTION_PROFILES[profile] : unknown,
      global: valid && !invalid && !mixed ? globalComponents(attached[0]) : undefined,
      frame: !invalid && !mixed ? established?.axes : undefined,
      ground: joint.foundationOwner ? CONNECTION_PROFILES.fixed : undefined,
      attachments: attached.map(end => {
        const label = Object.hasOwn(CONNECTION_PROFILES, end.profile) ? connectionLabel(end.profile) : "Unavailable";
        return `Member ${end.memberId} end ${end.end.toUpperCase()} · ${label}${end.axes ? ' · member-local axes' : ''}`;
      }),
      parent: port ? `Member ${port[1]} · original ${Number(port[2]) * 25}% port. The parent continues through this port.` : undefined,
    };
  });
}

/** In the editor a lattice node is explicitly the model identity. Beam ends use
 * the node's rigid/pinned flag. A cable itself has no rotational end components. */
export function editorJointPermissions(model: GameModel): JointPermission[] {
  const incident = new Map<string, GameModel["members"]>();
  for (const member of model.members) for (const id of [member.a, member.b]) {
    const group = incident.get(id);
    if (group) group.push(member);
    else incident.set(id, [member]);
  }
  return allNodeKeys(model).map(id => {
    const attrs = model.attrs[id];
    const attached = incident.get(id) ?? [];
    const profile = attrs?.joint ? "fixed" : "ball";
    const axial = (member: GameModel["members"][number]) => member.type === "cable" || member.type === "spring";
    const beam = attached.some(member => !axial(member));
    const mask = attrs?.restraint;
    const groundState = (axis: number) => mask?.[axis] ? "locked" : "free";
    const ground: JointComponents | undefined = mask
      ? [groundState(0), groundState(1), groundState(2), groundState(3), groundState(4), groundState(5)]
      : attrs?.found ? CONNECTION_PROFILES.fixed : undefined;
    return {
      id, point: id, ground,
      profile: beam ? connectionLabel(profile) : attached.length ? "Axial endpoint" : "No attached members",
      components: beam ? CONNECTION_PROFILES[profile] : attached.length ? axialOnly : unknown,
      attachments: attached.map(member => `Member ${member.id} end ${member.a === id ? "A" : "B"} · ${axial(member) ? "axial " + member.type : connectionLabel(profile)}`),
    };
  });
}
