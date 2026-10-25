import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export const DIE = 0.6;

/** Which value faces each axis: opposite faces add up to 7, like a real die. */
const FACES: { value: number; normal: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3 }[] = [
  { value: 1, normal: new THREE.Vector3(0, 1, 0), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 0, 1) },
  { value: 6, normal: new THREE.Vector3(0, -1, 0), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 0, 1) },
  { value: 2, normal: new THREE.Vector3(1, 0, 0), u: new THREE.Vector3(0, 0, 1), v: new THREE.Vector3(0, 1, 0) },
  { value: 5, normal: new THREE.Vector3(-1, 0, 0), u: new THREE.Vector3(0, 0, 1), v: new THREE.Vector3(0, 1, 0) },
  { value: 3, normal: new THREE.Vector3(0, 0, 1), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 1, 0) },
  { value: 4, normal: new THREE.Vector3(0, 0, -1), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 1, 0) },
];

/** Pip layout per value, in face coordinates from -1 to 1. */
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
};

/** Rotation that puts each value on top (+y). */
export const FACE_UP: Record<number, THREE.Quaternion> = Object.fromEntries(
  FACES.map((f) => [f.value, new THREE.Quaternion().setFromUnitVectors(f.normal, new THREE.Vector3(0, 1, 0))]),
);

/** A bone-white die with rounded edges and sunken ink pips; the single pip is chicha pink. */
export function buildDie(): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new RoundedBoxGeometry(DIE, DIE, DIE, 4, DIE * 0.16),
    new THREE.MeshStandardMaterial({ color: "#fffaf0", roughness: 0.32 }),
  );
  body.castShadow = true;
  group.add(body);

  const ink = new THREE.MeshStandardMaterial({ color: "#1b1240", roughness: 0.5 });
  const pink = new THREE.MeshStandardMaterial({ color: "#ff2e88", roughness: 0.4 });
  const pip = new THREE.SphereGeometry(1, 14, 8);
  const spread = DIE * 0.24;
  for (const face of FACES) {
    const radius = face.value === 1 ? DIE * 0.12 : DIE * 0.075;
    for (const [a, b] of PIPS[face.value] ?? []) {
      const mesh = new THREE.Mesh(pip, face.value === 1 ? pink : ink);
      mesh.position
        .copy(face.normal)
        .multiplyScalar(DIE / 2 - radius * 0.12)
        .addScaledVector(face.u, a * spread)
        .addScaledVector(face.v, b * spread);
      // Flatten each pip along the face normal so it reads as a painted dimple, not a bump.
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), face.normal);
      mesh.scale.set(radius, radius * 0.3, radius);
      group.add(mesh);
    }
  }
  return group;
}
