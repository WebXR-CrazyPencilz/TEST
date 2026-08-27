// =====================================================
// IMPORTS
// =====================================================

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// =====================================================
// DOM REFERENCES
// =====================================================

const loadingScreenEl = document.getElementById("loading-screen");
const loadingPercentEl = document.getElementById("loading-percent");
const loadingBarFillEl = document.getElementById("loading-bar-fill");
const errorEl = document.getElementById("error");
const cameraDebugEl = document.getElementById("camera-debug");

// =====================================================================
// =====================================================================
//
//   CINEMATIC CAMERA POSITIONS
//   EDIT THESE VALUES MANUALLY — nothing here is auto-calculated.
//   There is exactly ONE Point A, ONE Point B, ONE Point C.
//
// =====================================================================
// =====================================================================

// ---------------------------------------------------------------------
// POINT A — hand-tuned camera position. Independent of Point B.
// ---------------------------------------------------------------------
const POINT_A = new THREE.Vector3(
  -191.31,
  4,
  258.59
);

// ---------------------------------------------------------------------
// POINT B — ORBIT CENTER (NOT a camera position). The camera never
// sits here, never passes through it, never interpolates toward it.
// ---------------------------------------------------------------------
const POINT_B = new THREE.Vector3(
  139.22,
  5.25,
  39
);

// ---------------------------------------------------------------------
// POINT C — FINAL TOP VIEW CAMERA POSITION.
// ---------------------------------------------------------------------
const POINT_C = new THREE.Vector3(
  0,
  220,
  0
);

// =====================================================================
// POINT A ROTATION — hand-tuned, independent of Point B. This is
// Point A's own composition and is never derived from, or blended
// toward, anything Point-B-related except across the approach.
// =====================================================================

const POINT_A_YAW_DEG = -20;    // turn left
const POINT_A_PITCH_DEG = -15;  // tilt down
const POINT_A_ROLL_DEG = 0;     // level horizon

// =====================================================================
// ORBIT SETTINGS — Point B's own geometry. DO NOT CHANGE.
// =====================================================================

const ORBIT_RADIUS = 20;
const ORBIT_START_ANGLE = 0;
const ORBIT_END_ANGLE = Math.PI;
const ORBIT_HEIGHT_OFFSET = 4;

// =====================================================================
// TIMING (seconds)
// =====================================================================

const HOLD_AT_A_DURATION = 1.5;       // pause at Point A before moving
const APPROACH_DURATION = 7.0;        // Point A -> orbit entry, very slow
const ORBIT_DURATION = 3.5;           // circular orbit around Point B
const TOP_TRANSITION_DURATION = 5.0;  // orbit -> Point C, very slow rise

// ---------------------------------------------------------------------
// TOP_VIEW_UP — locks roll for the final straight-down shot.
// ---------------------------------------------------------------------
const TOP_VIEW_UP = new THREE.Vector3(0, 0, -1);

const CAMERA_FOV_DEG = 75;

// =====================================================================
// END OF EDITABLE CINEMATIC SETTINGS
// =====================================================================

// =====================================================
// ORBIT GEOMETRY — Point B's own pivot math, untouched.
// =====================================================================

function getOrbitPoint(angle, target) {
  const x = POINT_B.x + ORBIT_RADIUS * Math.cos(angle);
  const z = POINT_B.z + ORBIT_RADIUS * Math.sin(angle);
  const y = POINT_B.y + ORBIT_HEIGHT_OFFSET;
  return target.set(x, y, z);
}

const orbitEntryPoint = getOrbitPoint(ORBIT_START_ANGLE, new THREE.Vector3());
const orbitExitPoint = getOrbitPoint(ORBIT_END_ANGLE, new THREE.Vector3());

// =====================================================
// SCENE
// =====================================================

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeeeeee);

// =====================================================
// CAMERA
// =====================================================

const camera = new THREE.PerspectiveCamera(
  CAMERA_FOV_DEG,
  window.innerWidth / window.innerHeight,
  0.01,
  10000
);

// ---------------------------------------------------------------------
// POSE A — Point A's own fixed orientation. Computed purely from the
// hand-tuned yaw/pitch/roll above. Never touches POINT_B, orbitEntryPoint,
// or any lookAt() call.
// ---------------------------------------------------------------------
const POINT_A_QUATERNION = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(
    THREE.MathUtils.degToRad(POINT_A_PITCH_DEG),
    THREE.MathUtils.degToRad(POINT_A_YAW_DEG),
    THREE.MathUtils.degToRad(POINT_A_ROLL_DEG),
    "YXZ"
  )
);

// ---------------------------------------------------------------------
// POSE B — the exact rotation Point B's own orbit function produces
// on its very first frame: standing at orbitEntryPoint, looking at
// POINT_B (angle = ORBIT_START_ANGLE = 0). Built once at startup with
// a throwaway Object3D so it uses the same math camera.lookAt() would
// produce — this is Point B's own orientation, computed independently
// of Point A.
// ---------------------------------------------------------------------
const ORBIT_ENTRY_QUATERNION = (function computeOrbitEntryQuaternion() {
  const dummy = new THREE.Object3D();
  dummy.position.copy(orbitEntryPoint);
  dummy.up.copy(camera.up);
  dummy.lookAt(POINT_B);
  return dummy.quaternion.clone();
})();

// The camera starts at Point A with Point A's own orientation — not
// derived from Point B in any way.
camera.position.copy(POINT_A);
camera.quaternion.copy(POINT_A_QUATERNION);

// =====================================================
// RENDERER
// =====================================================

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// =====================================================
// LIGHTING
// =====================================================

const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 3);
scene.add(hemisphereLight);

const mainLight = new THREE.DirectionalLight(0xffffff, 4);
mainLight.position.set(10, 20, 10);
mainLight.castShadow = true;
mainLight.shadow.mapSize.set(2048, 2048);
mainLight.shadow.camera.near = 0.1;
mainLight.shadow.camera.far = 200;
scene.add(mainLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 2);
fillLight.position.set(-10, 10, -10);
scene.add(fillLight);

// =====================================================
// ORBIT CONTROLS (disabled until cinematic finishes)
// =====================================================

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enablePan = false;
controls.enableZoom = false;
controls.enableRotate = false;
controls.minDistance = 0.1;
controls.maxDistance = 10000;
controls.enabled = false;

// =====================================================
// EASING
// =====================================================

function easeInOutCubic(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// =====================================================
// CINEMATIC STATE MACHINE
// =====================================================

const CinematicState = {
  HOLD_A: "HOLD_A",
  APPROACH: "APPROACH",
  ORBIT: "ORBIT",
  TOP_TRANSITION: "TOP_TRANSITION",
  INTERACTIVE: "INTERACTIVE",
};

let cinematicState = CinematicState.HOLD_A;
let cinematicStartTime = null;
let cinematicActive = false;

const _tmpPos = new THREE.Vector3();

function startCinematic() {
  cinematicState = CinematicState.HOLD_A;
  cinematicStartTime = performance.now() / 1000;
  cinematicActive = true;

  controls.enabled = false;
  controls.enableRotate = false;
  controls.enablePan = false;
  controls.enableZoom = false;
}

function finishCinematic() {
  cinematicActive = false;
  cinematicState = CinematicState.INTERACTIVE;

  camera.position.copy(POINT_C);
  camera.up.copy(TOP_VIEW_UP);
  camera.lookAt(0, 0, 0);
  controls.target.set(0, 0, 0);

  controls.enabled = true;
  controls.enableDamping = true;
  controls.enableRotate = true;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.update();
}

// -----------------------------------------------------
// PHASE 0 — hold static at Point A before moving.
// Position AND rotation are Point A's own fixed pose, copied every
// frame — no recomputation, no drift, no reference to Point B.
// -----------------------------------------------------
function updateHoldA(elapsed) {
  camera.position.copy(POINT_A);
  camera.quaternion.copy(POINT_A_QUATERNION);

  if (elapsed >= HOLD_AT_A_DURATION) {
    cinematicState = CinematicState.APPROACH;
    cinematicStartTime = performance.now() / 1000;
  }
}

// -----------------------------------------------------
// PHASE 1 — Point A -> orbit entry point. VERY SLOW (7s).
//
// Two FIXED camera poses are blended:
//   Pose A: position = POINT_A,        quaternion = POINT_A_QUATERNION
//   Pose B: position = orbitEntryPoint, quaternion = ORBIT_ENTRY_QUATERNION
//
// Position is a plain lerp between the two pose positions. Rotation
// is a genuine quaternion SLERP between the two pose quaternions —
// never a lookAt() call, never an interpolated look-at point. Because
// slerp interpolates the rotation itself and never reads
// camera.position, it cannot be thrown off by the camera still being
// near POINT_A early in the approach the way a lookAt()-based method
// was. At t=0 this is bit-for-bit Pose A (matches the held frame). At
// t=1 this is bit-for-bit Pose B (matches Point B's own first orbit
// frame, since ORBIT_ENTRY_QUATERNION was built from that exact pose).
// -----------------------------------------------------
function updateApproach(elapsed) {
  const t = Math.min(elapsed / APPROACH_DURATION, 1);
  const eased = easeInOutCubic(t);

  camera.position.lerpVectors(POINT_A, orbitEntryPoint, eased);
  camera.quaternion.slerpQuaternions(POINT_A_QUATERNION, ORBIT_ENTRY_QUATERNION, eased);

  if (t >= 1) {
    // Snap to exact values, zero floating-point drift. Same state
    // Point B's own first frame produces — not a correction.
    camera.position.copy(orbitEntryPoint);
    camera.quaternion.copy(ORBIT_ENTRY_QUATERNION);

    cinematicState = CinematicState.ORBIT;
    cinematicStartTime = performance.now() / 1000;
  }
}

// -----------------------------------------------------
// PHASE 2 — POINT B / ORBIT. UNCHANGED.
//
// Real circular motion around POINT_B at radius ORBIT_RADIUS,
// camera.lookAt(POINT_B) every frame. POINT_B is only ever a pivot.
// -----------------------------------------------------
function updateOrbit(elapsed) {
  const t = Math.min(elapsed / ORBIT_DURATION, 1);
  const eased = easeInOutCubic(t);

  const angle = ORBIT_START_ANGLE +
    (ORBIT_END_ANGLE - ORBIT_START_ANGLE) * eased;

  getOrbitPoint(angle, _tmpPos);
  camera.position.copy(_tmpPos);
  camera.lookAt(POINT_B);

  if (t >= 1) {
    cinematicState = CinematicState.TOP_TRANSITION;
    cinematicStartTime = performance.now() / 1000;
  }
}

// -----------------------------------------------------
// PHASE 3 — orbit exit point -> POINT_C (slow float to top view).
// -----------------------------------------------------
function updateTopTransition(elapsed) {
  const t = Math.min(elapsed / TOP_TRANSITION_DURATION, 1);
  const eased = easeInOutCubic(t);

  _tmpPos.lerpVectors(orbitExitPoint, POINT_C, eased);
  camera.position.copy(_tmpPos);

  const lookTarget = new THREE.Vector3().lerpVectors(
    POINT_B,
    new THREE.Vector3(0, 0, 0),
    eased
  );

  camera.up.lerpVectors(camera.up, TOP_VIEW_UP, eased).normalize();

  camera.lookAt(lookTarget);
  controls.target.copy(lookTarget);

  if (t >= 1) {
    finishCinematic();
  }
}

function updateCinematic(nowSeconds) {
  if (!cinematicActive) return;

  const elapsed = nowSeconds - cinematicStartTime;

  switch (cinematicState) {
    case CinematicState.HOLD_A:
      updateHoldA(elapsed);
      break;
    case CinematicState.APPROACH:
      updateApproach(elapsed);
      break;
    case CinematicState.ORBIT:
      updateOrbit(elapsed);
      break;
    case CinematicState.TOP_TRANSITION:
      updateTopTransition(elapsed);
      break;
    default:
      break;
  }
}

// =====================================================
// GLTF / GLB LOADER
// =====================================================

const loader = new GLTFLoader();
let loadedModel = null;

loader.load(
  "./test.glb",

  function (gltf) {
    const model = gltf.scene;
    scene.add(model);
    loadedModel = model;

    model.traverse(function (object) {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());

    model.position.x -= center.x;
    model.position.y -= center.y;
    model.position.z -= center.z;

    const centeredBox = new THREE.Box3().setFromObject(model);
    const centeredSize = centeredBox.getSize(new THREE.Vector3());
    const maxSize = Math.max(centeredSize.x, centeredSize.y, centeredSize.z);

    const fovRadiansForLog = THREE.MathUtils.degToRad(camera.fov);
    const suggestedTopY =
      ((maxSize / 2) / Math.tan(fovRadiansForLog / 2)) * 1.3;

    console.log("================================");
    console.log("MODEL BOUNDING BOX SIZE:", centeredSize);
    console.log("LARGEST DIMENSION:", maxSize);
    console.log("Suggested POINT_C.y (comfortable top view):", suggestedTopY);
    console.log("Current POINT_C.y is:", POINT_C.y);
    console.log("================================");

    camera.near = Math.max(maxSize / 1000, 0.01);
    camera.far = Math.max(POINT_C.length(), maxSize) * 20;
    camera.updateProjectionMatrix();

    controls.minDistance = Math.max(maxSize * 0.05, 0.1);
    controls.maxDistance = Math.max(POINT_C.length() * 4, maxSize * 10);

    loadingScreenEl.classList.add("fade-out");
    setTimeout(function () {
      loadingScreenEl.style.display = "none";
      startCinematic();
    }, 500);
  },

  function (xhr) {
    if (xhr.total > 0) {
      const percent = (xhr.loaded / xhr.total) * 100;
      const clamped = Math.min(percent, 100).toFixed(0);
      loadingPercentEl.textContent = "Loading model... " + clamped + "%";
      loadingBarFillEl.style.width = clamped + "%";
    }
  },

  function (error) {
    console.error("GLB LOAD ERROR:", error);

    loadingScreenEl.style.display = "none";
    errorEl.style.display = "block";
    errorEl.innerHTML =
      "<strong>Unable to load test.glb</strong><br><br>" +
      "Open F12 &rarr; Console to see the exact error.";
  }
);

// =====================================================
// WINDOW RESIZE
// =====================================================

window.addEventListener("resize", function () {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// =====================================================
// CAMERA DEBUG OVERLAY
// =====================================================

let debugOverlayVisible = true;

window.addEventListener("keydown", function (e) {
  if (e.key === "d" || e.key === "D") {
    debugOverlayVisible = !debugOverlayVisible;
    cameraDebugEl.style.display = debugOverlayVisible ? "block" : "none";
  }
});

let lastPickedPoint = null;
let pickedPointFlashUntil = 0;

function updateCameraDebugOverlay() {
  if (!debugOverlayVisible) return;

  const p = camera.position;
  const r = camera.rotation;
  const toDeg = THREE.MathUtils.radToDeg;

  cameraDebugEl.textContent =
    "PHASE: " + cinematicState + "\n" +
    "POSITION\n" +
    "  x: " + p.x.toFixed(2) + "\n" +
    "  y: " + p.y.toFixed(2) + "\n" +
    "  z: " + p.z.toFixed(2) + "\n" +
    "ROTATION (deg)\n" +
    "  x: " + toDeg(r.x).toFixed(1) + "\n" +
    "  y: " + toDeg(r.y).toFixed(1) + "\n" +
    "  z: " + toDeg(r.z).toFixed(1) + "\n" +
    (lastPickedPoint && performance.now() / 1000 < pickedPointFlashUntil
      ? "\nCLICKED POINT\n" +
        "  x: " + lastPickedPoint.x.toFixed(2) + "\n" +
        "  y: " + lastPickedPoint.y.toFixed(2) + "\n" +
        "  z: " + lastPickedPoint.z.toFixed(2) + "\n"
      : "") +
    "[press D to toggle | click model to pick point]";
}

// =====================================================
// CLICK-TO-PICK
// =====================================================

const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();

renderer.domElement.addEventListener("click", function (event) {
  if (!loadedModel) return;

  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointerNDC, camera);
  const hits = raycaster.intersectObject(loadedModel, true);

  if (hits.length > 0) {
    const point = hits[0].point;

    console.log("================================");
    console.log("PICKED WORLD POSITION:");
    console.log(
      "new THREE.Vector3(" +
      point.x.toFixed(2) + ", " +
      point.y.toFixed(2) + ", " +
      point.z.toFixed(2) + ")"
    );
    console.log("x:", point.x.toFixed(3));
    console.log("y:", point.y.toFixed(3));
    console.log("z:", point.z.toFixed(3));
    console.log("================================");

    lastPickedPoint = point.clone();
    pickedPointFlashUntil = performance.now() / 1000 + 3;
  }
});

// =====================================================
// RENDER LOOP
// =====================================================

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now() / 1000;

  if (cinematicActive) {
    updateCinematic(now);
  } else if (cinematicState === CinematicState.INTERACTIVE) {
    controls.update();
  }

  updateCameraDebugOverlay();

  renderer.render(scene, camera);
}

animate();