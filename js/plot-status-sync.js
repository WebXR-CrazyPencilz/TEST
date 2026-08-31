// =====================================================================
// plot-status-sync.js
//
// PHASE 2 — GOOGLE SHEET STATUS SYNC (standalone module)
//
// Fetches plot rows (Plot ID + Status, plus whatever other columns
// your sheet has) from a Google Apps Script Web App endpoint, maps
// each Plot ID to the matching object in window.GLB_OBJECTS (built by
// the inventory system already in main.js), and recolors that
// object's material according to its status. Repeats on a timer.
//
// REQUIRES: window.GLB_OBJECTS must already exist — call this AFTER
// the GLB has loaded and buildGlbInventory(model) has run.
//
// INTEGRATION — in main.js, right after the inventory is built:
//
//   import { initPlotStatusSync } from "./plot-status-sync.js";
//
//   _glbInventoryCache = buildGlbInventory(model);
//   printGlbInventory(_glbInventoryCache);
//
//   initPlotStatusSync({
//     THREE,
//     sheetUrl: "PASTE_YOUR_DEPLOYED_APPS_SCRIPT_WEB_APP_URL_HERE",
//   });
//
// That's the whole integration. It fetches immediately, then again
// every 5 minutes by default — nothing else needs to call it again.
// =====================================================================

const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------
// STATUS_COLORS — one entry per status string your sheet can contain
// (matched case-insensitively, whitespace-trimmed). Your existing
// base yellow material is left completely alone for any status not
// listed here (including blank cells), so nothing gets recolored
// unexpectedly. Change these hex values freely — they're independent
// of whatever base color your GLB materials already have.
// ---------------------------------------------------------------------
const STATUS_COLORS = {
  available: 0xf4d35e, // close to your existing yellow base
  sold: 0xe63946,      // red
};

let _sheetUrl = null;
let _pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
let _pollTimer = null;

// Tracks objects whose material we've already cloned, so repeated
// syncs don't keep re-cloning, and so we never recolor a material
// that's still shared with some OTHER object in the GLB.
const _clonedMaterialObjects = new WeakSet();

// -----------------------------------------------------
// ensureUniqueMaterial — GLTF exports frequently SHARE one material
// instance across many mesh objects (e.g. every plot using "the
// yellow plot material"). Setting .color directly on a shared
// material would recolor every object using it, not just this one
// plot. Clone once per object, the first time we ever touch it.
// -----------------------------------------------------
function ensureUniqueMaterial(object) {
  if (!object.isMesh || !object.material) return;
  if (_clonedMaterialObjects.has(object)) return;

  if (Array.isArray(object.material)) {
    object.material = object.material.map(function (m) {
      return m.clone();
    });
  } else {
    object.material = object.material.clone();
  }

  _clonedMaterialObjects.add(object);
}

// -----------------------------------------------------
// applyColorToObject — colors a mesh directly, or recurses through a
// Group's children. A "plot" entry in GLB_OBJECTS might itself be a
// Group containing one or more real Mesh children rather than being
// a mesh itself, so this handles both shapes.
// -----------------------------------------------------
function applyColorToObject(object, hexColor) {
  ensureUniqueMaterial(object);

  if (object.isMesh && object.material) {
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];

    materials.forEach(function (mat) {
      if (mat.color) mat.color.setHex(hexColor);
    });
  }

  if (object.children && object.children.length) {
    object.children.forEach(function (child) {
      applyColorToObject(child, hexColor);
    });
  }
}

// -----------------------------------------------------
// resolveStatusColor — case-insensitive, trimmed lookup into
// STATUS_COLORS. Returns null ("leave this object's color alone") for
// anything blank or unrecognized.
// -----------------------------------------------------
function resolveStatusColor(status) {
  if (!status) return null;
  const key = String(status).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(STATUS_COLORS, key)
    ? STATUS_COLORS[key]
    : null;
}

// -----------------------------------------------------
// applyPlotStatuses — given the parsed sheet rows, look each row's
// Plot ID up in window.GLB_OBJECTS and recolor if both the object and
// a recognized status are found. Accepts "Plot ID", "PlotID", or
// "plot id" as the column header, to tolerate small naming
// differences in the sheet.
// -----------------------------------------------------
function applyPlotStatuses(plots) {
  if (!window.GLB_OBJECTS) {
    console.warn(
      "[plot-status-sync] window.GLB_OBJECTS not found yet — has the GLB inventory been built?"
    );
    return;
  }

  let matched = 0;
  let unmatched = 0;

  plots.forEach(function (row) {
    const rawId = row["Plot ID"] ?? row["PlotID"] ?? row["plot id"] ?? row["Plot Id"];
    const plotId = rawId === undefined || rawId === null ? "" : String(rawId).trim();
    const status = row["Status"] ?? row["status"];

    if (!plotId) return;

    const object = window.GLB_OBJECTS[plotId];
    if (!object) {
      unmatched++;
      return;
    }

    const color = resolveStatusColor(status);
    if (color !== null) {
      applyColorToObject(object, color);
    }

    matched++;
  });

  console.log(
    "[plot-status-sync] Sync complete — matched " +
      matched +
      " plot(s), " +
      unmatched +
      " Plot ID(s) from the sheet had no matching GLB object."
  );
}

// -----------------------------------------------------
// fetchAndApplyStatuses — one fetch + apply cycle. Tolerates either
// { plots: [...] } (what Code.gs returns) or a bare [...] array, in
// case the endpoint's shape changes later.
// -----------------------------------------------------
function fetchAndApplyStatuses() {
  fetch(_sheetUrl, { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (data) {
      const plots = Array.isArray(data) ? data : data.plots || [];
      applyPlotStatuses(plots);
    })
    .catch(function (err) {
      console.error("[plot-status-sync] Failed to fetch/apply sheet data:", err);
    });
}

// -----------------------------------------------------
// initPlotStatusSync — call once, after window.GLB_OBJECTS exists.
// Fetches immediately, then again every pollIntervalMs (default 5
// minutes). Also exposes window.refreshPlotStatuses() for manually
// forcing a refresh from the browser console. Returns a small
// controller object in case you want to stop the polling or trigger
// a refresh from elsewhere in your own code later.
// -----------------------------------------------------
export function initPlotStatusSync({ sheetUrl, pollIntervalMs }) {
  _sheetUrl = sheetUrl;
  _pollIntervalMs =
    typeof pollIntervalMs === "number" ? pollIntervalMs : DEFAULT_POLL_INTERVAL_MS;

  fetchAndApplyStatuses();

  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(fetchAndApplyStatuses, _pollIntervalMs);

  window.refreshPlotStatuses = fetchAndApplyStatuses;

  return {
    refreshNow: fetchAndApplyStatuses,
    stop: function () {
      if (_pollTimer) {
        clearInterval(_pollTimer);
        _pollTimer = null;
      }
    },
  };
}