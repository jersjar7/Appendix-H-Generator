import { parseProfile, parseSummary, formatStation } from "./parse.js";
import { buildSections } from "./model.js";
import { renderChart } from "./chart.js";
import { buildDocx } from "./docx.js";
import { isAvailable as historyAvailable, listRuns, saveRun, deleteRun, clearRuns } from "./history.js";
import { buildRunReport, reportFilename } from "./report.js";

const $ = (id) => document.getElementById(id);
const CANVAS_W = 1300, CANVAS_H = 772;
const IN_W = 6.5, IN_H = (CANVAS_H / CANVAS_W) * IN_W;

const PRESETS = {
  existing: ["2-year", "100-year", "500-year"],
  proposed: ["2-year", "100-year", "500-year", "2080 100-year"],
};

let state = { sections: [], canvases: [], order: "asc" };

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
  box.innerHTML = "";
  for (const m of items) {
    const d = document.createElement("div");
    d.className = m.type === "error" ? "msg-err" : m.type === "ok" ? "msg-ok" : "msg-warn";
    d.textContent = m.text;
    box.appendChild(d);
  }
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
  renderResults(conditionLabel);
  $("download").disabled = state.sections.length === 0;

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
    options: {
      optEarth: $("optEarth").checked,
      optWater: $("optWater").checked,
      optThalweg: $("optThalweg").checked,
      optLegend: $("optLegend").checked,
    },
  };
}

// explicit "Save inputs" — store the pasted values without generating charts
function saveInputs() {
  if (!$("summary").value.trim() && !$("profile").value.trim()) {
    setMessages([{ type: "warn", text: "Nothing to save yet — paste your Summary Table or profile values first." }]);
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
  };
}

function renderResults(conditionLabel) {
  const wrap = $("results");
  wrap.innerHTML = "";
  state.canvases = [];

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
          <option value=""${sel("", st ? "Culvert" : "")}>None</option>
          <option value="Culvert"${sel("Culvert", st ? "Culvert" : "")}>Add box</option>
        </select>
      </label>
      <span class="culvert-fields"${st ? "" : ' hidden'}>
        <label>Scour (ft) <input type="number" step="0.1" class="cscour small-input" value="${st ? st.scour : ""}" /></label>
        <label>Box height (ft) <input type="number" step="0.1" class="cheight small-input" value="${st ? st.height : ""}" /></label>
        <label>Width (ft) <input type="number" step="0.1" class="cwidth small-input" value="${st ? st.width : ""}" /></label>
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
    const scourEl = tools.querySelector(".cscour"), heightEl = tools.querySelector(".cheight");
    const widthEl = tools.querySelector(".cwidth"), centerEl = tools.querySelector(".ccenter"), bedEl = tools.querySelector(".cbed");
    const thalwegX = sec.ground.dist[argmin(sec.ground.val)];
    const applyStruct = () => {
      fields.hidden = stype.value !== "Culvert";
      if (stype.value !== "Culvert") { sec.structure = null; draw(); return; }
      const scour = parseFloat(scourEl.value), height = parseFloat(heightEl.value), width = parseFloat(widthEl.value);
      let bed = parseFloat(bedEl.value); if (isNaN(bed)) bed = 2;
      const centerRaw = parseFloat(centerEl.value);
      const center = isNaN(centerRaw) ? null : centerRaw;
      // Need scour + height + width to draw the box; otherwise wait for input.
      if (isNaN(scour) || isNaN(height) || isNaN(width)) { sec.structure = null; draw(); return; }
      const bottom = sec.groundMin - scour - bed;
      sec.structure = {
        type: "Culvert", scour, height, width, bed, center,
        x: center == null ? thalwegX : center,
        bottom, top: bottom + height,
      };
      draw();
    };
    [stype, scourEl, heightEl, widthEl, centerEl, bedEl].forEach((el) => el.addEventListener("input", applyStruct));
  });

  const firstChip = chips.querySelector(".chip");
  if (firstChip) firstChip.classList.add("active");
}

// redraw all when global options change
function redrawAll() { state.canvases.forEach((c) => c.redraw()); }

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
  ["optEarth", "optWater", "optThalweg", "optLegend"].forEach((id) => ($(id).checked = true));
  state = { sections: [], canvases: [], order: "asc" };
  $("results").innerHTML = "";
  $("messages").innerHTML = "";
  $("autoCount").textContent = "";
  $("download").disabled = true;
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
      <button class="mini report" title="Download a .txt diagnostic (inputs + station matching + warnings)">Report</button>
      <button class="mini load">Load</button>
      <button class="mini del">Delete</button>`;
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
  const o = run.options || {};
  $("optEarth").checked = o.optEarth !== false;
  $("optWater").checked = o.optWater !== false;
  $("optThalweg").checked = o.optThalweg !== false;
  $("optLegend").checked = o.optLegend !== false;
  updateAutoCount();
  // refill the inputs only — let the user review, then click Generate.
  $("historyPanel").open = false;
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
$("generate").addEventListener("click", generate);
$("saveInputs").addEventListener("click", saveInputs);
$("download").addEventListener("click", download);
["optEarth", "optWater", "optThalweg", "optLegend"].forEach((id) => $(id).addEventListener("change", redrawAll));
$("summary").addEventListener("input", updateAutoCount);
$("profile").addEventListener("input", updateAutoCount);
