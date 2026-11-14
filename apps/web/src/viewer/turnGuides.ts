import * as THREE from "three";
import type { useGameStore } from "../game/store";
import { turnConnectionTargets } from "./turnPicking";

type GameState = ReturnType<typeof useGameStore.getState>;
type Point = (key: string) => THREE.Vector3;

export function memberEndPosition(
  point: Point,
  member: GameState["model"]["members"][number],
  end: "a" | "b",
) {
  return point(member[end]).lerp(point(member[end === "a" ? "b" : "a"]), 0.2);
}

export function buildTurnGuides(
  group: THREE.Group,
  state: GameState,
  point: Point,
) {
  if (state.mode !== "multiplayer" || !state.turn) return;
  const positions: number[] = [];
  for (const { memberId, end } of turnConnectionTargets(state)) {
    const member = state.model.members.find(({ id }) => id === memberId);
    if (!member) continue;
    positions.push(...memberEndPosition(point, member, end).toArray());
  }
  if (positions.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    group.add(
      new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          size: 11,
          sizeAttenuation: false,
          color: "#f6ad49",
          depthTest: false,
          depthWrite: false,
        }),
      ),
    );
  }
  const staged = state.turn.draft.connections;
  for (const connection of [...state.turn.board.connections, ...staged]) {
    const member = state.model.members.find(
      ({ id }) => id === connection.memberId,
    );
    if (!member) continue;
    const geometry =
      connection.profile === "fixed"
        ? new THREE.BoxGeometry(0.48, 0.48, 0.48)
        : new THREE.SphereGeometry(0.26, 16, 10);
    const material = new THREE.MeshStandardMaterial({
      color: connection.profile === "fixed" ? "#e8b368" : "#f6e5b9",
      transparent: staged.includes(connection),
      opacity: staged.includes(connection) ? 0.62 : 1,
    });
    const marker = new THREE.Mesh(geometry, material);
    marker.position.copy(memberEndPosition(point, member, connection.end));
    group.add(marker);
  }
}
