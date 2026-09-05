// =====================================================
// IMPORTS
// =====================================================

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  initLayoutSystem,
  updateLayoutSystem,
  isLayoutTransitionActive,
} from "./layout-selector.js";
import { initAxisGizmo, renderAxisGizmo } from "./axis-gizmo.js";
import { initPlotStatusSync } from "./plot-status-sync.js";
import { initGalleryAmenities } from "./gallery-amenities.js";
import { initStreetView, updateStreetView, renderStreetViewInset } from "./street-view.js";

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
// POINT A — THE ONLY STARTING CAMERA POSITION.
// ---------------------------------------------------------------------
const POINT_A = new THREE.Vector3(
  -191.31,
  4,
  258.59
);

// ---------------------------------------------------------------------
// POINT B — ORBIT CENTER (NOT a camera position). UNTOUCHED.
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
  358,
  0
);

// =====================================================================
// POINT A ROTATION — the left-facing opening composition.
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

const HOLD_AT_A_DURATION = 1.5;
const APPROACH_DURATION = 7.0;
const ORBIT_DURATION = 3.5;
const TOP_TRANSITION_DURATION = 5.0;

// ---------------------------------------------------------------------
// TOP_VIEW_UP — locks roll for the final straight-down shot.
// ---------------------------------------------------------------------
const TOP_VIEW_UP = new THREE.Vector3(0, 0, -1);

const CAMERA_FOV_DEG = 75;

// ---------------------------------------------------------------------
// SHEET_WEB_APP_URL — the deployed Google Apps Script Web App URL
// (ends in /exec). See Code.gs for the backend and its deployment
// steps. Plot status syncing is skipped with a console warning until
// this is filled in.
// ---------------------------------------------------------------------
const SHEET_WEB_APP_URL = "https://script.google.com/macros/s/AKfycby9zrmjaSxdHULdLXejoSvDVKD6BXxIoek_JS-mS5QFULoswOT6J8HWAiQ8-hBD9lrf/exec"; // TODO: paste your deployed Web App URL here

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
// OPENING_QUATERNION — Point A's permanent, locked orientation.
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
// camera.lookAt(OPENING_LOOK_TARGET) FROM POINT_A reproduces
// OPENING_QUATERNION exactly.
// ---------------------------------------------------------------------
const OPENING_LOOK_TARGET = (function computeOpeningLookTargetFromQuaternion() {
  const forward = new THREE.Vector3(0, 0, -1)
    .applyQuaternion(OPENING_QUATERNION)
    .normalize();
  return POINT_A.clone().addScaledVector(forward, 100);
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
// AXIS ORIENTATION GIZMO — visual aid only, corner overlay.
// =====================================================

initAxisGizmo({ THREE, renderer, camera });

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

  // Phase 2 begins only now that the cinematic has reached
  // INTERACTIVE — hand the camera/controls to the layout system once.
  initLayoutSystem({ THREE, camera, controls });

  // Street View depends on LAYOUTS already being populated by
  // initLayoutSystem() above, so it's initialized right after.
  initStreetView({ THREE, camera, controls, scene, renderer });
}

// -----------------------------------------------------
// PHASE 0 — hold static at Point A before moving.
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
// -----------------------------------------------------
function updateApproach(elapsed) {
  const t = Math.min(elapsed / APPROACH_DURATION, 1);
  const eased = easeInOutCubic(t);

  camera.position.lerpVectors(POINT_A, orbitEntryPoint, eased);

  _tmpLook.lerpVectors(OPENING_LOOK_TARGET, POINT_B, eased);
  camera.lookAt(_tmpLook);

  if (t >= 1) {
    camera.position.copy(orbitEntryPoint);
    camera.lookAt(POINT_B);

    cinematicState = CinematicState.ORBIT;
    cinematicStartTime = performance.now() / 1000;
  }
}

// -----------------------------------------------------
// PHASE 2 — POINT B / ORBIT. UNCHANGED.
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

// =====================================================================
// =====================================================================
//
//   PHASE 1 (INVENTORY) — GLB OBJECT / PLOT INVENTORY
//
//   Pure debug/inspection tooling. Does not touch materials, colors,
//   the camera, controls, or click-to-pick. Traverses the ENTIRE
//   loaded GLB hierarchy (every object, not just meshes, not just top
//   level), reports each one, and exposes them by name on
//   window.GLB_OBJECTS for later phases to look up by Plot ID.
//
// =====================================================================
// =====================================================================

let _glbInventoryCache = null;

// -----------------------------------------------------
// buildGlbInventory — walks the full hierarchy with model.traverse(),
// recording every object (mesh or not, visible or not, any depth).
// Also populates window.GLB_OBJECTS[name] = object for every named
// object, so later phases can map "Plot ID from a spreadsheet" ->
// "this exact Three.js object" -> "its material".
// -----------------------------------------------------
function buildGlbInventory(model) {
  const inventory = [];
  window.GLB_OBJECTS = {};

  model.traverse(function (object) {
    const entry = {
      name: object.name || "(unnamed)",
      type: object.type,
      parent: object.parent ? (object.parent.name || "(unnamed)") : null,
      isMesh: !!object.isMesh,
      meshDataName:
        object.isMesh && object.geometry
          ? object.geometry.name || "(unnamed geometry)"
          : null,
      position: object.position.clone(),
      rotation: object.rotation.clone(),
      scale: object.scale.clone(),
    };

    inventory.push(entry);

    if (object.name) {
      window.GLB_OBJECTS[object.name] = object;
    }
  });

  return inventory;
}

// -----------------------------------------------------
// printGlbInventory — formatted console report of a previously built
// inventory. Separated from buildGlbInventory() so window.printGLBObjects()
// can re-print without re-traversing the model.
// -----------------------------------------------------
function printGlbInventory(inventory) {
  const totalObjects = inventory.length;
  const totalMeshObjects = inventory.filter(function (entry) {
    return entry.isMesh;
  }).length;

  console.log("====================================================");
  console.log("GLB OBJECT INVENTORY");
  console.log("====================================================");
  console.log("");
  console.log("TOTAL OBJECTS: " + totalObjects);
  console.log("TOTAL MESH OBJECTS: " + totalMeshObjects);
  console.log("");

  inventory.forEach(function (entry) {
    console.log("----------------------------------------------------");
    console.log("OBJECT: " + entry.name);
    console.log("TYPE: " + entry.type);
    console.log("PARENT: " + (entry.parent || "(none)"));
    console.log("IS MESH: " + entry.isMesh);
    console.log("MESH DATA: " + (entry.meshDataName || "(none)"));
    console.log(
      "POSITION: x=" + entry.position.x.toFixed(3) +
      ", y=" + entry.position.y.toFixed(3) +
      ", z=" + entry.position.z.toFixed(3)
    );
    console.log(
      "ROTATION (deg): x=" + THREE.MathUtils.radToDeg(entry.rotation.x).toFixed(2) +
      ", y=" + THREE.MathUtils.radToDeg(entry.rotation.y).toFixed(2) +
      ", z=" + THREE.MathUtils.radToDeg(entry.rotation.z).toFixed(2)
    );
    console.log(
      "SCALE: x=" + entry.scale.x.toFixed(3) +
      ", y=" + entry.scale.y.toFixed(3) +
      ", z=" + entry.scale.z.toFixed(3)
    );
  });

  console.log("----------------------------------------------------");
  console.log("");

  const allNames = inventory.map(function (entry) {
    return entry.name;
  });

  console.log("ALL OBJECT NAMES:");
  console.log(JSON.stringify(allNames, null, 2));
}

// window.printGLBObjects() — callable from the browser console at any
// time after load, re-prints the same cached inventory without
// re-traversing the model.
window.printGLBObjects = function () {
  if (!_glbInventoryCache) {
    console.log("GLB inventory not built yet — model may still be loading.");
    return;
  }
  printGlbInventory(_glbInventoryCache);
};

// -----------------------------------------------------
// naturalSortNames — sorts numeric-looking names ("1", "2", ... "10")
// in numeric order instead of alphabetical (which would otherwise put
// "10" before "2"). Falls back to plain string comparison for
// anything non-numeric.
// -----------------------------------------------------
function naturalSortNames(names) {
  return names.slice().sort(function (a, b) {
    const an = Number(a);
    const bn = Number(b);
    if (!isNaN(an) && !isNaN(bn)) return an - bn;
    return a.localeCompare(b);
  });
}

// -----------------------------------------------------
// window.copyPlotIdsForSheet() — copies every named GLB object's name
// (one per line, numerically sorted, "Scene" root excluded) straight
// to the clipboard. Click cell A2 in your Google Sheet and paste —
// Sheets fills them down column A automatically, one per row. This is
// the exact list from the loaded model, so there's no risk of typos
// or missed entries from copying a partial console printout by hand.
// -----------------------------------------------------
// -----------------------------------------------------
// isPlotIdInRange — true only for names that are PURE integers (no
// extra characters, e.g. "141" passes, "Circle012001" and
// "Mesh.007" don't) between 1 and 600 inclusive. Everything else
// (decorative circles, mesh data names, etc.) is ignored for now —
// change PLOT_ID_MIN/PLOT_ID_MAX below if the real range changes, or
// remove this filter entirely once every object needs including.
// -----------------------------------------------------
const PLOT_ID_MIN = 1;
const PLOT_ID_MAX = 600;

function isPlotIdInRange(name) {
  if (!/^\d+$/.test(name)) return false; // must be ONLY digits, nothing else
  const n = Number(name);
  return n >= PLOT_ID_MIN && n <= PLOT_ID_MAX;
}

window.copyPlotIdsForSheet = function () {
  if (!window.GLB_OBJECTS) {
    console.warn("[copyPlotIdsForSheet] window.GLB_OBJECTS not found yet — model may still be loading.");
    return;
  }

  const names = naturalSortNames(
    Object.keys(window.GLB_OBJECTS).filter(isPlotIdInRange)
  );
  const text = names.join("\n");

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(function () {
        console.log(
          "[copyPlotIdsForSheet] Copied " + names.length +
          " plot ID(s) (1–600 only) to the clipboard. Click cell A2 in your sheet and paste (Ctrl+V)."
        );
      })
      .catch(function (err) {
        console.error("[copyPlotIdsForSheet] Clipboard copy failed — printing the list instead:", err);
        console.log(text);
      });
  } else {
    console.log("[copyPlotIdsForSheet] Clipboard API unavailable — here's the list to copy manually:");
    console.log(text);
  }
};

// -----------------------------------------------------
// On-page "Copy Plot IDs" button — a click-triggered alternative to
// typing copyPlotIdsForSheet() in the DevTools console. A real click
// is also a genuine user gesture, which the Clipboard API sometimes
// requires more reliably than a command run from the console.
// Bottom-left corner, out of the way of the layout panel (bottom-right).
// -----------------------------------------------------
function createCopyPlotIdsButton() {
  if (document.getElementById("copy-plot-ids-btn")) return;

  const btn = document.createElement("button");
  btn.id = "copy-plot-ids-btn";
  btn.textContent = "Copy Plot IDs";
  Object.assign(btn.style, {
    position: "fixed",
    left: "16px",
    top: "16px",
    padding: "8px 14px",
    background: "rgba(20, 20, 20, 0.75)",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontFamily: "system-ui, sans-serif",
    fontSize: "13px",
    cursor: "pointer",
    zIndex: "1000",
    boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
  });

  const defaultLabel = "Copy Plot IDs";

  btn.addEventListener("click", function () {
    window.copyPlotIdsForSheet();
    btn.textContent = "Copied!";
    setTimeout(function () {
      btn.textContent = defaultLabel;
    }, 1500);
  });

  document.body.appendChild(btn);
}

createCopyPlotIdsButton();

// =====================================================
// GALLERY + AMENITIES BUTTONS (top-left, below Copy Plot IDs)
// =====================================================

initGalleryAmenities();

// =====================================================
// GLTF / GLB LOADER
// =====================================================

const loader = new GLTFLoader();
let loadedModel = null;

loader.load(
  "./test1.glb",

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

    // ---- PHASE 1 (INVENTORY): build + print the full object list ----
    _glbInventoryCache = buildGlbInventory(model);
    printGlbInventory(_glbInventoryCache);

    // ---- PHASE 2: sync plot status from the Google Sheet ----
    if (SHEET_WEB_APP_URL) {
      initPlotStatusSync({ sheetUrl: SHEET_WEB_APP_URL, pollIntervalMs: 30 * 1000 });
    } else {
      console.warn(
        "[plot-status-sync] SHEET_WEB_APP_URL is empty — skipping sync. " +
        "Paste your deployed Apps Script Web App URL into main.js."
      );
    }

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
    // The main camera's own controls run exactly as before,
    // completely unaffected by street view — a tour plays in its own
    // separate inset camera/window and never touches this.
    if (isLayoutTransitionActive()) {
      updateLayoutSystem(now);
    } else {
      controls.update();
    }
  }

  // Independently advance the street-view tour if one is playing —
  // this only ever moves the separate street camera, never the main
  // one above.
  updateStreetView(now);

  updateCameraDebugOverlay();

  renderer.render(scene, camera);
  renderAxisGizmo();
  // Drawn AFTER the main render so the inset window sits on top of
  // (never instead of) the main view. No-ops when no street-view
  // session is active.
  renderStreetViewInset();
}

animate();