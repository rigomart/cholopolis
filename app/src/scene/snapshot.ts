import * as THREE from "three";

const CAMERA_POSITION = new THREE.Vector3(3.4, 17.2, 14.6);
const CAMERA_TARGET = new THREE.Vector3(0, 0, 1.1);

/**
 * Renders `scene` from a fixed camera offscreen into a 2D canvas, keeping its lighting and restoring the
 * renderer's target. The fog follows the live camera's `viewDistance`, so it is moved by as much as this camera is farther.
 */
export function snapshotScene(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  viewDistance: number,
  width: number,
  height: number,
): HTMLCanvasElement {
  const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 200);
  camera.position.copy(CAMERA_POSITION);
  camera.lookAt(CAMERA_TARGET);
  const target = new THREE.WebGLRenderTarget(width, height, { colorSpace: THREE.SRGBColorSpace, samples: 4 });
  const previous = renderer.getRenderTarget();
  const fog = scene.fog instanceof THREE.Fog ? scene.fog : null;
  const fogRange = fog && { near: fog.near, far: fog.far };
  const shift = CAMERA_POSITION.distanceTo(CAMERA_TARGET) - viewDistance;
  const pixels = new Uint8Array(width * height * 4);
  try {
    if (fog) {
      fog.near += shift;
      fog.far += shift;
    }
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
  } finally {
    if (fog && fogRange) Object.assign(fog, fogRange);
    renderer.setRenderTarget(previous);
    target.dispose();
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const image = ctx.createImageData(width, height);
  const row = width * 4;
  // WebGL reads bottom-up.
  for (let y = 0; y < height; y++) {
    image.data.set(pixels.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
