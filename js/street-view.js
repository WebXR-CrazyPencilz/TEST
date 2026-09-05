// =====================================================================
// street-view.js
//
// PHASE 3 — STREET VIEW FLYTHROUGH (standalone module)
//
// Adds a "STREETS" panel (top-right, below the axis gizmo) that
// appears whenever a layout with defined streets is selected in the
// layout panel. It lists one button per street — "Street 1", "Street
// 2", "Street 3", etc. — and clicking one auto-plays a SEPARATE
// dedicated camera along JUST that street, shown in a small inset
// window (vertically centered on the left edge of the screen) that
// sits on top of the main view. The main camera/view (the big map)
// is never touched — it keeps showing exactly whatever the user was
// looking at, unaffected, for the whole tour.
//
// The tour itself: a smoothly curved path through the street's
// waypoints out to the far end, easing through every bend along the
// way (including the far end and, for a street with a bend, the
// corner in between), then back to the start the same way (a round
// trip) — looking toward the plots on the right side of travel the
// whole time (or the left, if that street sets lookSide: "left"),
// consistently on both legs. When the tour ends (back at the start),
// the inset camera just holds there on the final frame; an "Exit
// Street View" row at the bottom of the panel closes the inset window
// at any time, mid-tour or after.
//
// Depends on layout-selector.js only for two small, already-exported
// hooks (onLayoutChanged, LAYOUTS) — it never reaches into the
// cinematic or plot-sync code, and never moves the main camera.
//
// INTEGRATION — in your main.js:
//
//   import {
//     initStreetView,
//     isStreetViewActive,
//     updateStreetView,
//     renderStreetViewInset,
//   } from "./street-view.js";
//
//   // once, right after initLayoutSystem(...) is called inside
//   // finishCinematic() (needs the THREE.Scene and the WebGLRenderer
//   // in addition to camera/controls, so the inset can render into
//   // its own small viewport):
//   initStreetView({ THREE, camera, controls, scene, renderer });
//
//   // inside animate(): the main camera's own controls run exactly
//   // as before, completely unaffected by street view —
//   if (isLayoutTransitionActive()) {
//     updateLayoutSystem(now);
//   } else {
//     controls.update();
//   }
//   // ...then, independently, advance the street-view tour if one is
//   // playing (this only ever touches the separate street camera):
//   updateStreetView(now);
//
//   // after your main renderer.render(scene, camera) call, draw the
//   // inset window on top (no-ops when no tour session is active):
//   renderer.render(scene, camera);
//   renderStreetViewInset();
//
// DEFINING STREETS — the simplest way in is STREET_DEFINITIONS
// further down this file: list each street as a left line and a
// right line (real X,Z coordinates for both sides of the road). Each
// entry in that list becomes its own "Street N" button — see the
// comment above STREET_DEFINITIONS for the exact format.
//
// If you'd rather place raw 3D waypoints directly instead, STREET_PATHS
// (also below) takes a plain object keyed by the SAME layout keys as
// LAYOUTS in layout-selector.js (e.g. "layout01"), each value an array
// of THREE.Vector3 waypoints in travel order — this shows up as a
// single "Street 1" button covering the whole path. Placeholder loops
// are generated automatically for every layout so the panel has
// something to show immediately, from either source:
//
//   1. Run the site, click "D" to confirm the debug overlay is on.
//   2. Click anywhere on the loaded model — the exact world position
//      is logged to the console (this uses the click-to-pick tool
//      already built into main.js).
//   3. Walk each street's left and right edges in your head, clicking
//      a couple of points along each (a height of 2-4 units above the
//      ground plane usually reads as eye-level).
//   4. Paste those [x, z] pairs into that layout's STREET_DEFINITIONS
//      entries below, one object per street.
//
// A layout with no usable streets simply never shows the panel —
// nothing else needs to change.
// =====================================================================

import { onLayoutChanged, LAYOUTS } from "./layout-selector.js";

// ---------------------------------------------------------------------
// STREET_VIEW_SPEED — world units per second the camera travels along
// a street. Tours pace themselves by street length / this speed, so a
// longer street naturally takes longer rather than feeling rushed.
// ---------------------------------------------------------------------
const STREET_VIEW_SPEED = 6; // was 12 — slowed down

// ---------------------------------------------------------------------
// STREET_VIEW_EYE_HEIGHT — the Y (height) every street point is given
// automatically, since STREET_DEFINITIONS below only takes flat X,Z
// coordinates. Raise/lower this if the tour reads too low/high off
// the ground.
// ---------------------------------------------------------------------
const STREET_VIEW_EYE_HEIGHT = -3.82; // was -5.82 (ground click height) — raised ~2 units for a more natural eye-level view

// ---------------------------------------------------------------------
// STREET_VIEW_SIDE_LOOK — how much the camera angles toward the RIGHT
// side of the street (relative to travel direction) while touring,
// instead of looking straight down the road. 0 = look purely along
// the direction of travel; 1 = look purely to the right (perpendicular
// to travel). A value in between keeps some forward lean so the
// motion still reads naturally while favoring a view of the plots on
// the right.
// ---------------------------------------------------------------------
const STREET_VIEW_SIDE_LOOK = 0.7;

// ---------------------------------------------------------------------
// STREET_VIEW_LOOK_DISTANCE — how far the look-target sits from the
// camera along the look direction. Must comfortably exceed whatever
// OrbitControls.minDistance ends up being (main.js sets it dynamically
// from the model's size) — otherwise, when a tour hands control back
// to OrbitControls at the end, it clamps the camera back out to
// minDistance away from too-close a target, causing a visible jump.
// The direction is all that matters for camera.lookAt() during the
// tour itself; this only needs to be "far enough" to be safe.
// ---------------------------------------------------------------------
const STREET_VIEW_LOOK_DISTANCE = 50;

// ---------------------------------------------------------------------
// STREET_VIEW_TURN_RADIUS — no longer used (the round trip now goes
// straight out and straight back, not through a curved bulge). Left
// here in case a curved turnaround is wanted again later.
// ---------------------------------------------------------------------
const STREET_VIEW_TURN_RADIUS = 8;

// ---------------------------------------------------------------------
// STREET_VIEW_Y_SLOWDOWN / _WIDTH — an EXTRA slow-down specifically as
// the camera reaches the far end (Y), on top of the overall ease at
// the very start/end of the whole loop. Higher SLOWDOWN = more of a
// dwell at Y; wider _WIDTH = the slow region stretches further before
// and after Y instead of being a sharp dip right at it.
// ---------------------------------------------------------------------
const STREET_VIEW_Y_SLOWDOWN = 6;
const STREET_VIEW_Y_SLOWDOWN_WIDTH = 0.2; // was 0.14 — widened so more of each leg eases into the turn
const STREET_VIEW_SPEED_TABLE_SAMPLES = 200;

// -----------------------------------------------------
// buildSpeedTable — precomputes a mapping from "normalized time
// elapsed" (0-1) to "curve parameter t" (0-1) that spends extra time
// near tY (the curve param where the street's far end/Y point sits),
// so the camera visibly slows down approaching and leaving it, then
// moves at normal pace along the rest of the loop.
// -----------------------------------------------------
function buildSpeedTable(cornerTs) {
  const n = STREET_VIEW_SPEED_TABLE_SAMPLES;
  const cumulative = new Array(n + 1);
  cumulative[0] = 0;

  for (let i = 1; i <= n; i++) {
    const ti = i / n;
    let weight = 1;
    for (let c = 0; c < cornerTs.length; c++) {
      const d = ti - cornerTs[c];
      weight +=
        STREET_VIEW_Y_SLOWDOWN *
        Math.exp(-(d * d) / (2 * STREET_VIEW_Y_SLOWDOWN_WIDTH * STREET_VIEW_Y_SLOWDOWN_WIDTH));
    }
    cumulative[i] = cumulative[i - 1] + weight / n;
  }

  const total = cumulative[n];
  for (let i = 0; i <= n; i++) {
    cumulative[i] = cumulative[i] / total;
  }

  return cumulative;
}

// -----------------------------------------------------
// mapProgressToT — given normalized elapsed-time progress (0-1) and a
// speed table from buildSpeedTable, returns the corresponding curve
// parameter t (0-1), interpolated between the nearest samples.
// -----------------------------------------------------
function mapProgressToT(u, table) {
  const n = table.length - 1;
  if (u <= 0) return 0;
  if (u >= 1) return 1;

  for (let i = 0; i < n; i++) {
    if (table[i + 1] >= u) {
      const span = table[i + 1] - table[i];
      const frac = span > 0 ? (u - table[i]) / span : 0;
      return (i + frac) / n;
    }
  }
  return 1;
}

// -----------------------------------------------------
// easeInOutCubic — smooth acceleration/deceleration for the drive
// legs, so the camera visibly slows down approaching each end instead
// of stopping abruptly.
// -----------------------------------------------------
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ---------------------------------------------------------------------
// STREET_DEFINITIONS — the easy way to define a layout's streets: a
// flat list, one entry per street, each with its own LEFT line and
// RIGHT line — real, separate coordinates for each side of the road
// (not computed from one centerline, since a street has width and the
// two sides aren't always parallel/straight the same way).
//
//   - left.from -> left.to   = the left side of the street
//   - right.from -> right.to = the right side of the street
//
// Each entry here becomes its own button in the panel ("Street 1",
// "Street 2", ...), in the order listed. Selecting one drives the
// LEFT line by default (left.from -> left.to) — see
// DEFAULT_STREET_SIDE below to change that for every street at once.
//
// Optionally add lookSide: "left" (or "right") to a street to
// override which side of the road the camera favors looking toward
// DURING that street's tour — this is about where the camera LOOKS
// (the plots), not which line (left/right) it DRIVES on above. Omit
// it and a street uses the global default (right — see
// STREET_VIEW_SIDE_LOOK further up).
//
// Optionally add returnStopAt: [x, z] to make the return leg (Y -> X)
// stop a little short of the exact start point instead of going all
// the way back to it — useful when the real start point is awkward to
// end a tour on. Omit it and the return leg goes all the way back to
// the street's own "from" point.
//
// By default the return leg automatically retraces the outbound
// points in reverse (a symmetric round trip). If the trip should be
// ASYMMETRIC — the way back skips a detour the way out took, or takes
// a different route entirely — set explicitRoundTrip: true and give
// "points" (or "from"/"to") as the FULL loop already, start to finish,
// back to the start:
//
//   left: {
//     points: [[x,z](X), [x,z](Y), [x,z](Y1), [x,z](Y), [x,z](Z), [x,z](Y), [x,z](X)],
//   },
//   explicitRoundTrip: true,
//
// Fill this in per layout like:
//
//   STREET_DEFINITIONS.layout01 = [
//     {
//       left:  { from: [-16, -155], to: [40, -155] },
//       right: { from: [-16, -152], to: [40, -152] },
//     }, // Street 1
//     {
//       left:  { from: [40, -155], to: [40, -80] },
//       right: { from: [37, -155], to: [37, -80] },
//     }, // Street 2
//     {
//       left:  { from: [40, -80], to: [-16, -80] },
//       right: { from: [40, -77], to: [-16, -77] },
//     }, // Street 3
//   ];
//
// Each [x, z] pair is your "X,Y" — the top-down plan's two axes (in
// Three.js world space that's X and Z; height is handled separately
// by STREET_VIEW_EYE_HEIGHT above). A street can skip "right" entirely
// if you only have one line for it — it just uses "left".
//
// For a street with a BEND in it (more than just a straight start and
// end), replace { from, to } with { points: [[x,z], [x,z], [x,z], ...] }
// — as many points as needed, in travel order:
//
//   left: { points: [[-117.61, -181.49], [-21.21, -171.76], [-27.36, -139.83]] }
//
// A layout with no entry here falls back to STREET_PATHS (manually
// placed THREE.Vector3 waypoints, shown as one "Street 1" button), and
// if neither is set, a placeholder loop is used.
// ---------------------------------------------------------------------
export const STREET_DEFINITIONS = {};

// ---------------------------------------------------------------------
// DEFAULT_STREET_SIDE — which line each street button drives: "left"
// (left.from -> left.to) or "right" (right.from -> right.to). Applies
// to every street in every layout; there's no per-street override
// needed unless a future layout genuinely wants to mix sides.
// ---------------------------------------------------------------------
const DEFAULT_STREET_SIDE = "left";

// Ready examples for every layout: 4 streets each (1 vertical + 3
// horizontal), roughly positioned around that layout's own point —
// replace with real click-to-pick coordinates when you have them
// (see the walkthrough above).
STREET_DEFINITIONS.layout01 = [
  {
    left:  { from: [-117.61, -181.49], to: [-103.11, -240.42] }, // corrected click-picked points
    right: { from: [-117.70, -180.96], to: [-100.52, -252.53] }, // real click-picked points
    lookSide: "left", // this street looks toward the LEFT side (plots there) instead of the default right
    returnStopAt: [-113.19, -195.92], // return leg (Y -> X) stops a little short of the exact start
  }, // Street 1 — vertical street
  {
    left:  { points: [[-113.19, -195.92], [-20.86, -172.43], [-27.46, -140.23]] }, // X -> Y -> Z, corrected click-picked points
    right: { points: [[-114.61, -181.49], [-20.86, -169.43], [-24.46, -140.23]] }, // still a placeholder offset — replace when you have the real right-side points
    lookSide: "right", // focuses the right side on both legs (X->Y->Z and the return Z->Y->X)
  }, // Street 2 — has a bend
  {
    left:  { points: [[-27.46, -140.23], [4.17, -134.07], [9.35, -156.36], [4.17, -134.07], [59.41, -119.11], [4.17, -134.07], [-27.46, -140.23]] }, // X -> Y -> Y1 -> Y -> Z -> Y -> X (asymmetric — skips Y1 on the way back)
    right: { points: [[-27.46, -137.23], [4.17, -131.07], [9.35, -153.36], [4.17, -131.07], [59.41, -116.11], [4.17, -131.07], [-27.46, -137.23]] }, // still a placeholder offset — replace when you have the real right-side points
    explicitRoundTrip: true,
  }, // Street 3 — middle horizontal street
  {
    left:  { points: [[60.23, -119.42], [74.82, -107.79], [64.51, -61.13]] }, // X -> Y -> Z, real click-picked points
    right: { points: [[57.23, -119.42], [71.82, -107.79], [61.51, -61.13]] }, // still a placeholder offset — replace when you have the real right-side points
  }, // Street 4 — bottom horizontal street
];

STREET_DEFINITIONS.layout02 = [
  {
    left:  { points: [[64.37, -60.64], [140.17, -42.22], [146.10, -34.00], [142.10, -15.02]] }, // W -> X -> Y -> Z, real click-picked points
    right: { points: [[61.37, -60.64], [137.17, -42.22], [143.10, -34.00], [139.10, -15.02]] }, // still a placeholder offset — replace when you have the real right-side points
  }, // Street 1 — left vertical street
  {
    left:  { points: [[64.37, -60.64], [58.55, -34.08], [142.10, -15.02]] }, // X (= Street 1's start) -> Y -> Z (= Street 1's end), real click-picked points
    right: { points: [[61.37, -60.64], [55.55, -34.08], [139.10, -15.02]] }, // still a placeholder offset — replace when you have the real right-side points
    lookSide: "left",
  }, // Street 2 — top horizontal street
  {
    left:  { points: [[58.55, -34.08], [52.02, -7.79], [133.13, 11.68]] }, // X (= Street 2's Y) -> Y -> Z, real click-picked points
    right: { points: [[55.55, -34.08], [49.02, -7.79], [130.13, 11.68]] }, // still a placeholder offset — replace when you have the real right-side points
    lookSide: "left",
  }, // Street 3 — middle horizontal street
  {
    left:  { points: [[52.02, -7.79], [45.99, 19.80], [127.42, 38.91]] }, // X (= Street 3's Y) -> Y -> Z, real click-picked points
    right: { points: [[49.02, -7.79], [42.99, 19.80], [124.42, 38.91]] }, // still a placeholder offset — replace when you have the real right-side points
    lookSide: "left",
  }, // Street 4 — bottom horizontal street
];

STREET_DEFINITIONS.layout03 = [
  {
    left:  { points: [[45.99, 19.80], [39.13, 46.78], [113.85, 64.92]] }, // X (= Layout 02 Street 4's Y) -> Y -> Z, real click-picked points
    right: { points: [[42.99, 19.80], [36.13, 46.78], [110.85, 64.92]] }, // still a placeholder offset — replace when you have the real right-side points
    lookSide: "left",
  }, // Street 1 — vertical street
  {
    left:  { points: [[39.13, 46.78], [31.44, 77.60], [160.07, 107.31], [164.03, 93.01]] }, // W (= Street 1's Y) -> X -> Y -> Z, real click-picked points
    right: { points: [[36.13, 46.78], [28.44, 77.60], [157.07, 107.31], [161.03, 93.01]] }, // still a placeholder offset — replace when you have the real right-side points
    lookSide: "left",
  }, // Street 2 — top horizontal street
  {
    left:  { points: [[31.44, 77.60], [25.18, 104.49], [152.11, 136.02], [160.07, 107.31]] }, // W (= Street 2's X) -> X -> Y -> Z (= Street 2's Y), real click-picked points
    right: { points: [[28.44, 77.60], [22.18, 104.49], [149.11, 136.02], [157.07, 107.31]] }, // still a placeholder offset — replace when you have the real right-side points
    lookSide: "left",
  }, // Street 3 — middle horizontal street
];

STREET_DEFINITIONS.layout04 = [
  {
    left:  { points: [[25.18, 104.49], [18.31, 135.78], [146.90, 165.15], [152.11, 136.02], [141.33, 187.23], [146.90, 165.15], [18.31, 135.78], [25.18, 104.49]] }, // V -> W -> X -> Y -> Z -> X -> W -> V (asymmetric — skips Y on the way back)
    right: { points: [[22.18, 104.49], [15.31, 135.78], [143.90, 165.15], [149.11, 136.02], [138.33, 187.23], [143.90, 165.15], [15.31, 135.78], [22.18, 104.49]] }, // still a placeholder offset — replace when you have the real right-side points
    lookSide: "left",
    explicitRoundTrip: true,
  }, // Street 1 — vertical street
  {
    left:  { points: [[18.31, 135.78], [11.08, 160.19], [99.78, 183.12], [11.08, 160.19], [-4.80, 172.19]] }, // W -> X -> Y -> X -> Z
    right: { points: [[15.31, 135.78], [8.08, 160.19], [96.78, 183.12], [8.08, 160.19], [-7.80, 172.19]] }, // still a placeholder offset — replace when you have the real right-side points
    lookSide: "left",
    explicitRoundTrip: true,
  }, // Street 2 — top horizontal street
  {
    left:  { from: [3.62, 150.21], to: [133.62, 150.21] },
    right: { from: [3.62, 153.21], to: [133.62, 153.21] },
    lookSide: "left",
  }, // Street 3 — middle horizontal street
  {
    left:  { from: [3.62, 210.21], to: [133.62, 210.21] },
    right: { from: [3.62, 213.21], to: [133.62, 213.21] },
    lookSide: "left",
  }, // Street 4 — bottom horizontal street
];

STREET_DEFINITIONS.layout05 = [
  {
    left:  { from: [-92.25, 140.79], to: [-92.25, 320.79] },
    right: { from: [-89.25, 140.79], to: [-89.25, 320.79] },
  }, // Street 1 — vertical street
  {
    left:  { from: [-122.25, 160.79], to: [7.75, 160.79] },
    right: { from: [-122.25, 163.79], to: [7.75, 163.79] },
  }, // Street 2 — top horizontal street
  {
    left:  { from: [-122.25, 220.79], to: [7.75, 220.79] },
    right: { from: [-122.25, 223.79], to: [7.75, 223.79] },
  }, // Street 3 — middle horizontal street
  {
    left:  { from: [-122.25, 280.79], to: [7.75, 280.79] },
    right: { from: [-122.25, 283.79], to: [7.75, 283.79] },
  }, // Street 4 — bottom horizontal street
];

export const STREET_PATHS = {};

// -----------------------------------------------------
// buildPlaceholderStreetPaths — a small square loop under each
// existing layout's XZ position, just so every layout has SOMETHING
// to preview before real street points are gathered. Replace freely.
// -----------------------------------------------------
function buildPlaceholderStreetPaths(THREE) {
  const paths = {};

  Object.keys(LAYOUTS).forEach(function (key) {
    const layout = LAYOUTS[key];
    const cx = layout.position.x;
    const cz = layout.position.z;
    const r = 18;
    const y = STREET_VIEW_EYE_HEIGHT;

    paths[key] = [
      new THREE.Vector3(cx - r, y, cz - r),
      new THREE.Vector3(cx + r, y, cz - r),
      new THREE.Vector3(cx + r, y, cz + r),
      new THREE.Vector3(cx - r, y, cz + r),
    ];
  });

  return paths;
}

// ---------------------------------------------------------------------
// STREET_VIEW_CORNER_FILLET_DISTANCE — how far before/after a rounded
// corner the path starts curving, in world units. Larger = a wider,
// gentler bend through the corner; smaller = a tighter one.
// ---------------------------------------------------------------------
const STREET_VIEW_CORNER_FILLET_DISTANCE = 10;

// ---------------------------------------------------------------------
// INSET_WIDTH_PX / INSET_HEIGHT_PX / INSET_MARGIN_PX — the small
// "street view" window shown during a tour: fixed size, positioned at
// the vertical middle of the left edge of the screen, sitting on top
// of (but never replacing) the main map view.
// ---------------------------------------------------------------------
const INSET_WIDTH_PX = 360;
const INSET_HEIGHT_PX = 240;
const INSET_MARGIN_PX = 24;

// -----------------------------------------------------
// buildRoundedPath — a CurvePath that is straight everywhere except a
// short smoothed arc at each corner listed in roundedIndices (a Set of
// indices into `points`). Every point is still visited exactly —
// unrounded corners (like a street's far end) just get a sharp
// straight-line vertex, while rounded ones (like a bend in the middle
// of a street) get a short QuadraticBezierCurve3 fillet instead of a
// sharp angle.
// -----------------------------------------------------
function buildRoundedPath(THREE, points, roundedIndices, filletDistance) {
  const path = new THREE.CurvePath();
  let cursor = points[0].clone();

  for (let i = 1; i < points.length; i++) {
    const isLast = i === points.length - 1;

    if (!isLast && roundedIndices.has(i)) {
      const corner = points[i];
      const prev = points[i - 1];
      const next = points[i + 1];
      const dirIn = corner.clone().sub(prev).normalize();
      const dirOut = next.clone().sub(corner).normalize();
      const d = Math.min(
        filletDistance,
        corner.distanceTo(prev) / 2,
        corner.distanceTo(next) / 2
      );
      const cutBefore = corner.clone().sub(dirIn.clone().multiplyScalar(d));
      const cutAfter = corner.clone().add(dirOut.clone().multiplyScalar(d));

      path.add(new THREE.LineCurve3(cursor, cutBefore));
      path.add(new THREE.QuadraticBezierCurve3(cutBefore, corner, cutAfter));
      cursor = cutAfter;
    } else {
      path.add(new THREE.LineCurve3(cursor, points[i]));
      cursor = points[i].clone();
    }
  }

  return path;
}

// -----------------------------------------------------
// buildStreetList — returns the list of streets to show as buttons
// for a given layout key: [{ label, points }, ...]. STREET_DEFINITIONS
// wins (one entry per defined street) if present; otherwise
// STREET_PATHS is shown as a single "Street 1" covering the whole
// path; otherwise an empty list (panel stays hidden).
// -----------------------------------------------------
function buildStreetList(key) {
  const THREE = _THREE;
  const defs = STREET_DEFINITIONS[key];

  if (defs && defs.length >= 1) {
    return defs
      .map(function (street, i) {
        const line = street[DEFAULT_STREET_SIDE] || street.left || street.right;
        if (!line) return null;

        // A line can be either { from, to } (a straight segment) or
        // { points: [[x,z], ...] } (a bend with any number of points).
        const rawPoints = line.points
          ? line.points
          : [line.from, line.to];

        return {
          label: "Street " + (i + 1),
          points: rawPoints.map(function (p) {
            return new THREE.Vector3(p[0], STREET_VIEW_EYE_HEIGHT, p[1]);
          }),
          lookSide: street.lookSide === "left" ? "left" : "right",
          returnStopPoint: street.returnStopAt
            ? new THREE.Vector3(
                street.returnStopAt[0],
                STREET_VIEW_EYE_HEIGHT,
                street.returnStopAt[1]
              )
            : null,
          explicitRoundTrip: !!street.explicitRoundTrip,
        };
      })
      .filter(function (entry) {
        return entry !== null;
      });
  }

  const raw = STREET_PATHS[key];
  if (raw && raw.length >= 2) {
    return [{ label: "Street 1", points: raw, lookSide: "right", returnStopPoint: null, explicitRoundTrip: false }];
  }

  return [];
}

// ---------------------------------------------------------------------
// Module-scoped state
// ---------------------------------------------------------------------
let _THREE = null;
let _camera = null;
let _controls = null;
let _scene = null;
let _renderer = null;

// _streetCamera is a SEPARATE camera dedicated to the street tour —
// the main camera/controls (the big map view) are never touched by
// any of this, so the main view stays exactly as the user left it
// while a tour plays in the inset window.
let _streetCamera = null;

let _curve = null;
let _speedTable = null;
let _activeTY = 0.5;
let _active = false;
let _sessionActive = false; // true from the moment a street starts until Exit Street View is pressed
let _startTime = null;
let _duration = 0;

let _panel = null;
let _list = null;
let _exitRow = null;
let _readout = null;
let _sliders = []; // one <input type=range> per street, indexed to match _currentStreets
let _currentStreets = [];
let _activeStreetIndex = null;
let _activeLookSide = "right";
let _insetFrame = null; // decorative border DIV around the inset window
let _marker = null; // visible marker on the MAIN map showing the street camera's live position

// -----------------------------------------------------
// isStreetViewActive — true while a tour is actively playing (not
// including the free-look pause after it finishes). Kept for anyone
// who wants to know specifically whether the inset camera is mid-
// animation right now.
// -----------------------------------------------------
export function isStreetViewActive() {
  return _active;
}

// -----------------------------------------------------
// isStreetViewSessionActive — true from the moment a street tour
// starts until "Exit Street View" is pressed (spans both the active
// animation AND the free-look pause at the end). This is what governs
// whether the inset window should be showing at all.
// -----------------------------------------------------
export function isStreetViewSessionActive() {
  return _sessionActive;
}

// ---------------------------------------------------------------------
// MARKER_RADIUS / MARKER_COLOR — sizing/coloring for the visible
// camera icon shown on the MAIN map tracking the street camera's live
// position and — importantly — where it's actually LOOKING (not just
// which way it's driving, since the tour angles sideways toward the
// plots rather than looking straight ahead).
// ---------------------------------------------------------------------
const MARKER_RADIUS = 2.5;
const MARKER_BODY_COLOR = 0x2b2b2b;
const MARKER_LENS_COLOR = 0xff2d55;

// -----------------------------------------------------
// createMarker — a small camera-shaped icon (a body block with a lens
// cone pointing forward) added directly to the main scene (so it
// renders in the MAIN camera's view, not just the inset), hidden
// until a street tour/scrub session is active. Placed on render layer
// 1 — the street camera sits exactly at the marker's position, so
// without this the street camera would render from INSIDE the marker
// (filling its whole view with the marker's color). Only the main
// camera enables layer 1 (see initStreetView).
// -----------------------------------------------------
const MARKER_LAYER = 1;

function createMarker(THREE) {
  const group = new THREE.Group();

  // Body — a small block standing in for the camera housing.
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(MARKER_RADIUS * 1.6, MARKER_RADIUS * 1.6, MARKER_RADIUS * 2.2),
    new THREE.MeshBasicMaterial({ color: MARKER_BODY_COLOR, depthTest: false })
  );
  group.add(body);

  // Lens — a cone on the front face, pointing along +Z (the direction
  // this group will be rotated to face) so it's unambiguous which way
  // the camera is actually looking, distinct in color from the body.
  const lens = new THREE.Mesh(
    new THREE.ConeGeometry(MARKER_RADIUS * 0.9, MARKER_RADIUS * 2.2, 12),
    new THREE.MeshBasicMaterial({ color: MARKER_LENS_COLOR, depthTest: false })
  );
  lens.position.set(0, 0, MARKER_RADIUS * 2.2);
  lens.rotation.x = Math.PI / 2;
  group.add(lens);

  group.renderOrder = 999; // draw on top of the model regardless of depth
  group.visible = false;

  group.traverse(function (obj) {
    obj.layers.set(MARKER_LAYER);
  });

  return group;
}

// -----------------------------------------------------
// updateMarker — moves the main-map marker to the given point,
// orienting the lens along "facing" — the camera's ACTUAL look
// direction (with the side-look bias applied), not just its direction
// of travel — so the icon truly shows where it's focusing.
// -----------------------------------------------------
function updateMarker(point, facing) {
  if (!_marker) return;
  _marker.position.copy(point);

  const angle = Math.atan2(facing.x, facing.z);
  _marker.rotation.set(0, angle, 0);
}

// -----------------------------------------------------
// updateReadout — refreshes the small position readout in the panel
// with the street camera's current world position, for checking or
// calibrating waypoints while scrubbing.
// -----------------------------------------------------
function updateReadout(point) {
  if (!_readout) return;
  _readout.textContent =
    "x: " + point.x.toFixed(2) + "  y: " + point.y.toFixed(2) + "  z: " + point.z.toFixed(2);
}
// sits on top of the canvas, framing the small street-view window so
// it reads as a distinct "picture-in-picture" panel rather than a
// stray rectangle of the scene. Its position/size is kept in sync
// with the actual render viewport every frame in renderStreetViewInset.
// -----------------------------------------------------
function createInsetFrame() {
  _insetFrame = document.createElement("div");
  _insetFrame.id = "street-view-inset-frame";
  Object.assign(_insetFrame.style, {
    position: "fixed",
    border: "3px solid rgba(255,255,255,0.85)",
    borderRadius: "8px",
    boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
    pointerEvents: "none",
    zIndex: "900",
    display: "none",
  });
  document.body.appendChild(_insetFrame);
}

// -----------------------------------------------------
// createPanel — the "STREETS" panel shell (title + empty list),
// positioned top-right below the axis gizmo's corner box and clear of
// the bottom-right layout panel. Its buttons are rebuilt every time
// the selected layout changes (see rebuildPanel below).
// -----------------------------------------------------
function createPanel() {
  _panel = document.createElement("div");
  _panel.id = "street-view-panel";
  Object.assign(_panel.style, {
    position: "fixed",
    top: "142px",
    right: "16px",
    padding: "12px 14px",
    background: "rgba(20, 20, 20, 0.75)",
    backdropFilter: "blur(6px)",
    borderRadius: "10px",
    fontFamily: "system-ui, sans-serif",
    color: "#fff",
    zIndex: "1000",
    minWidth: "200px",
    boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
    display: "none",
  });

  const title = document.createElement("div");
  title.textContent = "STREETS";
  Object.assign(title.style, {
    fontSize: "11px",
    letterSpacing: "1px",
    opacity: "0.6",
    marginBottom: "8px",
  });
  _panel.appendChild(title);

  _list = document.createElement("div");
  Object.assign(_list.style, {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  });
  _panel.appendChild(_list);

  _readout = document.createElement("div");
  Object.assign(_readout.style, {
    marginTop: "8px",
    paddingTop: "8px",
    borderTop: "1px solid rgba(255,255,255,0.15)",
    fontFamily: "Consolas, Menlo, monospace",
    fontSize: "11px",
    color: "#b6ffb6",
    whiteSpace: "pre",
  });
  _readout.textContent = "";
  _panel.appendChild(_readout);

  document.body.appendChild(_panel);
}

// -----------------------------------------------------
// styleStreetButton — shared inline styling for every row in the
// panel (streets and the trailing Exit row alike).
// -----------------------------------------------------
function styleStreetButton(btn) {
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
}

// -----------------------------------------------------
// rebuildPanel — regenerates the street buttons for whichever layout
// is now active, plus a trailing "Exit Street View" row. Called every
// time the selected layout changes.
// -----------------------------------------------------
function rebuildPanel(key) {
  _currentStreets = buildStreetList(key);
  _activeStreetIndex = null;
  _sliders = [];
  _list.innerHTML = "";
  if (_readout) _readout.textContent = "";

  if (_currentStreets.length === 0) {
    _panel.style.display = "none";
    _exitRow = null;
    return;
  }

  _panel.style.display = "block";

  _currentStreets.forEach(function (street, i) {
    const btn = document.createElement("button");
    btn.textContent = street.label;
    btn.dataset.streetIndex = String(i);
    styleStreetButton(btn);
    btn.addEventListener("click", function () {
      startStreetView(i);
    });
    _list.appendChild(btn);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1000";
    slider.value = "0";
    Object.assign(slider.style, {
      width: "100%",
      margin: "2px 0 6px 0",
    });
    slider.addEventListener("input", function () {
      scrubStreet(i, Number(slider.value) / 1000);
    });
    _list.appendChild(slider);
    _sliders[i] = slider;
  });

  _exitRow = document.createElement("button");
  _exitRow.textContent = "Exit Street View";
  styleStreetButton(_exitRow);
  Object.assign(_exitRow.style, {
    marginTop: "4px",
    paddingTop: "8px",
    borderTop: "1px solid rgba(255,255,255,0.15)",
    color: "#ffb4b4",
    display: "none",
  });
  _exitRow.addEventListener("click", exitStreetView);
  _list.appendChild(_exitRow);
}

// -----------------------------------------------------
// prepareStreetCurve — builds the round-trip curve, speed table, and
// look-side for the given street index, WITHOUT starting playback.
// Shared by startStreetView (autoplay) and scrubStreet (manual
// slider) so both work from the exact same curve. Returns false if
// the street has fewer than 2 points.
// -----------------------------------------------------
function prepareStreetCurve(index) {
  const street = _currentStreets[index];
  if (!street || street.points.length < 2) return false;

  _activeLookSide = street.lookSide === "left" ? "left" : "right";

  // Build the round-trip curve. By default this auto-mirrors the
  // street's own points back to the start; explicitRoundTrip lets a
  // street specify the full (possibly asymmetric) loop directly — see
  // the STREET_DEFINITIONS comment above for details.
  const forwardPts = street.points;

  let roundTripPoints;
  let roundedIndices;

  if (street.explicitRoundTrip) {
    // The street's own points already ARE the full loop, start to
    // finish, back to the start (possibly asymmetric — the way back
    // doesn't have to mirror the way out). Round every interior point
    // except the very first and last.
    roundTripPoints = forwardPts;
    roundedIndices = new Set();
    for (let i = 1; i < roundTripPoints.length - 1; i++) {
      roundedIndices.add(i);
    }
  } else {
    const reversedPts = forwardPts.slice().reverse();

    // If this street defines a returnStopAt, the return leg ends
    // there instead of going all the way back to the exact start
    // point.
    if (street.returnStopPoint) {
      reversedPts[reversedPts.length - 1] = street.returnStopPoint;
    }

    // The shared point at the far end is included only once (not
    // duplicated) — a repeated point there made the curve briefly
    // bulge off course before settling, since Catmull-Rom handles a
    // zero-length segment badly.
    roundTripPoints = [...forwardPts, ...reversedPts.slice(1)];

    // Only INTERIOR bends within the street's own path (like Y in an
    // X -> Y -> Z street) get a smooth rounded corner — the far end
    // (Z) and the very start/end (X) stay sharp, since those are just
    // straight travel or the turnaround point, not a bend to smooth.
    // Each interior bend appears twice in the round trip (once on the
    // way out, once mirrored on the way back) and both get rounded.
    const k = forwardPts.length;
    roundedIndices = new Set();
    for (let i = 1; i <= k - 2; i++) {
      roundedIndices.add(i);
      roundedIndices.add(2 * k - 2 - i);
    }
  }

  _curve = buildRoundedPath(
    _THREE,
    roundTripPoints,
    roundedIndices,
    STREET_VIEW_CORNER_FILLET_DISTANCE
  );
  const length = _curve.getLength();
  _duration = Math.max(length / STREET_VIEW_SPEED, 1);

  // Where each corner (every interior waypoint, both on the way out
  // and the way back) falls along the round-trip curve's 0-1
  // parameter, so the speed table can ease through EVERY bend — not
  // just slow down once at the far end.
  const cumulative = [0];
  for (let i = 1; i < roundTripPoints.length; i++) {
    cumulative.push(cumulative[i - 1] + roundTripPoints[i].distanceTo(roundTripPoints[i - 1]));
  }
  const cornerTs = [];
  for (let i = 1; i < roundTripPoints.length - 1; i++) {
    cornerTs.push(length > 0 ? cumulative[i] / length : 0);
  }
  if (cornerTs.length === 0) cornerTs.push(0.5); // a simple 2-point street still eases at its one turnaround

  _speedTable = buildSpeedTable(cornerTs);
  _activeStreetIndex = index;

  return true;
}

// -----------------------------------------------------
// applyCameraAtT — positions/orients the street camera at parameter t
// (0-1) along the currently prepared curve, updates the visible
// marker on the main map, and refreshes the position readout. Shared
// by both autoplay (updateStreetView) and manual slider scrubbing.
// -----------------------------------------------------
function applyCameraAtT(t) {
  const point = _curve.getPointAt(t);
  const tangent = _curve.getTangentAt(t);

  _streetCamera.position.copy(point);
  const up = new _THREE.Vector3(0, 1, 0);
  _streetCamera.up.copy(up);

  // "right" is perpendicular to the direction of travel (forward x up),
  // matching what's actually to the camera's right as it moves. A
  // street with lookSide: "left" flips this to favor the other side —
  // applied consistently on both the way out AND the way back.
  const right = tangent.clone().cross(up).normalize();
  const sideSign = _activeLookSide === "left" ? -1 : 1;

  const lookDir = tangent
    .clone()
    .multiplyScalar(1 - STREET_VIEW_SIDE_LOOK)
    .add(right.multiplyScalar(STREET_VIEW_SIDE_LOOK * sideSign))
    .normalize();

  const lookTarget = point.clone().add(lookDir.clone().multiplyScalar(STREET_VIEW_LOOK_DISTANCE));
  _streetCamera.lookAt(lookTarget);

  updateMarker(point, lookDir);
  updateReadout(point);

  return point;
}

// -----------------------------------------------------
// updateHighlight — marks whichever street button is currently
// playing (or just finished playing, until Exit is pressed).
// -----------------------------------------------------
function updateHighlight() {
  Array.from(_list.children).forEach(function (btn) {
    if (btn.tagName !== "BUTTON" || btn === _exitRow) return;
    const isActive = Number(btn.dataset.streetIndex) === _activeStreetIndex;
    btn.style.background = isActive ? "rgba(255,255,255,0.15)" : "transparent";
    btn.style.fontWeight = isActive ? "600" : "400";
  });
}

// -----------------------------------------------------
// handleLayoutChanged — fired by layout-selector.js whenever a layout
// transition settles. Cuts any in-progress tour immediately (so a
// mid-tour layout switch never leaves the camera stranded on the
// previous street) and rebuilds the panel for the newly active
// layout.
// -----------------------------------------------------
function handleLayoutChanged(key) {
  if (_active || _sessionActive) {
    _active = false;
    _sessionActive = false;
    if (_insetFrame) _insetFrame.style.display = "none";
    if (_marker) _marker.visible = false;
  }
  rebuildPanel(key);
}

// -----------------------------------------------------
// startStreetView — prepares the chosen street's curve and begins
// auto-playing the camera along it from the start.
// -----------------------------------------------------
function startStreetView(index) {
  if (!prepareStreetCurve(index)) return;

  _active = true;
  _sessionActive = true;
  _startTime = performance.now() / 1000;

  if (_insetFrame) _insetFrame.style.display = "block";
  if (_exitRow) _exitRow.style.display = "block";
  if (_marker) _marker.visible = true;
  updateHighlight();
}

// -----------------------------------------------------
// scrubStreet — manually moves the street camera to a specific point
// (t, 0-1) along a street's curve, pausing any autoplay. Lets you
// stop anywhere along the path and read off the exact position —
// handy for checking/calibrating waypoints.
// -----------------------------------------------------
function scrubStreet(index, t) {
  if (_activeStreetIndex !== index || !_curve) {
    if (!prepareStreetCurve(index)) return;
  }

  _active = false;
  _sessionActive = true;

  if (_insetFrame) _insetFrame.style.display = "block";
  if (_exitRow) _exitRow.style.display = "block";
  if (_marker) _marker.visible = true;

  applyCameraAtT(t);
  updateHighlight();
}

// -----------------------------------------------------
// updateStreetView — call once per frame (with the current time in
// seconds) while isStreetViewActive() is true. Moves the SEPARATE
// street camera (never the main camera) along the curve; position
// comes straight off the curve, orientation looks along the curve's
// tangent, so the view always faces the direction of travel. At the
// end it simply holds there — there's no OrbitControls attached to
// this camera to hand off to, so it just freezes at the final frame
// until Exit Street View is pressed.
// -----------------------------------------------------
export function updateStreetView(nowSeconds) {
  if (!_active) return;

  const elapsed = nowSeconds - _startTime;
  const overallU = easeInOutCubic(Math.min(elapsed / _duration, 1));
  const t = mapProgressToT(overallU, _speedTable);

  applyCameraAtT(t);

  // Keep this street's slider in sync with autoplay so it reflects
  // the live position if the user glances at it mid-tour.
  if (_sliders[_activeStreetIndex]) {
    _sliders[_activeStreetIndex].value = String(Math.round(t * 1000));
  }

  if (t >= 1) {
    _active = false;
    // The street stays highlighted and "Exit Street View" stays
    // visible — the tour is over (back at the start point) but the
    // user is still "in" street view, free-looking, until they press
    // it. The camera simply holds at this final position/orientation.
  }
}

// -----------------------------------------------------
// renderStreetViewInset — call once per frame, AFTER your main
// renderer.render(scene, camera) call, so the inset draws on top of
// (never instead of) the main view. Renders the SAME scene from the
// separate street camera into a small viewport positioned at the
// vertical middle of the left edge of the screen. No-ops entirely
// when no street-view session is active.
// -----------------------------------------------------
export function renderStreetViewInset() {
  if (!_sessionActive) return;

  const canvas = _renderer.domElement;
  const dpr = _renderer.getPixelRatio();
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;

  const widthPx = INSET_WIDTH_PX * dpr;
  const heightPx = INSET_HEIGHT_PX * dpr;
  const marginPx = INSET_MARGIN_PX * dpr;

  const left = marginPx;
  const bottomFromTop = (cssHeight * dpr - heightPx) / 2 + heightPx; // vertically centered
  const bottom = cssHeight * dpr - bottomFromTop;

  _streetCamera.aspect = INSET_WIDTH_PX / INSET_HEIGHT_PX;
  _streetCamera.updateProjectionMatrix();

  _renderer.setScissorTest(true);
  _renderer.setViewport(left, bottom, widthPx, heightPx);
  _renderer.setScissor(left, bottom, widthPx, heightPx);

  const prevAutoClear = _renderer.autoClear;
  _renderer.autoClear = true; // the inset gets its own clean clear, unlike the axis gizmo overlay
  _renderer.render(_scene, _streetCamera);
  _renderer.autoClear = prevAutoClear;

  // Restore full-canvas viewport/scissor so the NEXT frame's main
  // scene render isn't still confined to this small window.
  _renderer.setViewport(0, 0, cssWidth * dpr, cssHeight * dpr);
  _renderer.setScissor(0, 0, cssWidth * dpr, cssHeight * dpr);
  _renderer.setScissorTest(false);

  // Keep the decorative border DIV aligned to the inset rect in CSS
  // pixels (setViewport/setScissor above used device pixels).
  if (_insetFrame) {
    Object.assign(_insetFrame.style, {
      left: INSET_MARGIN_PX + "px",
      top: (cssHeight - INSET_HEIGHT_PX) / 2 + "px",
      width: INSET_WIDTH_PX + "px",
      height: INSET_HEIGHT_PX + "px",
    });
  }
}

// -----------------------------------------------------
// exitStreetView — closes the inset window/session. The main camera
// was never touched by any of this, so there's nothing to transition
// back — the map view has been sitting there unaffected the whole
// time.
// -----------------------------------------------------
function exitStreetView() {
  _active = false;
  _sessionActive = false;
  _activeStreetIndex = null;
  if (_insetFrame) _insetFrame.style.display = "none";
  if (_exitRow) _exitRow.style.display = "none";
  if (_marker) _marker.visible = false;
  updateHighlight();
}

// -----------------------------------------------------
// initStreetView — call once, after initLayoutSystem() has already
// run (so LAYOUTS is populated and camera/controls exist).
// -----------------------------------------------------
export function initStreetView({ THREE, camera, controls, scene, renderer }) {
  _THREE = THREE;
  _camera = camera;
  _controls = controls;
  _scene = scene;
  _renderer = renderer;

  // A separate camera dedicated to the inset window, matching the
  // main camera's field of view but its own aspect ratio (the inset
  // window's, not the full canvas's).
  _streetCamera = new THREE.PerspectiveCamera(
    camera.fov,
    INSET_WIDTH_PX / INSET_HEIGHT_PX,
    camera.near,
    camera.far
  );

  if (Object.keys(STREET_PATHS).length === 0) {
    Object.assign(STREET_PATHS, buildPlaceholderStreetPaths(THREE));
  }

  _marker = createMarker(THREE);
  _scene.add(_marker);

  // Only the MAIN camera sees the marker (layer 1) — the street
  // camera stays on the default layer only, so it never renders from
  // inside the marker sitting at its own position.
  camera.layers.enable(MARKER_LAYER);

  createPanel();
  createInsetFrame();
  onLayoutChanged(handleLayoutChanged);
}