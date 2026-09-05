// =====================================================================
// gallery-amenities.js
//
// PHASE 2 — GALLERY + AMENITIES PANEL (standalone module)
//
// Adds two buttons to the TOP-LEFT of the screen, stacked directly
// below the existing "Copy Plot IDs" button (which lives in main.js
// at top:16/left:16):
//
//   [ Gallery ]     -> opens a lightbox of photos + optional YouTube
//                       videos, with prev/next navigation
//   [ Amenities ]   -> opens a grid of amenity icons + labels
//
// Completely independent of the cinematic / layout / plot-sync code —
// it only touches the DOM, never the camera, controls, or scene.
//
// INTEGRATION — one addition in your main.js:
//
//   import { initGalleryAmenities } from "./gallery-amenities.js";
//
//   // anywhere after DOM is available — right after
//   // createCopyPlotIdsButton() is a good spot:
//   initGalleryAmenities();
//
// EDITING CONTENT — everything shown is driven by the two arrays
// below (GALLERY_ITEMS, AMENITIES). Add/remove/reorder entries there;
// no other code needs to change.
// =====================================================================

// ---------------------------------------------------------------------
// GALLERY_ITEMS — each entry is either:
//   { type: "image", src: "...", caption: "..." }
//   { type: "youtube", videoId: "YOUTUBE_VIDEO_ID", caption: "..." }
// "caption" is optional for both.
//
// For YouTube items you only need the video ID (the part after
// "v=" in a normal YouTube URL, e.g. for
// https://www.youtube.com/watch?v=dQw4w9WgXcQ the id is "dQw4w9WgXcQ").
// The thumbnail is fetched automatically from YouTube.
// ---------------------------------------------------------------------
const GALLERY_ITEMS = [
  { type: "image", src: "https://via.placeholder.com/1200x800?text=Photo+1", caption: "Photo 1" },
  { type: "image", src: "https://via.placeholder.com/1200x800?text=Photo+2", caption: "Photo 2" },
  { type: "image", src: "https://via.placeholder.com/1200x800?text=Photo+3", caption: "Photo 3" },
  { type: "youtube", videoId: "dQw4w9WgXcQ", caption: "Walkthrough video" },
];

// ---------------------------------------------------------------------
// AMENITIES — each entry is { label, icon } where "icon" is any text
// you want shown large (an emoji works great with zero extra assets,
// e.g. "🏊" for pool) — or swap iconEl below for an <img> if you'd
// rather use real icon files.
// ---------------------------------------------------------------------
const AMENITIES = [
  { label: "Swimming Pool", icon: "🏊" },
  { label: "Clubhouse", icon: "🏛️" },
  { label: "Gymnasium", icon: "🏋️" },
  { label: "Children's Play Area", icon: "🧒" },
  { label: "Landscaped Gardens", icon: "🌳" },
  { label: "24x7 Security", icon: "🛡️" },
];

// ---------------------------------------------------------------------
// Shared style helpers
// ---------------------------------------------------------------------
const PANEL_BUTTON_STYLE = {
  display: "block",
  padding: "8px 14px",
  background: "rgba(20, 20, 20, 0.75)",
  backdropFilter: "blur(6px)",
  color: "#fff",
  border: "none",
  borderRadius: "8px",
  fontFamily: "system-ui, sans-serif",
  fontSize: "13px",
  cursor: "pointer",
  zIndex: "1000",
  boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
};

function makeTopLeftButton(id, label, top) {
  const btn = document.createElement("button");
  btn.id = id;
  btn.textContent = label;
  Object.assign(btn.style, PANEL_BUTTON_STYLE, {
    position: "fixed",
    left: "16px",
    top: top,
  });
  document.body.appendChild(btn);
  return btn;
}

// ---------------------------------------------------------------------
// Modal shell — shared by both Gallery and Amenities. Returns
// { overlay, body, close } — caller fills "body" with its own content.
// ---------------------------------------------------------------------
function createModalShell(titleText) {
  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(0, 0, 0, 0.85)",
    zIndex: "2000",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-start",
    padding: "40px 20px",
    overflowY: "auto",
  });

  const header = document.createElement("div");
  Object.assign(header.style, {
    width: "100%",
    maxWidth: "1000px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "20px",
  });

  const title = document.createElement("div");
  title.textContent = titleText;
  Object.assign(title.style, {
    color: "#fff",
    fontFamily: "system-ui, sans-serif",
    fontSize: "18px",
    fontWeight: "600",
    letterSpacing: "0.5px",
  });
  header.appendChild(title);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕";
  Object.assign(closeBtn.style, {
    background: "rgba(255,255,255,0.1)",
    border: "none",
    color: "#fff",
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    fontSize: "16px",
    cursor: "pointer",
  });
  header.appendChild(closeBtn);

  const body = document.createElement("div");
  Object.assign(body.style, {
    width: "100%",
    maxWidth: "1000px",
  });

  overlay.appendChild(header);
  overlay.appendChild(body);

  function close() {
    overlay.remove();
    document.removeEventListener("keydown", onKeydown);
  }

  function onKeydown(e) {
    if (e.key === "Escape") close();
  }

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKeydown);

  document.body.appendChild(overlay);

  return { overlay, body, close };
}

// =====================================================================
// GALLERY
// =====================================================================

function youtubeThumbUrl(videoId) {
  return "https://img.youtube.com/vi/" + videoId + "/hqdefault.jpg";
}

// -----------------------------------------------------
// openLightbox — full-bleed viewer for a single gallery item, with
// prev/next arrows cycling through GALLERY_ITEMS. Reuses one overlay
// and just swaps its content on navigation rather than rebuilding.
// -----------------------------------------------------
function openLightbox(startIndex) {
  let index = startIndex;

  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(0, 0, 0, 0.95)",
    zIndex: "2100",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  });

  const stage = document.createElement("div");
  Object.assign(stage.style, {
    maxWidth: "90vw",
    maxHeight: "85vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "12px",
  });
  overlay.appendChild(stage);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕";
  Object.assign(closeBtn.style, {
    position: "fixed",
    top: "20px",
    right: "20px",
    background: "rgba(255,255,255,0.12)",
    border: "none",
    color: "#fff",
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    fontSize: "18px",
    cursor: "pointer",
    zIndex: "2101",
  });
  overlay.appendChild(closeBtn);

  function arrowButton(symbol, side) {
    const btn = document.createElement("button");
    btn.textContent = symbol;
    Object.assign(btn.style, {
      position: "fixed",
      top: "50%",
      [side]: "20px",
      transform: "translateY(-50%)",
      background: "rgba(255,255,255,0.12)",
      border: "none",
      color: "#fff",
      width: "44px",
      height: "44px",
      borderRadius: "50%",
      fontSize: "20px",
      cursor: "pointer",
      zIndex: "2101",
    });
    overlay.appendChild(btn);
    return btn;
  }

  const prevBtn = arrowButton("‹", "left");
  const nextBtn = arrowButton("›", "right");

  const caption = document.createElement("div");
  Object.assign(caption.style, {
    color: "#ddd",
    fontFamily: "system-ui, sans-serif",
    fontSize: "13px",
  });

  function render() {
    stage.innerHTML = "";
    const item = GALLERY_ITEMS[index];

    if (item.type === "youtube") {
      const iframe = document.createElement("iframe");
      iframe.src = "https://www.youtube.com/embed/" + item.videoId + "?autoplay=1";
      iframe.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
      iframe.setAttribute("allowfullscreen", "true");
      iframe.style.border = "none";
      iframe.style.width = "min(90vw, 960px)";
      iframe.style.height = "min(60vh, 540px)";
      iframe.style.borderRadius = "8px";
      stage.appendChild(iframe);
    } else {
      const img = document.createElement("img");
      img.src = item.src;
      img.alt = item.caption || "";
      Object.assign(img.style, {
        maxWidth: "90vw",
        maxHeight: "78vh",
        borderRadius: "8px",
        objectFit: "contain",
      });
      stage.appendChild(img);
    }

    caption.textContent = item.caption
      ? item.caption + "  (" + (index + 1) + " / " + GALLERY_ITEMS.length + ")"
      : (index + 1) + " / " + GALLERY_ITEMS.length;
    stage.appendChild(caption);
  }

  function go(delta) {
    index = (index + delta + GALLERY_ITEMS.length) % GALLERY_ITEMS.length;
    render();
  }

  function close() {
    overlay.remove();
    document.removeEventListener("keydown", onKeydown);
  }

  function onKeydown(e) {
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft") go(-1);
    if (e.key === "ArrowRight") go(1);
  }

  closeBtn.addEventListener("click", close);
  prevBtn.addEventListener("click", function () { go(-1); });
  nextBtn.addEventListener("click", function () { go(1); });
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKeydown);

  render();
  document.body.appendChild(overlay);
}

function openGalleryModal() {
  const { body } = createModalShell("GALLERY");

  const grid = document.createElement("div");
  Object.assign(grid.style, {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: "14px",
  });

  GALLERY_ITEMS.forEach(function (item, i) {
    const thumbWrap = document.createElement("div");
    Object.assign(thumbWrap.style, {
      position: "relative",
      cursor: "pointer",
      borderRadius: "8px",
      overflow: "hidden",
      aspectRatio: "4 / 3",
      background: "#222",
    });

    const img = document.createElement("img");
    img.src = item.type === "youtube" ? youtubeThumbUrl(item.videoId) : item.src;
    img.alt = item.caption || "";
    Object.assign(img.style, {
      width: "100%",
      height: "100%",
      objectFit: "cover",
      display: "block",
    });
    thumbWrap.appendChild(img);

    if (item.type === "youtube") {
      const playBadge = document.createElement("div");
      playBadge.textContent = "▶";
      Object.assign(playBadge.style, {
        position: "absolute",
        inset: "0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "36px",
        color: "#fff",
        background: "rgba(0,0,0,0.25)",
      });
      thumbWrap.appendChild(playBadge);
    }

    thumbWrap.addEventListener("click", function () {
      openLightbox(i);
    });

    grid.appendChild(thumbWrap);
  });

  body.appendChild(grid);
}

// =====================================================================
// AMENITIES
// =====================================================================

function openAmenitiesModal() {
  const { body } = createModalShell("AMENITIES");

  const grid = document.createElement("div");
  Object.assign(grid.style, {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
    gap: "14px",
  });

  AMENITIES.forEach(function (item) {
    const card = document.createElement("div");
    Object.assign(card.style, {
      background: "rgba(255,255,255,0.06)",
      borderRadius: "10px",
      padding: "22px 12px",
      textAlign: "center",
      fontFamily: "system-ui, sans-serif",
    });

    const icon = document.createElement("div");
    icon.textContent = item.icon || "•";
    Object.assign(icon.style, { fontSize: "32px", marginBottom: "10px" });
    card.appendChild(icon);

    const label = document.createElement("div");
    label.textContent = item.label;
    Object.assign(label.style, { color: "#fff", fontSize: "13px" });
    card.appendChild(label);

    grid.appendChild(card);
  });

  body.appendChild(grid);
}

// =====================================================================
// initGalleryAmenities — call once, any time after <body> exists.
// Creates the two top-left buttons, positioned below the existing
// "Copy Plot IDs" button (top:16 / height ~36px), so this panel
// starts at top:64 to clear it with a small gap.
// =====================================================================
export function initGalleryAmenities() {
  if (document.getElementById("gallery-btn")) return;

  const galleryBtn = makeTopLeftButton("gallery-btn", "Gallery", "64px");
  galleryBtn.addEventListener("click", openGalleryModal);

  const amenitiesBtn = makeTopLeftButton("amenities-btn", "Amenities", "108px");
  amenitiesBtn.addEventListener("click", openAmenitiesModal);
}