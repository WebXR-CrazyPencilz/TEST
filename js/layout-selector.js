// =====================================================================
// layout-selector.js
//
// PHASE 2 — LAYOUT SELECTION SYSTEM (standalone module)
//
// Completely independent of the cinematic (Point A / Point B /
// Point C / HOLD_A / APPROACH / ORBIT / TOP_TRANSITION) code in
// main.js. It only needs the THREE namespace, the camera, and the
// OrbitControls instance, handed to it once via initLayoutSystem()
// (already wired up in main.js's finishCinematic()).
// =====================================================================

// ---------------------------------------------------------------------
// DEFAULT_TOP_VIEW_ROTATION_DEG — a small rotation applied to the
// default straight-down "up" vector so the site plan reads as
// straight/aligned instead of tilted. Positive = rotate right,
// negative = rotate left. Currently a small nudge left; adjust this
// one number and every layout using DEFAULT_TOP_VIEW_UP below follows
// it — increase the magnitude if it still looks tilted, flip the sign
// if it rotated the wrong way.
// ---------------------------------------------------------------------
const DEFAULT_TOP_VIEW_ROTATION_DEG = 12.5;

function buildTopViewUp(THREE, rotationDeg) {
  const rad = (rotationDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(rad), 0, -Math.cos(rad));
}

// ---------------------------------------------------------------------
// LAYOUTS — data-driven. Add a new entry here and it automatically
// appears in the UI panel and becomes selectable; no other code in
// this file needs to change. Fill in real position/target/fov values
// as they become available — the placeholders below (all zero
// vectors) are structural only.
//
// "up" (optional): controls ROLL — which direction is "up" on screen.
// Position + target only fix WHERE the camera is and WHAT it looks
// at; they say nothing about how the image is rotated around that
// view direction. For a straight-down top view, "up" is what decides
// whether the layout appears level/aligned or tilted. All layouts
// below default to DEFAULT_TOP_VIEW_UP (built from
// DEFAULT_TOP_VIEW_ROTATION_DEG above) — tweak that one constant to
// adjust every layout at once, or override "up" individually on a
// specific layout if it needs its own different alignment. If
// omitted entirely, the layout keeps whatever "up" the camera already
// had going into the transition (no forced roll).
// ---------------------------------------------------------------------
export const LAYOUTS = {};

function buildDefaultLayouts(THREE) {
  const DEFAULT_TOP_VIEW_UP = buildTopViewUp(THREE, DEFAULT_TOP_VIEW_ROTATION_DEG);

  return {
    overall: {
      label: "Overall",
      position: new THREE.Vector3(0, 358, 0),
      target: new THREE.Vector3(0, 0, 0),
      up: DEFAULT_TOP_VIEW_UP.clone(),
      fov: 75,
    },
    layout01: {
      label: "Layout 01",
      position: new THREE.Vector3(-16.20, 90, -155.27),
      target: new THREE.Vector3(-40.15, 0, -155.27),
      up: DEFAULT_TOP_VIEW_UP.clone(),
      fov: 75,
    },
    layout02: {
      label: "Layout 02",
      position: new THREE.Vector3(0, 0, 0), // TODO: provide real value
      target: new THREE.Vector3(0, 0, 0),   // TODO: provide real value
      up: DEFAULT_TOP_VIEW_UP.clone(),
      fov: 75,
    },
    layout03: {
      label: "Layout 03",
      position: new THREE.Vector3(0, 0, 0), // TODO: provide real value
      target: new THREE.Vector3(0, 0, 0),   // TODO: provide real value
      up: DEFAULT_TOP_VIEW_UP.clone(),
      fov: 75,
    },
    layout04: {
      label: "Layout 04",
      position: new THREE.Vector3(0, 0, 0), // TODO: provide real value
      target: new THREE.Vector3(0, 0, 0),   // TODO: provide real value
      up: DEFAULT_TOP_VIEW_UP.clone(),
      fov: 75,
    },
    layout05: {
      label: "Layout 05",
      position: new THREE.Vector3(0, 0, 0), // TODO: provide real value
      target: new THREE.Vector3(0, 0, 0),   // TODO: provide real value
      up: DEFAULT_TOP_VIEW_UP.clone(),
      fov: 75,
    },
    layout06: {
      label: "Layout 06",
      position: new THREE.Vector3(0, 0, 0), // TODO: provide real value
      target: new THREE.Vector3(0, 0, 0),   // TODO: provide real value
      up: DEFAULT_TOP_VIEW_UP.clone(),
      fov: 75,
    },
  };
}

// ---------------------------------------------------------------------
// LAYOUT_TRANSITION_DURATION — seconds, within the requested 1.5–2s.
// ---------------------------------------------------------------------
const LAYOUT_TRANSITION_DURATION = 1.75;

function easeInOutCubic(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ---------------------------------------------------------------------
// Module-scoped state. Populated by initLayoutSystem(); nothing here
// runs before that's called.
// ---------------------------------------------------------------------
let _THREE = null;
let _camera = null;
let _controls = null;

let _layoutFromPosition = null;
let _layoutFromTarget = null;
let _layoutFromUp = null;
let _layoutFromFov = null;
let _layoutTmpLook = null;

let layoutTransitionActive = false;
let layoutTransitionStartTime = null;
let currentLayoutKey = null;
let pendingLayoutKey = null;

// -----------------------------------------------------
// isLayoutTransitionActive — call this from your render loop to
// decide whether to run updateLayoutSystem() this frame instead of
// your own controls.update().
// -----------------------------------------------------
export function isLayoutTransitionActive() {
  return layoutTransitionActive;
}

// -----------------------------------------------------
// initLayoutSystem — call exactly once, after your cinematic reaches
// its INTERACTIVE state. Builds the LAYOUTS data (now that THREE is
// available) and creates the bottom-left UI panel with plain DOM
// elements — no HTML file is touched.
// -----------------------------------------------------
export function initLayoutSystem({ THREE, camera, controls }) {
  _THREE = THREE;
  _camera = camera;
  _controls = controls;

  _layoutFromPosition = new THREE.Vector3();
  _layoutFromTarget = new THREE.Vector3();
  _layoutFromUp = new THREE.Vector3();
  _layoutFromFov = camera.fov;
  _layoutTmpLook = new THREE.Vector3();

  if (Object.keys(LAYOUTS).length === 0) {
    Object.assign(LAYOUTS, buildDefaultLayouts(THREE));
  }

  createLayoutUI();
}

// -----------------------------------------------------
// startLayoutTransition — captures the camera's CURRENT state (not
// the previous layout's stored state, so this is correct even if the
// user manually orbited/panned/zoomed after arriving at a layout) and
// begins a single, direct transition to the requested layout. Never
// chains through any other layout.
// -----------------------------------------------------
export function startLayoutTransition(key) {
  const layout = LAYOUTS[key];
  if (!layout) return;
  if (layoutTransitionActive && pendingLayoutKey === key) return;

  _layoutFromPosition.copy(_camera.position);
  _layoutFromTarget.copy(_controls.target);
  _layoutFromUp.copy(_camera.up);
  _layoutFromFov = _camera.fov;

  pendingLayoutKey = key;
  layoutTransitionActive = true;
  layoutTransitionStartTime = performance.now() / 1000;

  _controls.enabled = false;
}

// -----------------------------------------------------
// updateLayoutSystem — call once per frame (with the current time in
// seconds) while isLayoutTransitionActive() is true. Position is
// lerped; rotation is derived via lookAt() at the real interpolated
// position every frame (never a mismatched reference point), so
// rotation stays coupled to where the camera actually is throughout.
// FOV is lerped if the target layout specifies a different one.
// Stops exactly at the layout — does not continue anywhere else.
// -----------------------------------------------------
export function updateLayoutSystem(nowSeconds) {
  if (!layoutTransitionActive) return;

  const layout = LAYOUTS[pendingLayoutKey];
  const elapsed = nowSeconds - layoutTransitionStartTime;
  const t = Math.min(elapsed / LAYOUT_TRANSITION_DURATION, 1);
  const eased = easeInOutCubic(t);

  _camera.position.lerpVectors(_layoutFromPosition, layout.position, eased);

  // "up" controls roll. If the layout doesn't specify one, hold the
  // up vector the camera already had (no forced roll change). Set it
  // BEFORE calling lookAt() — lookAt() reads camera.up to compute the
  // final orientation, so order matters here.
  const targetUp = layout.up || _layoutFromUp;
  _camera.up.lerpVectors(_layoutFromUp, targetUp, eased).normalize();

  _layoutTmpLook.lerpVectors(_layoutFromTarget, layout.target, eased);
  _camera.lookAt(_layoutTmpLook);

  if (typeof layout.fov === "number" && layout.fov !== _layoutFromFov) {
    _camera.fov = _THREE.MathUtils.lerp(_layoutFromFov, layout.fov, eased);
    _camera.updateProjectionMatrix();
  }

  if (t >= 1) {
    _camera.position.copy(layout.position);
    _camera.up.copy(targetUp).normalize();
    _camera.lookAt(layout.target);

    if (typeof layout.fov === "number") {
      _camera.fov = layout.fov;
      _camera.updateProjectionMatrix();
    }

    _controls.target.copy(layout.target);
    _controls.enabled = true;
    _controls.update();

    layoutTransitionActive = false;
    currentLayoutKey = pendingLayoutKey;
    pendingLayoutKey = null;

    updateLayoutUIHighlight();
  }
}

// -----------------------------------------------------
// createLayoutUI — builds the bottom-left panel purely at runtime.
// Buttons are generated from LAYOUTS, so adding a new layout entry to
// the data object is the only step needed to add a new button.
// -----------------------------------------------------
function createLayoutUI() {
  if (document.getElementById("layout-ui-panel")) return;

  const panel = document.createElement("div");
  panel.id = "layout-ui-panel";
  Object.assign(panel.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    padding: "12px 14px",
    background: "rgba(20, 20, 20, 0.75)",
    backdropFilter: "blur(6px)",
    borderRadius: "10px",
    fontFamily: "system-ui, sans-serif",
    color: "#fff",
    zIndex: "1000",
    minWidth: "160px",
    boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
  });

  const title = document.createElement("div");
  title.textContent = "LAYOUTS";
  Object.assign(title.style, {
    fontSize: "11px",
    letterSpacing: "1px",
    opacity: "0.6",
    marginBottom: "8px",
  });
  panel.appendChild(title);

  const list = document.createElement("div");
  list.id = "layout-ui-list";
  Object.assign(list.style, {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  });
  panel.appendChild(list);

  Object.keys(LAYOUTS).forEach(function (key) {
    const layout = LAYOUTS[key];

    const btn = document.createElement("button");
    btn.dataset.layoutKey = key;
    btn.textContent = layout.label || key;
    Object.assign(btn.style, {
      display: "block",
      width: "100%",
      textAlign: "left",
      padding: "6px 10px",
      border: "none",
      borderRadius: "6px",
      background: "transparent",
      color: "#fff",
      cursor: "pointer",
      fontSize: "13px",
      fontFamily: "inherit",
    });

    btn.addEventListener("click", function () {
      if (currentLayoutKey === key && !layoutTransitionActive) return;
      startLayoutTransition(key);
    });

    list.appendChild(btn);
  });

  document.body.appendChild(panel);

  updateLayoutUIHighlight();
}

// -----------------------------------------------------
// updateLayoutUIHighlight — marks the currently active layout's
// button. Called once a transition completes.
// -----------------------------------------------------
function updateLayoutUIHighlight() {
  const list = document.getElementById("layout-ui-list");
  if (!list) return;

  Array.from(list.children).forEach(function (btn) {
    const isActive = btn.dataset.layoutKey === currentLayoutKey;
    btn.style.background = isActive ? "rgba(255,255,255,0.15)" : "transparent";
    btn.style.fontWeight = isActive ? "600" : "400";
  });
}