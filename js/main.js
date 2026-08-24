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
//   CINEMATIC CAMERA SETTINGS
//   EDIT THESE VALUES MANUALLY — nothing here is auto-calculated.
//
// =====================================================================
// =====================================================================

// ---------------------------------------------------------------------
// POINT A — STARTING CAMERA POSITION
// The cinematic camera begins here. Low, dramatic angle recommended.
// The camera looks toward Point B when the cinematic starts.
// ---------------------------------------------------------------------
const POINT_A = new THREE.Vector3(
  -173.94,  // X
  -6.06,    // Y
  248.77    // Z
);

// ---------------------------------------------------------------------
// POINT B — ORBIT CENTER (NOT a camera position)
// This is the pivot the camera circles around in Phase 2.
// The camera moves toward the "Point B area" in Phase 1, then orbits
// around this point at ORBIT_RADIUS instead of passing through it.
// ---------------------------------------------------------------------
const POINT_B = new THREE.Vector3(
  139.22,  // X
  5.25,   // Y
  39    // Z
);

// ---------------------------------------------------------------------
// POINT C — FINAL TOP VIEW CAMERA POSITION
// The camera slowly floats here after the orbit finishes.
// This should be a true bird's-eye position above the model.
//
// Y controls zoom level: this is a straight height, NOT calculated
// from the model's bounding box, so if the top view looks too zoomed
// in, just raise this number until the full site fits comfortably.
// ---------------------------------------------------------------------
const POINT_C = new THREE.Vector3(
  0,    // X
  650,  // Y — increase to zoom out, decrease to zoom in
  0     // Z
);

// ---------------------------------------------------------------------
// TOP_VIEW_UP — locks the camera's roll for the final straight-down
// shot. Three.js's lookAt() becomes unstable when looking perfectly
// vertical, which can rotate the final view to a random angle. This
// vector pins "up" on screen to world -Z (north) so the top view
// always lands aligned instead of tilted.
// ---------------------------------------------------------------------
const TOP_VIEW_UP = new THREE.Vector3(0, 0, -1);

// ---------------------------------------------------------------------
// ORBIT SETTINGS (Phase 2 — circular movement around POINT_B)
// ---------------------------------------------------------------------
const ORBIT_RADIUS = 20;               // distance from POINT_B while orbiting
const ORBIT_START_ANGLE = 0;           // radians
const ORBIT_END_ANGLE = Math.PI * 1.0; // radians (Math.PI * 1.0 ≈ 180°)
const ORBIT_HEIGHT_OFFSET = 4;         // camera height above POINT_B.y during orbit

// ---------------------------------------------------------------------
// TIMING (seconds) — edit freely, phases use these directly
// ---------------------------------------------------------------------
const APPROACH_DURATION = 2.5;        // Phase 1: A -> B area
const ORBIT_DURATION = 3.5;           // Phase 2: circular orbit around B
const TOP_TRANSITION_DURATION = 3.5;  // Phase 3: orbit -> C

// =====================================================================
// END OF EDITABLE CINEMATIC SETTINGS
// =====================================================================

// =====================================================
// SCENE
// =====================================================

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeeeeee);

// =====================================================
// CAMERA
// =====================================================

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.01,
  10000
);

// Camera starts at Point A, looking toward Point B, immediately on page load.
camera.position.copy(POINT_A);
camera.lookAt(POINT_B);

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
  APPROACH: "APPROACH",             // Phase 1: A -> B area
  ORBIT: "ORBIT",                   // Phase 2: circular orbit around B
  TOP_TRANSITION: "TOP_TRANSITION", // Phase 3: orbit -> C
  INTERACTIVE: "INTERACTIVE",
};

let cinematicState = CinematicState.APPROACH;
let cinematicStartTime = null; // performance.now()/1000 when current phase began
let cinematicActive = false;

// Point on the orbit circle where Phase 1 ends / Phase 2 begins.
// Computed once, when the cinematic starts, from ORBIT_START_ANGLE.
let orbitEntryPoint = null;

// Point on the orbit circle where Phase 2 ends / Phase 3 begins.
// Computed once, from ORBIT_END_ANGLE.
let orbitExitPoint = null;

// Reused vectors (avoid per-frame allocation).
const _tmpPos = new THREE.Vector3();

// -----------------------------------------------------
// Compute a point on the orbit circle around POINT_B
// for a given angle.
// -----------------------------------------------------
function getOrbitPoint(angle, target) {
  const x = POINT_B.x + ORBIT_RADIUS * Math.cos(angle);
  const z = POINT_B.z + ORBIT_RADIUS * Math.sin(angle);
  const y = POINT_B.y + ORBIT_HEIGHT_OFFSET;
  return target.set(x, y, z);
}

function startCinematic() {
  orbitEntryPoint = getOrbitPoint(ORBIT_START_ANGLE, new THREE.Vector3());
  orbitExitPoint = getOrbitPoint(ORBIT_END_ANGLE, new THREE.Vector3());

  cinematicState = CinematicState.APPROACH;
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
// PHASE 1 — A -> B area (approach the orbit entry point)
// -----------------------------------------------------
function updateApproach(elapsed) {
  const t = Math.min(elapsed / APPROACH_DURATION, 1);
  const eased = easeInOutCubic(t);

  _tmpPos.lerpVectors(POINT_A, orbitEntryPoint, eased);
  camera.position.copy(_tmpPos);
  camera.lookAt(POINT_B);

  if (t >= 1) {
    cinematicState = CinematicState.ORBIT;
    cinematicStartTime = performance.now() / 1000;
  }
}

// -----------------------------------------------------
// PHASE 2 — circular orbit around POINT_B
// True circular motion: camera travels along the circle of
// radius ORBIT_RADIUS centered on POINT_B, never cutting
// through the center point.
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
// PHASE 3 — orbit exit point -> POINT_C (slow float to top view)
// Height rises and horizontal distance closes smoothly while
// the look target eases from POINT_B toward the model center.
// -----------------------------------------------------
function updateTopTransition(elapsed) {
  const t = Math.min(elapsed / TOP_TRANSITION_DURATION, 1);
  const eased = easeInOutCubic(t);

  _tmpPos.lerpVectors(orbitExitPoint, POINT_C, eased);
  camera.position.copy(_tmpPos);

  // Look target eases from Point B toward the world origin so the
  // final frame looks straight down, matching a true top view.
  const lookTarget = new THREE.Vector3().lerpVectors(
    POINT_B,
    new THREE.Vector3(0, 0, 0),
    eased
  );

  // Lock the camera's "up" direction toward world -Z (north) as the
  // view approaches straight-down. Without this, lookAt() near-vertical
  // becomes unstable and the final top view can land at a random,
  // tilted roll angle instead of a clean north-aligned top-down shot.
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
let loadedModel = null; // kept for raycast point-picking (see click picker below)

loader.load(
  "./test.glb",

  // ---------------------------------------------------
  // ON LOAD
  // ---------------------------------------------------
  function (gltf) {
    const model = gltf.scene;
    scene.add(model);
    loadedModel = model;

    // Enable shadows on all meshes.
    model.traverse(function (object) {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    // Bounding box is still calculated (for centering / controls
    // limits / near-far planes) but it never touches POINT_A,
    // POINT_B or POINT_C — those stay exactly as set above.
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());

    model.position.x -= center.x;
    model.position.y -= center.y;
    model.position.z -= center.z;

    const centeredBox = new THREE.Box3().setFromObject(model);
    const centeredSize = centeredBox.getSize(new THREE.Vector3());
    const maxSize = Math.max(centeredSize.x, centeredSize.y, centeredSize.z);

    // ---- Log real model dimensions so POINT_C can be sized correctly ----
    const fovRadiansForLog = THREE.MathUtils.degToRad(camera.fov);
    const suggestedTopY =
      ((maxSize / 2) / Math.tan(fovRadiansForLog / 2)) * 1.3;

    console.log("================================");
    console.log("MODEL BOUNDING BOX SIZE:", centeredSize);
    console.log("LARGEST DIMENSION:", maxSize);
    console.log("Suggested POINT_C.y (comfortable top view):", suggestedTopY);
    console.log("Current POINT_C.y is:", POINT_C.y);
    console.log("================================");

    // Reasonable near/far + orbit-control distance limits based on
    // model scale, purely for render quality and post-cinematic
    // interaction — not used anywhere in the A/B/C cinematic path.
    camera.near = Math.max(maxSize / 1000, 0.01);
    camera.far = Math.max(POINT_C.length(), maxSize) * 20;
    camera.updateProjectionMatrix();

    controls.minDistance = Math.max(maxSize * 0.05, 0.1);
    controls.maxDistance = Math.max(POINT_C.length() * 4, maxSize * 10);

    // ---- Fade out loading screen, then begin cinematic ----
    loadingScreenEl.classList.add("fade-out");
    setTimeout(function () {
      loadingScreenEl.style.display = "none";
      startCinematic();
    }, 500);
  },

  // ---------------------------------------------------
  // PROGRESS
  // ---------------------------------------------------
  function (xhr) {
    if (xhr.total > 0) {
      const percent = (xhr.loaded / xhr.total) * 100;
      const clamped = Math.min(percent, 100).toFixed(0);
      loadingPercentEl.textContent = "Loading model... " + clamped + "%";
      loadingBarFillEl.style.width = clamped + "%";
    }
  },

  // ---------------------------------------------------
  // ERROR
  // ---------------------------------------------------
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
// Shows live position (world units) and rotation (degrees)
// every frame, plus which cinematic phase is currently active.
// Toggle with the "D" key.
// =====================================================

let debugOverlayVisible = true;

window.addEventListener("keydown", function (e) {
  if (e.key === "d" || e.key === "D") {
    debugOverlayVisible = !debugOverlayVisible;
    cameraDebugEl.style.display = debugOverlayVisible ? "block" : "none";
  }
});

function updateCameraDebugOverlay() {
  if (!debugOverlayVisible) return;

  const p = camera.position;
  const r = camera.rotation; // radians
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
// CLICK-TO-PICK: log exact 3D world coordinates of whatever
// you click on the model (e.g. the flag), so you can copy them
// straight into POINT_B / POINT_A / POINT_C above.
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

    // Also flash it briefly in the on-screen debug overlay.
    lastPickedPoint = point.clone();
    pickedPointFlashUntil = performance.now() / 1000 + 3;
  }
});

let lastPickedPoint = null;
let pickedPointFlashUntil = 0;

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