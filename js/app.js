import { parseProfile, parseSummary, formatStation } from "./parse.js";
import { buildSections, buildLongitudinal } from "./model.js";
import { renderChart, surfaceColor, DEFAULTS, DEFAULT_WIDTHS } from "./chart.js";
import { buildDocx } from "./docx.js";
import { isAvailable as historyAvailable, listRuns, saveRun, deleteRun, clearRuns } from "./history.js";
import { buildRunReport, reportFilename } from "./report.js";
import { trimmedDatasets } from "./trim.js";

const $ = (id) => document.getElementById(id);
const CANVAS_W = 1300, CANVAS_H = 772;
const IN_W = 6.5, IN_H = (CANVAS_H / CANVAS_W) * IN_W;

const PRESETS = {
  existing: ["2-year", "100-year", "500-year"],
  proposed: ["2-year", "100-year", "500-year", "2080 100-year"],
};

let state = { sections: [], canvases: [], order: "asc", styles: { sections: {}, long: {} }, longitudinal: null, view: "sections", legend: { anchor: "right-middle", offX: 0, offY: 0 }, markerLabels: "auto", markerOverrides: {} };
const LEGEND_POSITIONS = [["right-middle", "Right (middle)"], ["top-right", "Top-right"], ["bottom-right", "Bottom-right"], ["top-left", "Top-left"], ["bottom-left", "Bottom-left"], ["top-center", "Top-center"], ["bottom-center", "Bottom-center"], ["left-middle", "Left (middle)"]];
const LEGEND_NUDGE = 24;   // canvas px per Move click
let messageTimer = null;

// Named line styles for the per-event picker (label → key matches chart.js LINE_STYLES).
const STYLE_OPTIONS = [["solid", "Solid"], ["dashed", "Dashed"], ["longDash", "Long dash"], ["dashDot", "Dash-dot"], ["dotted", "Dotted"]];
const rgbToHex = (c) => {
  if (!c) return "#000000";
  if (c[0] === "#") return c;
  const m = c.match(/\d+/g) || [0, 0, 0];
  return "#" + m.slice(0, 3).map((n) => (+n).toString(16).padStart(2, "0")).join("");
};

// Numeric sort key from a station: prefer the matched value, else parse "10+47".
function stationKey(sec) {
  if (typeof sec.station === "number" && isFinite(sec.station)) return sec.station;
  const m = /(-?\d+)\s*\+\s*(\d+(?:\.\d+)?)/.exec(sec.stationLabel || "");
  if (m) return parseInt(m[1], 10) * 100 + parseFloat(m[2]);
  return sec.index;
}
function orderedSections() {
  const sorted = [...state.sections].sort((a, b) => stationKey(a) - stationKey(b));
  return state.order === "desc" ? sorted.reverse() : sorted;
}

// ---------- event-list editor ----------
function eventRows() {
  return [...document.querySelectorAll("#eventList input")].map((i) => i.value.trim()).filter(Boolean);
}
function renderEventList(values) {
  const ul = $("eventList");
  ul.innerHTML = "";
  values.forEach((v, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="idx">${i + 1}.</span>
      <input type="text" value="${escapeAttr(v)}" placeholder="e.g. 2-year" />
      <button class="mini up" title="Move up">↑</button>
      <button class="mini down" title="Move down">↓</button>
      <button class="mini del" title="Remove">✕</button>`;
    ul.appendChild(li);
  });
  ul.querySelectorAll(".del").forEach((b, i) =>
    b.addEventListener("click", () => { const v = eventRows(); v.splice(i, 1); renderEventList(v); })
  );
  ul.querySelectorAll(".up").forEach((b, i) =>
    b.addEventListener("click", () => { const v = eventRows(); if (i > 0) { [v[i - 1], v[i]] = [v[i], v[i - 1]]; renderEventList(v); } })
  );
  ul.querySelectorAll(".down").forEach((b, i) =>
    b.addEventListener("click", () => { const v = eventRows(); if (i < v.length - 1) { [v[i + 1], v[i]] = [v[i], v[i + 1]]; renderEventList(v); } })
  );
}

// ---------- messages ----------
function setMessages(items) {
  const box = $("messages");
  if (messageTimer) {
    clearTimeout(messageTimer);
    messageTimer = null;
  }
  box.innerHTML = "";
  if (!items || !items.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;

  const counts = items.reduce((acc, m) => {
    const type = m.type === "error" ? "error" : m.type === "ok" ? "ok" : "warn";
    acc[type] += 1;
    return acc;
  }, { ok: 0, warn: 0, error: 0 });
  const worst = counts.error ? "error" : counts.warn ? "warn" : "ok";
  const firstOk = items.find((m) => m.type === "ok")?.text || "Ready.";
  const issueCount = counts.error + counts.warn;
  const issueText = [
    counts.error ? `${counts.error} error${counts.error === 1 ? "" : "s"}` : "",
    counts.warn ? `${counts.warn} warning${counts.warn === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" · ");

  const panel = document.createElement("section");
  panel.className = `msg-panel ${worst}`;
  panel.setAttribute("aria-live", worst === "error" ? "assertive" : "polite");
  panel.innerHTML = `
    <div class="msg-head">
      <span class="msg-dot"></span>
      <div class="msg-title">
        <strong>${escapeHtml(worst === "ok" ? "Generated" : "Diagnostics")}</strong>
        <span>${escapeHtml(issueCount ? `${firstOk} ${issueText}.` : firstOk)}</span>
      </div>
      ${issueCount ? `<button type="button" class="msg-toggle" aria-expanded="false">Details</button>` : ""}
      <button type="button" class="msg-close" aria-label="Close diagnostics">x</button>
    </div>
    ${issueCount ? `<div class="msg-details" hidden>
      <ol>${items.filter((m) => m.type !== "ok").map((m) => `<li class="${m.type === "error" ? "is-error" : "is-warn"}">${escapeHtml(m.text)}</li>`).join("")}</ol>
    </div>` : ""}
  `;
  const close = () => { box.hidden = true; box.innerHTML = ""; };
  panel.querySelector(".msg-close").addEventListener("click", close);
  const toggle = panel.querySelector(".msg-toggle");
  const details = panel.querySelector(".msg-details");
  if (toggle && details) {
    toggle.addEventListener("click", () => {
      const open = details.hidden;
      details.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "Hide" : "Details";
    });
  }
  box.appendChild(panel);
  if (!issueCount) messageTimer = setTimeout(close, 4500);
}

// ---------- generate ----------
function generate() {
  const events = eventRows();
  const conditionLabel = $("condition").value.trim();
  const roundingMode = "nearest"; // stations are always rounded to the nearest foot
  const { rows: summaryRows, warnings: sumW } = parseSummary($("summary").value || "");
  const { pairs, warnings: profW } = parseProfile($("profile").value || "");

  if (!pairs.length) { setMessages([{ type: "error", text: "No profile data found — paste the SMS View Values output in step 3." }]); return; }
  if (!events.length && !summaryRows.length) {
    setMessages([{ type: "error", text: "Add at least one flow event (step 1) or paste a Summary Table (step 2) so the section size is known." }]);
    return;
  }

  let result;
  try {
    result = buildSections(pairs, summaryRows, { events, conditionLabel, roundingMode });
  } catch (e) {
    setMessages([{ type: "error", text: e.message }]);
    return;
  }
  state.sections = result.sections;

  const msgs = [];
  const allW = [...sumW, ...profW, ...result.warnings];
  if (allW.length) allW.forEach((w) => msgs.push({ type: "warn", text: w }));
  msgs.unshift({
    type: "ok",
    text: `Generated ${result.sections.length} cross section${result.sections.length === 1 ? "" : "s"} · ${result.datasetsPerSection} datasets each (1 ground + ${result.datasetsPerSection - 1} surface${result.datasetsPerSection - 1 === 1 ? "" : "s"}).`,
  });
  setMessages(msgs);
  state.view = "sections";
  renderResults(conditionLabel);
  $("download").disabled = state.sections.length === 0;
  // tidy the rail: collapse the shared summary + history (keep the cross-section
  // builder open — it holds the display options, line styles, and download)
  if (state.sections.length) ["step2", "historyPanel"].forEach((id) => ($(id).open = false));

  // save these inputs to local history (text from steps 1-3, not the charts)
  saveRun({ ...currentInputs(), count: result.sections.length });
  renderHistory();
}

// snapshot of the current step 1-3 inputs
function currentInputs() {
  return {
    condition: $("condition").value.trim(),
    events: eventRows(),
    summary: $("summary").value,
    profile: $("profile").value,
    longitudinal: $("longitudinalPaste").value,
    stationStart: $("stationStart").value,
    options: {
      optEarth: $("optEarth").checked,
      optWater: $("optWater").checked,
      optThalweg: $("optThalweg").checked,
      optLegend: $("optLegend").checked,
      loptEarth: $("loptEarth").checked,
      loptWater: $("loptWater").checked,
      styles: state.styles,
      legend: { ...state.legend },
      markerLabels: state.markerLabels,
      markerOverrides: { ...state.markerOverrides },
    },
  };
}

// explicit "Save inputs" — store the pasted values without generating charts
function saveInputs() {
  if (!$("summary").value.trim() && !$("profile").value.trim() && !$("longitudinalPaste").value.trim()) {
    setMessages([{ type: "warn", text: "Nothing to save yet — paste your Summary Table, profile, or longitudinal values first." }]);
    return;
  }
  saveRun(currentInputs());
  renderHistory();
  setMessages([{ type: "ok", text: "Inputs saved to this device. Reload them anytime from “Saved inputs” at the top." }]);
}

function chartOptions() {
  return {
    showEarthFill: $("optEarth").checked,
    showInundation: $("optWater").checked,
    showThalweg: $("optThalweg").checked,
    legendInside: $("optLegend").checked,
    styles: state.styles.sections,
  };
}

function renderResults(conditionLabel) {
  const wrap = $("results");
  wrap.innerHTML = "";
  state.canvases = [];
  $("resultsPlaceholder").hidden = state.sections.length > 0;
  if (state.longitudinal) wrap.appendChild(viewToggle());

  // nav: order toggle + station chips
  const nav = document.createElement("div");
  nav.className = "results-nav";
  if (state.sections.length > 1) {
    const bar = document.createElement("div");
    bar.className = "order-bar";
    bar.innerHTML = `<span>Ordered by station — <strong>${state.order === "asc" ? "ascending" : "descending"}</strong></span>
      <button id="orderToggle" class="ghost small">Switch to ${state.order === "asc" ? "descending" : "ascending"}</button>`;
    nav.appendChild(bar);
    bar.querySelector("#orderToggle").addEventListener("click", () => {
      state.order = state.order === "asc" ? "desc" : "asc";
      renderResults(conditionLabel);
    });
  }
  const chips = document.createElement("div");
  chips.className = "station-nav";
  nav.appendChild(chips);
  wrap.appendChild(nav);

  refreshStylePanel("sections");   // cross-section line styles (in the step-3 group)

  // horizontal slider of charts
  const strip = document.createElement("div");
  strip.className = "chart-strip";
  wrap.appendChild(strip);

  const chipFor = new Map();
  const setActiveChip = (card) => {
    chips.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    const chip = chipFor.get(card);
    if (chip) chip.classList.add("active");
  };
  // highlight the chip whose chart is centered as you scroll
  const observer = new IntersectionObserver(
    (entries) => {
      let best = null;
      for (const e of entries) if (e.isIntersecting && (!best || e.intersectionRatio > best.intersectionRatio)) best = e;
      if (best && best.intersectionRatio > 0.5) setActiveChip(best.target);
    },
    { root: strip, threshold: [0.25, 0.5, 0.75, 1] }
  );

  const sel = (v, x) => (String(v) === String(x) ? " selected" : "");
  orderedSections().forEach((sec, i) => {
    const card = document.createElement("div");
    card.className = "chart-card";
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W; canvas.height = CANVAS_H;
    card.appendChild(canvas);

    // station chip that scrolls the slider to this chart
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = sec.stationLabel || `#${i + 1}`;
    chip.addEventListener("click", () => {
      card.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      setActiveChip(card);
    });
    chips.appendChild(chip);
    chipFor.set(card, chip);

    const st = sec.structure;
    const curKind = st ? (st.kind || "box") : "";   // legacy box structures have no kind
    const tools = document.createElement("div");
    tools.className = "chart-tools";
    tools.innerHTML = `
      <label class="grow">Station label
        <input type="text" class="station" value="${escapeAttr(sec.stationLabel || "")}" />
      </label>
      <label>Y min <input type="number" step="0.5" class="ymin small-input" value="${sec.yOverride ? sec.yOverride.min : ""}" /></label>
      <label>Y max <input type="number" step="0.5" class="ymax small-input" value="${sec.yOverride ? sec.yOverride.max : ""}" /></label>
      <label>Culvert
        <select class="stype">
          <option value=""${sel("", curKind)}>None</option>
          <option value="box"${sel("box", curKind)}>Box</option>
          <option value="arch"${sel("arch", curKind)}>Arch</option>
          <option value="circle"${sel("circle", curKind)}>Circular</option>
          <option value="ellipse"${sel("ellipse", curKind)}>Ellipse</option>
        </select>
      </label>
      ${sec.outlierCount > 0 ? `<label class="chk trim-toggle" title="Remove disconnected extra-area points (SMS stray segments) from this section">
        <input type="checkbox" class="ctrim"${sec.trimmed ? " checked" : ""} /> Trim ${sec.outlierCount} outlier${sec.outlierCount === 1 ? "" : "s"}
      </label>` : ""}
      <span class="culvert-fields"${st ? "" : ' hidden'}>
        <label>Scour (ft) <input type="number" step="0.1" class="cscour small-input" value="${st ? st.scour : ""}" /></label>
        <span class="kf kf-box"><label>Box height (ft) <input type="number" step="0.1" class="cheight small-input" value="${st && st.height != null ? st.height : ""}" /></label>
          <label>Width (ft) <input type="number" step="0.1" class="cwidth small-input" value="${st && st.width != null ? st.width : ""}" /></label></span>
        <span class="kf kf-arch"><label>Span (ft) <input type="number" step="0.1" class="cspan small-input" value="${st && st.span != null ? st.span : ""}" /></label>
          <label>Leg height (ft) <input type="number" step="0.1" class="cleg small-input" value="${st && st.legHeight != null ? st.legHeight : ""}" /></label>
          <label>Rise (ft) <input type="number" step="0.1" class="crise small-input" value="${st && st.rise != null ? st.rise : ""}" /></label></span>
        <span class="kf kf-circle"><label>Diameter (ft) <input type="number" step="0.1" class="cdia small-input" value="${st && st.diameter != null ? st.diameter : ""}" /></label></span>
        <span class="kf kf-ellipse"><label>Width (ft) <input type="number" step="0.1" class="cew small-input" value="${st && st.width != null ? st.width : ""}" /></label>
          <label>Height (ft) <input type="number" step="0.1" class="ceh small-input" value="${st && st.height != null ? st.height : ""}" /></label></span>
        <label>Center X <input type="number" step="0.5" class="ccenter small-input" placeholder="thalweg" value="${st && st.center != null ? st.center : ""}" /></label>
        <label>Bed (ft) <input type="number" step="0.1" class="cbed small-input" value="${st ? st.bed : 2}" /></label>
      </span>`;
    card.appendChild(tools);

    const cap = document.createElement("div");
    cap.className = "caption-preview";
    card.appendChild(cap);
    strip.appendChild(card);
    observer.observe(card);

    const ctx = canvas.getContext("2d");
    const cond = $("condition").value.trim();
    const draw = () => {
      renderChart(ctx, CANVAS_W, CANVAS_H, sec, chartOptions());
      cap.textContent = `${cond ? cond + ", " : ""}Cross Section at Station ${sec.stationLabel || "?"}`;
    };
    draw();
    state.canvases.push({ canvas, sec, redraw: draw });

    // wiring
    tools.querySelector(".station").addEventListener("input", (e) => {
      sec.stationLabel = e.target.value;
      chip.textContent = sec.stationLabel || `#${i + 1}`;
      cap.textContent = `${cond ? cond + ", " : ""}Cross Section at Station ${sec.stationLabel || "?"}`;
    });
    const yminEl = tools.querySelector(".ymin"), ymaxEl = tools.querySelector(".ymax");
    const applyY = () => {
      const a = parseFloat(yminEl.value), b = parseFloat(ymaxEl.value);
      sec.yOverride = !isNaN(a) && !isNaN(b) && b > a ? { min: a, max: b } : null;
      draw();
    };
    yminEl.addEventListener("change", applyY); ymaxEl.addEventListener("change", applyY);

    const stype = tools.querySelector(".stype");
    const fields = tools.querySelector(".culvert-fields");
    const scourEl = tools.querySelector(".cscour"), bedEl = tools.querySelector(".cbed"), centerEl = tools.querySelector(".ccenter");
    const num = (s) => parseFloat(tools.querySelector(s).value);
    const thalwegX = sec.ground.dist[argmin(sec.ground.val)];
    const showKindFields = (kind) => tools.querySelectorAll(".kf").forEach((el) => (el.hidden = !el.classList.contains(`kf-${kind}`)));
    const applyStruct = () => {
      const kind = stype.value;                              // "" | box | arch | circle | ellipse
      fields.hidden = !kind;
      showKindFields(kind);
      if (!kind) { sec.structure = null; draw(); return; }
      const scour = num(".cscour");
      let bed = num(".cbed"); if (isNaN(bed)) bed = 2;
      if (isNaN(scour)) { sec.structure = null; draw(); return; }
      const centerRaw = num(".ccenter"), center = isNaN(centerRaw) ? null : centerRaw;
      const bottom = sec.groundMin - scour - bed;
      const base = { type: "Culvert", kind, scour, bed, center, x: center == null ? thalwegX : center, bottom };
      // Each shape needs its own dimensions; wait (clear) until they're all present.
      let st2 = null;
      if (kind === "box") {
        const height = num(".cheight"), width = num(".cwidth");
        if (!isNaN(height) && !isNaN(width)) st2 = { ...base, height, width, top: bottom + height };
      } else if (kind === "arch") {
        const span = num(".cspan"), rise = num(".crise"); let leg = num(".cleg"); if (isNaN(leg)) leg = 0;
        if (!isNaN(span) && !isNaN(rise)) st2 = { ...base, span, legHeight: leg, rise, top: bottom + leg + rise };
      } else if (kind === "circle") {
        const diameter = num(".cdia");
        if (!isNaN(diameter)) st2 = { ...base, diameter, top: bottom + diameter };
      } else if (kind === "ellipse") {
        const width = num(".cew"), height = num(".ceh");
        if (!isNaN(width) && !isNaN(height)) st2 = { ...base, width, height, top: bottom + height };
      }
      sec.structure = st2;
      draw();
    };
    showKindFields(curKind);
    [stype, ...tools.querySelectorAll(".culvert-fields input")].forEach((el) => el.addEventListener("input", applyStruct));

    // optional per-chart trim of disconnected "extra area" points (user-driven)
    const trimEl = tools.querySelector(".ctrim");
    if (trimEl) {
      trimEl.addEventListener("change", () => {
        if (!sec._raw) sec._raw = { ground: sec.ground, surfaces: sec.surfaces };
        if (trimEl.checked) {
          const t = trimmedDatasets(sec._raw); // always trim from the raw data
          sec.ground = t.ground; sec.surfaces = t.surfaces; sec.trimmed = true;
        } else {
          sec.ground = sec._raw.ground; sec.surfaces = sec._raw.surfaces; sec.trimmed = false;
        }
        draw();
      });
    }
  });

  const firstChip = chips.querySelector(".chip");
  if (firstChip) firstChip.classList.add("active");
}

// redraw all when global options change
function redrawAll() { state.canvases.forEach((c) => c.redraw()); state.longitudinal && state.view === "long" && drawLongitudinal(); }

// ---------- longitudinal profile (one reach along the centerline) ----------
function genLongitudinal() {
  const text = $("longitudinalPaste").value || "";
  if (!text.trim()) return setMessages([{ type: "warn", text: "Paste the SMS observation-profile values for the centerline first." }]);
  const events = eventRows();
  const { pairs, warnings } = parseProfile(text, { keepGaps: true });
  let sec;
  try { sec = buildLongitudinal(pairs, { events, conditionLabel: $("condition").value.trim() }); }
  catch (e) { return setMessages([{ type: "error", text: e.message }]); }
  state.longitudinal = sec;
  state.view = "long";
  const msgs = warnings.map((w) => ({ type: "warn", text: w }));
  msgs.unshift({ type: "ok", text: `Longitudinal profile: ground + ${sec.surfaces.length} water surface${sec.surfaces.length === 1 ? "" : "s"} along the reach.` });
  setMessages(msgs);
  renderView();
}

// markers from the Summary Table stations (if pasted), mapped to profile distance
function longitudinalMarkers(stationStart) {
  const { rows } = parseSummary($("summary").value || "");
  return rows
    .map((r) => ({ dist: r.station - stationStart, label: formatStation(r.station) }))
    .sort((a, b) => a.dist - b.dist);
}

function longitudinalOptions() {
  const startRaw = parseFloat($("stationStart").value);
  // auto start station: round the lowest cross-section station down to 100 ft
  const { rows } = parseSummary($("summary").value || "");
  const autoStart = rows.length ? Math.floor(Math.min(...rows.map((r) => r.station)) / 100) * 100 : 0;
  const stationStart = Number.isFinite(startRaw) ? startRaw : autoStart;
  return {
    xTitle: "Station (feet)",
    note: "",                // self-evident on a longitudinal profile; frees space for X-section labels
    showEarthFill: $("loptEarth").checked,           // longitudinal's own display options
    showInundation: $("loptWater").checked,
    showThalweg: false,      // single bed minimum isn't meaningful over a whole reach
    legendAnchor: state.legend.anchor,
    legendOffX: state.legend.offX,
    legendOffY: state.legend.offY,
    stationStart,
    markers: longitudinalMarkers(stationStart),
    markerLabels: state.markerLabels,
    markerOverrides: state.markerOverrides,
    styles: state.styles.long,
  };
}

let longCanvas = null, longMarkerBoxes = [];
function drawLongitudinal() {
  if (!longCanvas || !state.longitudinal) return;
  const out = renderChart(longCanvas.getContext("2d"), longCanvas.width, longCanvas.height, state.longitudinal, longitudinalOptions());
  longMarkerBoxes = (out && out.markerBoxes) || [];
}
// map a pointer event on the (CSS-scaled) canvas to the marker label box under it
function markerBoxAt(e) {
  const rect = longCanvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (longCanvas.width / rect.width);
  const y = (e.clientY - rect.top) * (longCanvas.height / rect.height);
  return longMarkerBoxes.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
}

function renderLongitudinal() {
  const wrap = $("results");
  wrap.innerHTML = "";
  state.canvases = [];
  $("resultsPlaceholder").hidden = true;
  wrap.appendChild(viewToggle());

  const card = document.createElement("div");
  card.className = "chart-card long-card";
  const W = 1700, H = Math.round((CANVAS_H / CANVAS_W) * W * 0.82);
  longCanvas = document.createElement("canvas");
  longCanvas.width = W; longCanvas.height = H;
  longCanvas.className = "chart-canvas long-canvas";
  longCanvas.title = "Click a station label to flip it top ↔ bottom";
  longCanvas.addEventListener("click", (e) => {
    const box = markerBoxAt(e);
    if (!box) return;
    state.markerOverrides = { ...state.markerOverrides, [box.label]: box.side === "top" ? "bottom" : "top" };
    drawLongitudinal();
  });
  longCanvas.addEventListener("mousemove", (e) => { longCanvas.style.cursor = markerBoxAt(e) ? "pointer" : "default"; });
  card.appendChild(longCanvas);
  const card_hint = document.createElement("p");
  card_hint.className = "hint tiny long-hint";
  card_hint.innerHTML = "Tip: click any <strong>station label</strong> on the figure to flip it between top and bottom.";
  card.appendChild(card_hint);
  const actions = document.createElement("div");
  actions.className = "long-actions";
  actions.innerHTML = `
    <label class="inline">X-section labels
      <select class="mark-pos">${[["auto", "Auto"], ["top", "Top"], ["bottom", "Bottom"]].map(([v, l]) => `<option value="${v}"${v === state.markerLabels ? " selected" : ""}>${l}</option>`).join("")}</select>
    </label>
    <label class="inline">Legend
      <select class="leg-pos">${LEGEND_POSITIONS.map(([v, l]) => `<option value="${v}"${v === state.legend.anchor ? " selected" : ""}>${l}</option>`).join("")}</select>
    </label>
    <span class="leg-nudge"><span class="ctrl-lbl">Move legend</span>
      <button class="ghost small" data-d="L" title="Left">◀</button>
      <button class="ghost small" data-d="U" title="Up">▲</button>
      <button class="ghost small" data-d="D" title="Down">▼</button>
      <button class="ghost small" data-d="R" title="Right">▶</button>
      <button class="ghost small" data-d="0" title="Reset position">reset</button>
    </span>`;
  actions.querySelector(".mark-pos").addEventListener("change", (e) => { state.markerLabels = e.target.value; state.markerOverrides = {}; drawLongitudinal(); });
  actions.querySelector(".leg-pos").addEventListener("change", (e) => { state.legend.anchor = e.target.value; drawLongitudinal(); });
  actions.querySelectorAll(".leg-nudge button").forEach((b) => b.addEventListener("click", () => {
    const d = b.dataset.d;
    if (d === "0") { state.legend.offX = 0; state.legend.offY = 0; }
    else if (d === "L") state.legend.offX -= LEGEND_NUDGE;
    else if (d === "R") state.legend.offX += LEGEND_NUDGE;
    else if (d === "U") state.legend.offY -= LEGEND_NUDGE;
    else if (d === "D") state.legend.offY += LEGEND_NUDGE;
    drawLongitudinal();
  }));
  card.appendChild(actions);
  wrap.appendChild(card);
  drawLongitudinal();
  refreshStylePanel("long");          // longitudinal's own line styles (in the step-4 group)
  $("dlLong").disabled = false;       // enable the rail "Download PNG"
}

// segmented control to switch the main area between the two views
function viewToggle() {
  const hasSecs = state.sections.length > 0, hasLong = !!state.longitudinal;
  const bar = document.createElement("div");
  bar.className = "view-toggle";
  if (!(hasSecs && hasLong)) return bar;     // only show when both exist
  bar.innerHTML = `<button class="seg${state.view === "sections" ? " active" : ""}" data-view="sections">Cross sections</button>
    <button class="seg${state.view === "long" ? " active" : ""}" data-view="long">Longitudinal profile</button>`;
  bar.querySelectorAll(".seg").forEach((b) => b.addEventListener("click", () => {
    state.view = b.dataset.view; renderView();
  }));
  return bar;
}

function renderView() {
  if (state.view === "long" && state.longitudinal) renderLongitudinal();
  else { state.view = "sections"; renderResults($("condition").value.trim()); }
}

// Every line on the plot — ground, each water-surface flow, and the culvert — is
// fully customizable: color + line type + thickness. Applied consistently across
// every section chart and its legend. Lets close flows (e.g. 42 vs 43 CFS) be told
// apart by contrasting color, line type, AND weight.
// view = "sections" | "long" — each figure type has its own line styles
function lineDescriptors(view) {
  const sample = view === "long" ? state.longitudinal : state.sections[0];
  if (!sample) return [];
  const out = [{ key: "__ground__", label: sample.ground.name || "Ground", defColor: DEFAULTS.groundColor, defStyle: "solid", defWidth: DEFAULT_WIDTHS.ground }];
  const n = sample.surfaces.length;
  sample.surfaces.forEach((s, i) => {
    const def = surfaceColor(s.name, i, n);
    out.push({ key: s.name, label: s.name, defColor: def.color, defStyle: def.dash ? "dashed" : "solid", defWidth: DEFAULT_WIDTHS.surface });
  });
  if (view === "sections" && state.sections.some((sec) => sec.structure)) {
    out.push({ key: "__culvert__", label: "Culvert", defColor: DEFAULTS.structureColor, defStyle: "solid", defWidth: DEFAULT_WIDTHS.culvert });
  }
  return out;
}
function buildStylePanel(view) {
  const lines = lineDescriptors(view), styles = state.styles[view];
  if (!lines.length) return null;
  const wrap = document.createElement("details");
  wrap.className = "style-panel";
  wrap.open = false;
  const rows = lines.map((ln) => {
    const cur = styles[ln.key] || {};
    const color = rgbToHex(cur.color || ln.defColor);
    const style = cur.style || ln.defStyle;
    const width = cur.width != null ? cur.width : ln.defWidth;
    return `<div class="style-row" data-key="${escapeAttr(ln.key)}">
      <input type="color" class="ls-color" value="${color}" title="Line color" />
      <span class="ls-name">${escapeHtml(ln.label)}</span>
      <select class="ls-style" title="Line type">
        ${STYLE_OPTIONS.map(([k, label]) => `<option value="${k}"${k === style ? " selected" : ""}>${label}</option>`).join("")}
      </select>
      <label class="ls-wlabel">w<input type="number" class="ls-width" min="0.5" max="8" step="0.5" value="${width}" title="Line thickness" /></label>
    </div>`;
  }).join("");
  wrap.innerHTML = `<summary>Per-line color, type &amp; thickness</summary><div class="style-rows">${rows}</div>`;
  wrap.open = true;
  wrap.querySelectorAll(".style-row").forEach((row) => {
    const key = row.dataset.key;
    row.querySelector(".ls-color").addEventListener("input", (e) => setStyle(view, key, { color: e.target.value }));
    row.querySelector(".ls-style").addEventListener("change", (e) => setStyle(view, key, { style: e.target.value }));
    row.querySelector(".ls-width").addEventListener("input", (e) => {
      const w = parseFloat(e.target.value);
      setStyle(view, key, { width: isNaN(w) ? undefined : w });
    });
  });
  return wrap;
}
function setStyle(view, key, patch) {
  state.styles[view][key] = { ...(state.styles[view][key] || {}), ...patch };
  if (view === "long") drawLongitudinal(); else redrawAll();
}
// (re)populate a figure group's line-style host from its built data
function refreshStylePanel(view) {
  const host = $(view === "long" ? "lineStylesHostLong" : "lineStylesHostSections");
  if (!host) return;
  const sp = buildStylePanel(view);
  host.innerHTML = sp ? "" : '<p class="hint tiny">Appears after you generate.</p>';
  if (sp) host.appendChild(sp);
}

// ---------- download ----------
async function download() {
  if (!state.sections.length) return;
  const cond = $("condition").value.trim();
  const charts = state.canvases.map(({ canvas, sec }) => ({
    png: pngBytes(canvas),
    caption: `${cond ? cond + ", " : ""}Cross Section at Station ${sec.stationLabel || "?"}`,
    widthIn: IN_W, heightIn: IN_H,
  }));
  const bytes = buildDocx(charts);
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(cond || "Appendix H").replace(/[^\w]+/g, "_")}_Cross_Sections.docx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------- diagnostic report (saved runs only) ----------
function downloadReport(run) {
  const text = buildRunReport(run, { now: new Date().toISOString() });
  downloadText(reportFilename(run), text);
  setMessages([{ type: "ok", text: "Diagnostic report downloaded — share the .txt to debug station matching." }]);
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function pngBytes(canvas) {
  const dataUrl = canvas.toDataURL("image/png");
  const b64 = dataUrl.split(",")[1];
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- helpers ----------
function argmin(a) { let k = 0; for (let i = 1; i < a.length; i++) if (a[i] < a[k]) k = i; return k; }
function escapeAttr(s) { return String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;"); }
function escapeHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// auto-count hint as the user types
function updateAutoCount() {
  const { rows } = parseSummary($("summary").value || "");
  const { pairs } = parseProfile($("profile").value || "");
  const el = $("autoCount");
  if (pairs.length && rows.length) {
    const dps = pairs.length / rows.length;
    el.textContent = Number.isInteger(dps)
      ? `Detected ${rows.length} cross sections × ${dps} datasets (1 ground + ${dps - 1} surfaces).`
      : `⚠ ${pairs.length} datasets ÷ ${rows.length} sections isn't whole — check the event list / paste.`;
  } else el.textContent = "";
}

// ---------- restart ----------
function restart() {
  const hasData =
    $("summary").value.trim() || $("profile").value.trim() || state.sections.length;
  if (hasData && !window.confirm("Clear all inputs and start over?")) return;
  $("condition").value = "Existing Conditions";
  renderEventList(PRESETS.existing);
  $("summary").value = "";
  $("profile").value = "";
  ["optEarth", "optWater", "optThalweg", "optLegend", "loptEarth"].forEach((id) => ($(id).checked = true));
  $("loptWater").checked = false;
  state = { sections: [], canvases: [], order: "asc", styles: { sections: {}, long: {} }, longitudinal: null, view: "sections", legend: { anchor: "right-middle", offX: 0, offY: 0 }, markerLabels: "auto", markerOverrides: {} };
  $("results").innerHTML = "";
  $("longitudinalPaste").value = ""; $("stationStart").value = "";
  refreshStylePanel("sections"); refreshStylePanel("long");
  $("resultsPlaceholder").hidden = false;
  ["historyPanel", "step1", "step2", "step3", "step4"].forEach((id) => ($(id).open = false));
  $("messages").innerHTML = "";
  $("autoCount").textContent = "";
  $("download").disabled = true; $("dlLong").disabled = true;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- history ----------
function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function renderHistory() {
  const panel = $("historyPanel");
  if (!historyAvailable()) { panel.style.display = "none"; return; }
  const runs = listRuns();
  $("historyCount").textContent = runs.length ? `(${runs.length})` : "";
  const list = $("historyList");
  list.innerHTML = "";
  if (!runs.length) {
    const li = document.createElement("li");
    li.className = "history-empty";
    li.textContent = "No saved runs yet — generate charts and they'll appear here.";
    list.appendChild(li);
    return;
  }
  for (const run of runs) {
    const li = document.createElement("li");
    const events = (run.events || []).join(", ");
    const count = run.count ? ` · ${run.count} XS` : "";
    li.innerHTML = `
      <div class="hmeta">
        <div class="htitle">${escapeAttr(run.condition || "Saved inputs")}${count}</div>
        <div class="hsub">${escapeAttr(events)} — ${fmtDate(run.savedAt)}</div>
      </div>
      <div class="hactions">
        <button class="mini report" title="Download a .txt diagnostic (inputs + station matching + warnings)">Report</button>
        <button class="mini load">Load</button>
        <button class="mini del">Delete</button>
      </div>`;
    li.querySelector(".report").addEventListener("click", () => downloadReport(run));
    li.querySelector(".load").addEventListener("click", () => loadRun(run));
    li.querySelector(".del").addEventListener("click", () => {
      if (window.confirm("Delete this saved run?")) { deleteRun(run.id); renderHistory(); }
    });
    list.appendChild(li);
  }
}

function loadRun(run) {
  const dirty = $("summary").value.trim() || $("profile").value.trim() || state.sections.length;
  if (dirty && !window.confirm("Load these inputs? They will replace your current values.")) return;
  $("condition").value = run.condition || "";
  renderEventList(run.events && run.events.length ? run.events : PRESETS.existing);
  $("summary").value = run.summary || "";
  $("profile").value = run.profile || "";
  $("longitudinalPaste").value = run.longitudinal || "";
  $("stationStart").value = run.stationStart || "";
  const o = run.options || {};
  $("optEarth").checked = o.optEarth !== false;
  $("optWater").checked = o.optWater !== false;
  $("optThalweg").checked = o.optThalweg !== false;
  $("optLegend").checked = o.optLegend !== false;
  $("loptEarth").checked = o.loptEarth !== false;
  $("loptWater").checked = o.loptWater === true;
  // styles: support the new {sections,long} shape and legacy flat maps
  const s = o.styles && typeof o.styles === "object" ? o.styles : {};
  state.styles = (s.sections || s.long) ? { sections: { ...(s.sections || {}) }, long: { ...(s.long || {}) } } : { sections: { ...s }, long: {} };
  if (o.legend && typeof o.legend === "object") state.legend = { anchor: "right-middle", offX: 0, offY: 0, ...o.legend };
  if (o.markerLabels) state.markerLabels = o.markerLabels;
  state.markerOverrides = o.markerOverrides && typeof o.markerOverrides === "object" ? { ...o.markerOverrides } : {};
  updateAutoCount();
  // refill the inputs only — let the user review, then click Generate.
  $("historyPanel").open = false;
  ["step1", "step2", "step3"].forEach((id) => ($(id).open = true));   // reveal the loaded inputs
  setMessages([{ type: "ok", text: "Inputs loaded into steps 1–3. Review them, then click “Generate charts”." }]);
  $("summary").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- init ----------
renderEventList(PRESETS.existing);
renderHistory();
$("restart").addEventListener("click", restart);
$("clearHistory").addEventListener("click", () => {
  if (listRuns().length && window.confirm("Clear all saved runs on this device?")) { clearRuns(); renderHistory(); }
});
$("addEvent").addEventListener("click", () => renderEventList([...eventRows(), ""]));
document.querySelectorAll("[data-preset]").forEach((b) =>
  b.addEventListener("click", () => {
    renderEventList(PRESETS[b.dataset.preset]);
    $("condition").value = b.dataset.preset === "proposed" ? "Proposed Conditions" : "Existing Conditions";
  })
);
// ---- info tooltips: click to pin open, click-away / Esc to close ----
const INFO_GAP = 8, INFO_MARGIN = 12;
function closeInfoTip(tip) {
  tip.classList.remove("open");
  tip.querySelector(".info-i")?.setAttribute("aria-expanded", "false");
}
function closeInfoTips() {
  document.querySelectorAll(".infotip.open").forEach(closeInfoTip);
}
function placeInfoTip(tip) {
  const btn = tip?.querySelector(".info-i"), pop = tip?.querySelector(".info-pop");
  if (!btn || !pop) return;

  const btnRect = btn.getBoundingClientRect();
  const previousDisplay = pop.style.display, previousVisibility = pop.style.visibility;
  pop.style.display = "block";
  pop.style.visibility = "hidden";
  const popW = pop.offsetWidth, popH = pop.offsetHeight;
  pop.style.display = previousDisplay;
  pop.style.visibility = previousVisibility;

  const vw = window.innerWidth, vh = window.innerHeight;
  let left = btnRect.left + btnRect.width - popW;
  let top = btnRect.bottom + INFO_GAP;

  if (left + popW > vw - INFO_MARGIN) left = vw - INFO_MARGIN - popW;
  if (left < INFO_MARGIN) left = INFO_MARGIN;
  if (top + popH > vh - INFO_MARGIN) top = btnRect.top - INFO_GAP - popH;
  if (top < INFO_MARGIN) top = INFO_MARGIN;

  tip.style.setProperty("--info-pop-left", `${Math.round(left)}px`);
  tip.style.setProperty("--info-pop-top", `${Math.round(top)}px`);
}
document.querySelectorAll(".infotip").forEach((tip) => {
  const btn = tip.querySelector(".info-i"), pop = tip.querySelector(".info-pop");
  btn?.setAttribute("aria-expanded", "false");
  btn?.setAttribute("aria-haspopup", "dialog");
  pop?.setAttribute("role", "dialog");
  tip.addEventListener("pointerenter", () => placeInfoTip(tip));
  tip.addEventListener("focusin", () => placeInfoTip(tip));
});
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".info-i");
  if (btn) {
    e.preventDefault(); e.stopPropagation();          // don't toggle a parent <summary>
    const tip = btn.parentElement, isOpen = tip.classList.contains("open");
    closeInfoTips();
    if (!isOpen) {
      placeInfoTip(tip);
      tip.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
    }
  } else if (!e.target.closest(".info-pop")) {
    closeInfoTips();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeInfoTips();
});
function refreshInfoTips() {
  document.querySelectorAll(".infotip.open").forEach((tip) => placeInfoTip(tip));
}
window.addEventListener("resize", refreshInfoTips);
window.addEventListener("scroll", refreshInfoTips, true);

$("generate").addEventListener("click", generate);
$("genLongitudinal").addEventListener("click", genLongitudinal);
$("dlLong").addEventListener("click", () => {
  if (!longCanvas) return;
  const a = document.createElement("a");
  a.download = `${($("condition").value.trim() || "Appendix H").replace(/[^\w]+/g, "_")}_Longitudinal_Profile.png`;
  a.href = longCanvas.toDataURL("image/png"); a.click();
});
$("stationStart").addEventListener("input", () => { if (state.view === "long") drawLongitudinal(); });
$("saveInputs").addEventListener("click", saveInputs);
$("download").addEventListener("click", download);
// cross-section display options redraw the strip; longitudinal options redraw the profile
["optEarth", "optWater", "optThalweg", "optLegend"].forEach((id) => $(id).addEventListener("change", redrawAll));
["loptEarth", "loptWater"].forEach((id) => $(id).addEventListener("change", () => state.longitudinal && drawLongitudinal()));
$("summary").addEventListener("input", updateAutoCount);
$("profile").addEventListener("input", updateAutoCount);
