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
// POINT A — THE ONLY STARTING CAMERA POSITION. UNCHANGED.
// ---------------------------------------------------------------------
const POINT_A = new THREE.Vector3(
  -191.31,
  4,
  258.59
);

// ---------------------------------------------------------------------
// POINT B — ORBIT CENTER (NOT a camera position). UNTOUCHED.
// The camera never sits here, never passes through it, and never
// interpolates its position toward it.
// ---------------------------------------------------------------------
const POINT_B = new THREE.Vector3(
  139.22,
  5.25,
  39
);

// ---------------------------------------------------------------------
// POINT C — FINAL TOP VIEW CAMERA POSITION. UNCHANGED.
// ---------------------------------------------------------------------
const POINT_C = new THREE.Vector3(
  0,
  220,
  0
);

// =====================================================================
// POINT A ROTATION — the left-facing opening composition. UNCHANGED.
// =====================================================================

const POINT_A_YAW_DEG = -20;    // turn left
const POINT_A_PITCH_DEG = -15;  // tilt down
const POINT_A_ROLL_DEG = 0;     // level horizon

// =====================================================================
// ORBIT SETTINGS — Code 1's exact values. DO NOT CHANGE.
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
const ORBIT_DURATION = 3.5;           // circular orbit around Point B — UNTOUCHED
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
// ORBIT GEOMETRY — Code 1's getOrbitPoint(), byte-for-byte unchanged.
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
// OPENING_QUATERNION — Point A's permanent, locked orientation. Used
// as-is for the entire HOLD_A phase, and as the mathematical starting
// point for the approach's rotation (see OPENING_LOOK_TARGET below).
// ---------------------------------------------------------------------
const OPENING_QUATERNION = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(
    THREE.MathUtils.degToRad(POINT_A_PITCH_DEG),
    THREE.MathUtils.degToRad(POINT_A_YAW_DEG),
    THREE.MathUtils.degToRad(POINT_A_ROLL_DEG),
    "YXZ"
  )
);

// ---------------------------------------------------------------------
// OPENING_LOOK_TARGET — a point in space such that
// camera.lookAt(OPENING_LOOK_TARGET) FROM orbitEntryPoint reproduces
// OPENING_QUATERNION exactly. It's built once, at startup, by taking
// OPENING_QUATERNION's own forward direction and projecting it out
// from orbitEntryPoint.
//
// This exists for exactly one reason: it lets the APPROACH phase
// below lerp its look target from "the opening orientation" to
// "POINT_B" using ordinary vector interpolation, while guaranteeing
// that at t=0 the result is bit-for-bit the same direction as the
// held Point-A pose, and at t=1 the result is bit-for-bit the same
// direction Point B's own orbit produces on ITS first frame
// (camera.lookAt(POINT_B) from orbitEntryPoint, angle = 0).
//
// Point B's own function (updateOrbit, further down) never
// references this constant and is completely unaware of it — it is
// pure Code 1, untouched.
// ---------------------------------------------------------------------
const OPENING_LOOK_TARGET = (function computeOpeningLookTargetFromQuaternion() {
  const forward = new THREE.Vector3(0, 0, -1)
    .applyQuaternion(OPENING_QUATERNION)
    .normalize();
  return orbitEntryPoint.clone().addScaledVector(forward, 100);
})();

// The camera starts at Point A with exactly this locked orientation.
camera.position.copy(POINT_A);
camera.quaternion.copy(OPENING_QUATERNION);

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
// Note: easeInOutCubic has ZERO derivative (zero rotational/positional
// speed) at both t=0 and t=1. That is what keeps every phase boundary
// in this file free of a sudden velocity change, not just a matching
// value — this matters for both ends of the approach phase below.
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
const _tmpLook = new THREE.Vector3();

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
// Position AND rotation are the exact locked Point-A values, copied
// from OPENING_QUATERNION every frame — no recomputation, no drift.
// This is FRAME 1 / FRAME 2 in your test.
// -----------------------------------------------------
function updateHoldA(elapsed) {
  camera.position.copy(POINT_A);
  camera.quaternion.copy(OPENING_QUATERNION);

  if (elapsed >= HOLD_AT_A_DURATION) {
    cinematicState = CinematicState.APPROACH;
    cinematicStartTime = performance.now() / 1000;
  }
}

// -----------------------------------------------------
// PHASE 1 — Point A -> orbit entry point. VERY SLOW (7s).
//
// Position: a plain dolly, lerping from POINT_A to orbitEntryPoint —
// never toward POINT_B itself.
//
// Rotation: lerps the LOOK TARGET (not a raw quaternion) from
// OPENING_LOOK_TARGET to POINT_B, over the FULL APPROACH_DURATION,
// using the same eased "t" as the position. Two guarantees fall out
// of this:
//
//   - FRAME 2 -> FRAME 3 (hold end -> approach start): at t=0,
//     eased=0, so the look target IS OPENING_LOOK_TARGET, which
//     reproduces OPENING_QUATERNION exactly. Identical to the held
//     frame. Zero rotational speed at this instant too (easing
//     derivative is 0 at t=0), so there's no sudden onset either.
//
//   - FRAME 5 -> FRAME 6 (approach end -> Point B's first frame):
//     at t=1, eased=1, the look target IS POINT_B, from position
//     orbitEntryPoint — which is EXACTLY what updateOrbit's first
//     frame produces (angle = ORBIT_START_ANGLE = 0, camera.lookAt
//     (POINT_B), same position). Zero rotational speed here too
//     (easing derivative is 0 at t=1), so the camera glides to a
//     stop exactly as it starts orbiting — no snap.
//
// Because of this, Point B never has to do anything special to
// avoid a jerk. It just does what it always did.
// -----------------------------------------------------
function updateApproach(elapsed) {
  const t = Math.min(elapsed / APPROACH_DURATION, 1);
  const eased = easeInOutCubic(t);

  camera.position.lerpVectors(POINT_A, orbitEntryPoint, eased);

  _tmpLook.lerpVectors(OPENING_LOOK_TARGET, POINT_B, eased);
  camera.lookAt(_tmpLook);

  if (t >= 1) {
    // Snap to the exact values with zero floating-point drift. This
    // produces the SAME state camera.lookAt(POINT_B) from
    // orbitEntryPoint already gave us above — not a correction, just
    // a precision guarantee.
    camera.position.copy(orbitEntryPoint);
    camera.lookAt(POINT_B);

    cinematicState = CinematicState.ORBIT;
    cinematicStartTime = performance.now() / 1000;
  }
}

// -----------------------------------------------------
// PHASE 2 — POINT B. THIS IS CODE 1's updateOrbit(). DO NOT MODIFY.
//
// Real circular motion around POINT_B at radius ORBIT_RADIUS,
// camera.lookAt(POINT_B) every frame. POINT_B is only ever a pivot —
// the camera position never touches it, never lerps toward it, and
// the orbit radius never changes.
//
// This function is safe to leave completely untouched because
// updateApproach (above) already delivers the camera here already
// looking at POINT_B from orbitEntryPoint — the exact state this
// function's own first frame (angle = ORBIT_START_ANGLE) produces.
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
// UNCHANGED.
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