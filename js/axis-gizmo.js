// =====================================================================
// axis-gizmo.js
//
// A small on-screen orientation gizmo (like the one in Blender/most
// 3D tools) — three colored axes (X = red, Y = green, Z = blue)
// rendered in a corner of the screen, rotating live to match your
// main camera's current orientation. It's a visual aid only: it
// never reads from or writes to your cinematic/layout code, and your
// main camera never touches it.
//
// INTEGRATION — two additions in your main.js:
//
//   import { initAxisGizmo, renderAxisGizmo } from "./axis-gizmo.js";
//
//   // once, after renderer/camera/scene exist (anywhere after their
//   // declarations near the top of main.js is fine):
//   initAxisGizmo({ THREE, renderer, camera });
//
//   // inside animate(), AFTER your main renderer.render(scene, camera)
//   // call, as the very last thing before requestAnimationFrame loops:
//   renderAxisGizmo();
//
// That's it. No HTML changes needed — the gizmo draws into a small
// corner of the same <canvas> your main scene already uses.
// =====================================================================

const GIZMO_SIZE_PX = 110;      // corner box size, in CSS pixels
const GIZMO_MARGIN_PX = 16;     // distance from the screen edges
const GIZMO_CORNER = "top-right"; // "top-right" | "top-left" | "bottom-right" | "bottom-left"

let _THREE = null;
let _renderer = null;
let _camera = null;

let _gizmoScene = null;
let _gizmoCamera = null;

// -----------------------------------------------------
// buildAxis — one colored shaft + a sphere tip + a text label sprite,
// pointing along the given unit direction.
// -----------------------------------------------------
function buildAxis(THREE, direction, color, label) {
  const group = new THREE.Group();

  const shaftLength = 0.78;
  const shaftGeom = new THREE.CylinderGeometry(0.035, 0.035, shaftLength, 12);
  const shaftMat = new THREE.MeshBasicMaterial({ color });
  const shaft = new THREE.Mesh(shaftGeom, shaftMat);

  // Cylinders default to pointing along +Y — rotate to point along
  // "direction" instead.
  const up = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(up, direction.clone().normalize());
  shaft.quaternion.copy(quat);
  shaft.position.copy(direction.clone().multiplyScalar(shaftLength / 2));
  group.add(shaft);

  const tipGeom = new THREE.SphereGeometry(0.11, 16, 16);
  const tipMat = new THREE.MeshBasicMaterial({ color });
  const tip = new THREE.Mesh(tipGeom, tipMat);
  tip.position.copy(direction.clone().multiplyScalar(shaftLength + 0.05));
  group.add(tip);

  // Text label sprite (canvas texture), sitting just past the tip.
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 40px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 32, 34);

  const texture = new THREE.CanvasTexture(canvas);
  const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(0.35, 0.35, 0.35);
  sprite.position.copy(direction.clone().multiplyScalar(shaftLength + 0.28));
  group.add(sprite);

  return group;
}

// -----------------------------------------------------
// buildNegativeTick — a small dim sphere marking the negative end of
// an axis (no shaft, no label) — matches the muted "back side" ticks
// you see in most orientation gizmos.
// -----------------------------------------------------
function buildNegativeTick(THREE, direction, color) {
  const geom = new THREE.SphereGeometry(0.09, 16, 16);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 });
  const tick = new THREE.Mesh(geom, mat);
  tick.position.copy(direction.clone().multiplyScalar(-0.78));
  return tick;
}

// -----------------------------------------------------
// initAxisGizmo — call once, after THREE/renderer/camera exist.
// -----------------------------------------------------
export function initAxisGizmo({ THREE, renderer, camera }) {
  _THREE = THREE;
  _renderer = renderer;
  _camera = camera;

  _gizmoScene = new THREE.Scene();

  const axisDefs = [
    { dir: new THREE.Vector3(1, 0, 0), color: 0xe63946, label: "X" }, // red
    { dir: new THREE.Vector3(0, 1, 0), color: 0x57cc63, label: "Y" }, // green
    { dir: new THREE.Vector3(0, 0, 1), color: 0x4d96ff, label: "Z" }, // blue
  ];

  axisDefs.forEach(function (def) {
    _gizmoScene.add(buildAxis(THREE, def.dir, def.color, def.label));
    _gizmoScene.add(buildNegativeTick(THREE, def.dir, def.color));
  });

  const ambient = new THREE.AmbientLight(0xffffff, 1);
  _gizmoScene.add(ambient);

  _gizmoCamera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
  _gizmoCamera.position.set(0, 0, 4);
  _gizmoCamera.lookAt(0, 0, 0);
}

// -----------------------------------------------------
// getViewportRect — computes the corner box in the coordinates
// WebGLRenderer.setViewport/setScissor expect: origin at the
// BOTTOM-LEFT of the canvas, size in real (device) pixels.
// -----------------------------------------------------
function getViewportRect() {
  const canvas = _renderer.domElement;
  const dpr = _renderer.getPixelRatio();
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;

  const sizePx = GIZMO_SIZE_PX * dpr;
  const marginPx = GIZMO_MARGIN_PX * dpr;

  let left;
  let bottomFromTop; // CSS-space distance from the top edge to the box's bottom edge

  if (GIZMO_CORNER === "top-right") {
    left = cssWidth * dpr - sizePx - marginPx;
    bottomFromTop = marginPx + sizePx;
  } else if (GIZMO_CORNER === "top-left") {
    left = marginPx;
    bottomFromTop = marginPx + sizePx;
  } else if (GIZMO_CORNER === "bottom-right") {
    left = cssWidth * dpr - sizePx - marginPx;
    bottomFromTop = cssHeight * dpr - marginPx;
  } else {
    // bottom-left
    left = marginPx;
    bottomFromTop = cssHeight * dpr - marginPx;
  }

  // Convert "distance from top" to "distance from bottom" (WebGL's
  // viewport/scissor origin is bottom-left).
  const bottom = cssHeight * dpr - bottomFromTop;

  return { x: left, y: bottom, size: sizePx };
}

// -----------------------------------------------------
// renderAxisGizmo — call once per frame, AFTER your main
// renderer.render(scene, camera) call. Rotates the gizmo to match the
// main camera's current orientation, draws it into a small corner
// viewport via scissoring (so it doesn't disturb the rest of the
// canvas), then restores the full-canvas viewport/scissor so your
// next frame's main render is unaffected.
// -----------------------------------------------------
export function renderAxisGizmo() {
  if (!_gizmoScene || !_gizmoCamera) return;

  // Mirror the main camera's rotation only (never its position) so
  // the gizmo shows "which way is the camera currently facing,
  // relative to world axes" — exactly what you'd use to line up a
  // top view by eye.
  _gizmoCamera.position.copy(
    new _THREE.Vector3(0, 0, 4).applyQuaternion(_camera.quaternion)
  );
  _gizmoCamera.up.copy(_camera.up);
  _gizmoCamera.lookAt(0, 0, 0);

  const rect = getViewportRect();

  _renderer.setScissorTest(true);
  _renderer.setViewport(rect.x, rect.y, rect.size, rect.size);
  _renderer.setScissor(rect.x, rect.y, rect.size, rect.size);

  // Don't let this render call clear the color buffer — that would
  // wipe the main scene's pixels in this corner to black before the
  // gizmo draws. Only clear depth, so the gizmo's own axes still
  // depth-sort correctly against each other, while compositing on
  // top of whatever the main render already put in this corner.
  const prevAutoClear = _renderer.autoClear;
  _renderer.autoClear = false;
  _renderer.clearDepth();
  _renderer.render(_gizmoScene, _gizmoCamera);
  _renderer.autoClear = prevAutoClear;

  // Restore full-canvas viewport/scissor so the NEXT frame's main
  // scene render (which expects to draw over the whole canvas) isn't
  // still confined to this corner.
  const canvas = _renderer.domElement;
  const dpr = _renderer.getPixelRatio();
  _renderer.setViewport(0, 0, canvas.clientWidth * dpr, canvas.clientHeight * dpr);
  _renderer.setScissor(0, 0, canvas.clientWidth * dpr, canvas.clientHeight * dpr);
  _renderer.setScissorTest(false);
}