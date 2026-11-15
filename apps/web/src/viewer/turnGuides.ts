import * as THREE from "three";
import type { useGameStore } from "../game/store";
import { turnConnectionTargets, turnPointPorts } from "./turnPicking";
import { CELL_SIZE, parseNodeKey } from "../game/model";
import { loadTargets, targetCoordinate } from "../game/turnPorts";
import { selectedTurnCard } from "./turnPicking";
import { isReleaseCatalogue } from "../game/cardCatalogue";
import { attachmentPoint, type AttachmentSite } from "../game/attachmentSites";
import { placementAnchorTargets, placementCandidates } from "../game/cantileverPlacement";
import { poseSection, wideFlangeGeometry } from "./sectionGeometry";

type GameState = ReturnType<typeof useGameStore.getState>;
type Point = (key: string) => THREE.Vector3;

export function memberEndPosition(
  point: Point,
  member: GameState["model"]["members"][number],
  end: AttachmentSite,
) {
  if (end !== "a" && end !== "b") return new THREE.Vector3(...parseNodeKey(attachmentPoint(member, end))).multiplyScalar(CELL_SIZE);
  return point(member[end]).lerp(point(member[end === "a" ? "b" : "a"]), 0.2);
}

export function buildTurnGuides(
  group: THREE.Group,
  state: GameState,
  point: Point,
) {
  if (state.mode !== "multiplayer" || !state.turn) return;
  const positions: number[] = [];
  const card = selectedTurnCard(state);
  if (isReleaseCatalogue(state.turn.catalogue) && card?.kind === "load") {
    for (const target of loadTargets(state.turn)) positions.push(...point(target.point).toArray());
  } else for (const port of turnPointPorts(state)) {
    if (port.available) positions.push(...port.point.map(v => v * CELL_SIZE));
  }
  if (card?.kind === "element") {
    const targets = state.chainStart ? placementCandidates(state) : placementAnchorTargets(state.turn);
    for (const target of targets) positions.push(...target.point.map(v => v * CELL_SIZE));
    const chosen = state.placementTip && placementCandidates(state).find(candidate => candidate.key === state.placementTip);
    if (chosen) {
      const members = [...state.turn.board.members, ...state.turn.draft.members];
      const tips = [chosen.a, chosen.b].map(key => new THREE.Vector3(...parseNodeKey(targetCoordinate(members, key))).multiplyScalar(CELL_SIZE));
      const delta = tips[1].clone().sub(tips[0]);
      const section = card.type === "heb" || card.type === "ipe";
      const mesh = new THREE.Mesh(section ? wideFlangeGeometry(card.type as "heb" | "ipe") : new THREE.CylinderGeometry(0.08, 0.08, delta.length(), 10),
        new THREE.MeshLambertMaterial({color: "#f6ad49", transparent: true, opacity: 0.7, depthWrite: false}));
      if (section) poseSection(mesh, tips[0], tips[1], delta);
      else {mesh.position.copy(tips[0]).lerp(tips[1], 0.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), delta.normalize());}
      mesh.renderOrder = 24; group.add(mesh);
      for (const tip of tips) {
        const marker = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 6), new THREE.MeshBasicMaterial({color: "#fff3bd", depthTest: false}));
        marker.position.copy(tip); group.add(marker);
      }
    }
    if (state.chainStart) {
      const anchor = placementAnchorTargets(state.turn).find(target => target.id === state.chainStart);
      const at = anchor?.point ?? state.chainStart.split(",").map(Number);
      if (at.length === 3 && at.every(Number.isFinite)) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.04, 8, 28), new THREE.MeshBasicMaterial({color: "#fff3bd", depthTest: false}));
        ring.position.set(at[0] * CELL_SIZE, at[1] * CELL_SIZE, at[2] * CELL_SIZE);
        ring.renderOrder = 5; group.add(ring);
      }
    }
  }
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
  for (const member of [...state.turn.board.members, ...state.turn.draft.members]) {
    for (const site of ["q1", "q2", "q3"] as const) {
      if (!member.interiorTargets?.[site] || [...state.turn.board.connections, ...staged].some(c => c.memberId === member.id && c.end === site)) continue;
      const points = Array.from({length: 33}, (_, i) => new THREE.Vector3(Math.cos(i*Math.PI/16)*0.3, Math.sin(i*Math.PI/16)*0.3, 0));
      const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({color: "#fff3bd", dashSize: 0.12, gapSize: 0.08, depthTest: false}));
      ring.computeLineDistances(); ring.position.copy(memberEndPosition(point, member, site)); group.add(ring);
    }
  }
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
