import * as THREE from "three";

import { DICE_WALL } from "../../../shared/dice.ts";
import { drawIcon } from "./icons.ts";
import { INNER, toBoard } from "./layout.ts";
import { COMBI } from "./palette.ts";

const HEIGHT = 0.24;
const BLOCK = 0.365;
const POST_HEIGHT = 0.78;
const PARADERO = "#1f5fbf";

function stopSign(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = COMBI.plate;
    ctx.beginPath();
    ctx.roundRect(8, 8, 240, 240, 36);
    ctx.fill();
    ctx.fillStyle = PARADERO;
    ctx.beginPath();
    ctx.roundRect(20, 20, 216, 216, 26);
    ctx.fill();
    drawIcon(ctx, "bus", 128, 128, 84, COMBI.plate);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function buildRim(): THREE.Group {
  const rim = new THREE.Group();
  const width = INNER - DICE_WALL;
  const length = 2 * DICE_WALL;
  const count = Math.round(length / BLOCK);
  const block = length / count;

  const kerb = new THREE.InstancedMesh(
    new THREE.BoxGeometry(block, HEIGHT, width),
    new THREE.MeshStandardMaterial({ roughness: 0.6 }),
    count * 4,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const color = new THREE.Color();
  for (let side = 0; side < 4; side++) {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (side * Math.PI) / 2);
    for (let n = 0; n < count; n++) {
      const p = toBoard({ x: -DICE_WALL + (n + 0.5) * block, z: DICE_WALL + width / 2 }, side);
      m.compose(new THREE.Vector3(p.x, 0.35 + HEIGHT / 2, p.z), q, new THREE.Vector3(1, 1, 1));
      kerb.setMatrixAt(side * count + n, m);
      kerb.setColorAt(side * count + n, color.set(n % 2 ? COMBI.black : COMBI.yellow));
    }
  }
  kerb.castShadow = kerb.receiveShadow = true;
  rim.add(kerb);

  const sign = stopSign();
  const pole = new THREE.MeshStandardMaterial({ color: COMBI.ink3, roughness: 0.5 });
  const spriteMaterial = new THREE.SpriteMaterial({ map: sign });
  for (let side = 0; side < 4; side++) {
    const corner = toBoard({ x: DICE_WALL + width / 2, z: DICE_WALL + width / 2 }, side);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, POST_HEIGHT, 8), pole);
    post.position.set(corner.x, 0.35 + HEIGHT + POST_HEIGHT / 2, corner.z);
    post.castShadow = true;
    const label = new THREE.Sprite(spriteMaterial);
    label.scale.setScalar(0.3);
    label.position.set(corner.x, 0.35 + HEIGHT + POST_HEIGHT + 0.1, corner.z);
    rim.add(post, label);
  }
  return rim;
}
