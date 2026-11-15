import * as THREE from "three";
import { CELL_SIZE, type Restraint } from "../game/model";

/** Axis colours of the Grow Dusk prototype: X coral, Y green, Z blue. */
export const DOF_AXIS_COLORS = ["#f2826f", "#7cc68a", "#7aa8e8"] as const;

/** How long the glyphs demonstrate their motion after a joint is selected or changed. */
const DEMONSTRATION_SECONDS = 2.4;

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const AXES = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
];

export interface GizmoSubject {
  /** Identity of the joint; a different key replays the pop and demonstration. */
  key: string;
  position: THREE.Vector3;
  /** Ground restraints in Tx, Ty, Tz, Rx, Ry, Rz order; true means locked. */
  restraint: Restraint;
}

/**
 * The six ground-restraint components of one selected joint, drawn around it
 * as in the Grow Dusk prototype. Per axis: an arrow for the translation and a
 * curl for the rotation. Free ones take the axis colour; locked ones are short
 * dark stubs and collars.
 *
 * It lives in its own scene so the caller can draw it over the structure. Per
 * the joint DOF criteria (docs/kb/joint-dof-criteria.md) the glyphs are still
 * by default and move only for a brief demonstration after selection, which is
 * skipped under reduced motion. It shows what the model stores; it does not
 * report stability.
 */
export function createDofGizmo() {
  const overlay = new THREE.Scene();
  const fill = new THREE.HemisphereLight("#eef2f8", "#cdbb9a", 2.2);
  fill.position.set(0, 0, 1);
  const key = new THREE.DirectionalLight("#ffdcb4", 1.4);
  key.position.set(-20, -12, 28);
  overlay.add(fill, key);
  const group = new THREE.Group();
  group.visible = false;
  overlay.add(group);

  const animated: { object: THREE.Object3D; kind: "t" | "r"; phase: number }[] =
    [];
  /** World position just past each axis tip, for the x / y / z labels. */
  const tips = AXES.map(() => new THREE.Vector3());
  let signature = "";
  let subjectKey = "";
  let builtAt = 0;
  let size = 1;

  function clearGroup() {
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }
    });
    group.clear();
    animated.length = 0;
  }

  const lambert = (paint: string, opacity = 1) =>
    new THREE.MeshLambertMaterial({
      color: paint,
      transparent: opacity < 1,
      opacity,
    });

  /** A straight stick from a to b in the local frame of its parent. */
  function stick(
    a: THREE.Vector3,
    b: THREE.Vector3,
    radius: number,
    material: THREE.Material,
  ) {
    const delta = b.clone().sub(a);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, delta.length(), 16),
      material,
    );
    mesh.position.copy(a).addScaledVector(delta, 0.5);
    mesh.quaternion.setFromUnitVectors(Y_AXIS, delta.normalize());
    return mesh;
  }

  function build(restraint: Restraint) {
    clearGroup();
    AXES.forEach((axis, index) => {
      const paint = DOF_AXIS_COLORS[index];
      const frame = new THREE.Group();
      // Local +Y runs along the axis.
      frame.quaternion.setFromUnitVectors(Y_AXIS, axis);
      group.add(frame);
      frame.add(
        stick(
          new THREE.Vector3(0, 0.14, 0),
          new THREE.Vector3(0, 0.66, 0),
          0.012,
          lambert(paint, 0.45),
        ),
      );
      const translation = new THREE.Group();
      if (restraint[index]) {
        translation.add(
          stick(
            new THREE.Vector3(0, 0.14, 0),
            new THREE.Vector3(0, 0.33, 0),
            0.05,
            lambert("#22313f"),
          ),
          stick(
            new THREE.Vector3(0, 0.33, 0),
            new THREE.Vector3(0, 0.375, 0),
            0.105,
            lambert("#22313f"),
          ),
        );
      } else {
        translation.add(
          stick(
            new THREE.Vector3(0, 0.16, 0),
            new THREE.Vector3(0, 0.8, 0),
            0.032,
            lambert(paint),
          ),
        );
        const head = new THREE.Mesh(
          new THREE.ConeGeometry(0.085, 0.2, 20),
          lambert(paint),
        );
        head.position.y = 0.9;
        translation.add(head);
        animated.push({ object: translation, kind: "t", phase: index * 2.1 });
      }
      frame.add(translation);

      const rotation = new THREE.Group();
      rotation.position.y = 0.52;
      if (restraint[index + 3]) {
        const collar = new THREE.Mesh(
          new THREE.TorusGeometry(0.075, 0.042, 10, 24),
          lambert("#22313f"),
        );
        collar.rotation.x = Math.PI / 2;
        rotation.add(collar);
      } else {
        const arc = 4.5,
          radius = 0.17;
        const curl = new THREE.Mesh(
          new THREE.TorusGeometry(radius, 0.024, 8, 30, arc),
          lambert(paint),
        );
        const arrow = new THREE.Mesh(
          new THREE.ConeGeometry(0.06, 0.15, 20),
          lambert(paint),
        );
        arrow.position.set(radius * Math.cos(arc), radius * Math.sin(arc), 0);
        arrow.quaternion.setFromUnitVectors(
          Y_AXIS,
          new THREE.Vector3(-Math.sin(arc), Math.cos(arc), 0),
        );
        const tail = new THREE.Mesh(
          new THREE.SphereGeometry(0.024, 12, 8),
          lambert(paint),
        );
        tail.position.set(radius, 0, 0);
        const turn = new THREE.Group();
        turn.add(curl, arrow, tail);
        // The torus lies in XY; stand it across the axis.
        const flat = new THREE.Group();
        flat.rotation.x = Math.PI / 2;
        flat.add(turn);
        rotation.add(flat);
        animated.push({ object: turn, kind: "r", phase: index * 2.1 + 1 });
      }
      frame.add(rotation);
    });
  }

  /**
   * Follow the selected joint, or hide when `subject` is null. `seconds` is
   * the frame clock; `stillness` disables the demonstration (reduced motion).
   */
  function update(
    subject: GizmoSubject | null,
    camera: THREE.Camera,
    seconds: number,
    stillness: boolean,
  ) {
    if (!subject) {
      if (group.visible) {
        group.visible = false;
        clearGroup();
        signature = subjectKey = "";
      }
      return;
    }
    const next = subject.key + "|" + subject.restraint.map(Number).join("");
    if (next !== signature) {
      const popped = subject.key !== subjectKey;
      signature = next;
      subjectKey = subject.key;
      build(subject.restraint);
      // A changed lock re-demonstrates without replaying the pop.
      builtAt = popped ? seconds : seconds - 0.26;
      group.visible = true;
    }
    group.position.copy(subject.position);
    // Keep it about the same size on screen.
    size =
      CELL_SIZE *
      clamp(
        camera.position.distanceTo(group.position) / CELL_SIZE / 15,
        0.75,
        2.4,
      );
    const age = seconds - builtAt;
    const pop = stillness ? 1 : spring(Math.min(1, age / 0.26));
    group.scale.setScalar(Math.max(0.01, size * pop));
    const demonstrating = !stillness && age < DEMONSTRATION_SECONDS;
    // Fade the demonstration out rather than stopping it mid-swing.
    const strength = demonstrating
      ? Math.min(1, (DEMONSTRATION_SECONDS - age) / 0.6)
      : 0;
    for (const item of animated) {
      if (item.kind === "t")
        item.object.position.y =
          strength * 0.07 * Math.sin(seconds * 3.1 + item.phase);
      else
        item.object.rotation.z =
          strength * 0.42 * Math.sin(seconds * 2.6 + item.phase);
    }
    AXES.forEach((axis, index) => {
      tips[index]
        .copy(axis)
        .multiplyScalar((subject.restraint[index] ? 0.52 : 1.12) * size)
        .add(group.position);
    });
  }

  return {
    overlay,
    tips,
    get visible() {
      return group.visible;
    },
    /** Current world scale, used to keep the joint card clear of the arrows. */
    get size() {
      return size;
    },
    update,
    dispose() {
      clearGroup();
      fill.dispose();
      key.dispose();
    },
  };
}

const clamp = THREE.MathUtils.clamp;
const spring = (k: number) =>
  k >= 1 ? 1 : 1 - Math.exp(-7 * k) * Math.cos(11 * k);
