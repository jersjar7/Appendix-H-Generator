import { parseProfile, parseSummary, formatStation } from "./parse.js";
import { buildSections } from "./model.js";
import { renderChart } from "./chart.js";
import { buildDocx } from "./docx.js";

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

  // order toolbar
  if (state.sections.length > 1) {
    const bar = document.createElement("div");
    bar.className = "order-bar";
    bar.innerHTML = `<span>Ordered by station — <strong>${state.order === "asc" ? "ascending" : "descending"}</strong></span>
      <button id="orderToggle" class="ghost small">Switch to ${state.order === "asc" ? "descending" : "ascending"}</button>`;
    wrap.appendChild(bar);
    bar.querySelector("#orderToggle").addEventListener("click", () => {
      state.order = state.order === "asc" ? "desc" : "asc";
      renderResults(conditionLabel);
    });
  }

  const sel = (v, x) => (String(v) === String(x) ? " selected" : "");
  orderedSections().forEach((sec) => {
    const card = document.createElement("div");
    card.className = "chart-card";
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W; canvas.height = CANVAS_H;
    card.appendChild(canvas);

    const st = sec.structure;
    const tools = document.createElement("div");
    tools.className = "chart-tools";
    tools.innerHTML = `
      <label class="grow">Station label
        <input type="text" class="station" value="${escapeAttr(sec.stationLabel || "")}" />
      </label>
      <label>Y min <input type="number" step="0.5" class="ymin small-input" value="${sec.yOverride ? sec.yOverride.min : ""}" /></label>
      <label>Y max <input type="number" step="0.5" class="ymax small-input" value="${sec.yOverride ? sec.yOverride.max : ""}" /></label>
      <label>Structure
        <select class="stype">
          <option value=""${sel("", st?.type)}>None</option>
          <option value="Culvert"${sel("Culvert", st?.type)}>Culvert (line)</option>
          <option value="Bridge"${sel("Bridge", st?.type)}>Bridge (box)</option>
        </select>
      </label>
      <label>at X <input type="number" step="0.5" class="sx small-input" value="${st ? st.x : ""}" /></label>
      <label>top <input type="number" step="0.5" class="stop small-input" value="${st ? st.top : ""}" /></label>`;
    card.appendChild(tools);

    const cap = document.createElement("div");
    cap.className = "caption-preview";
    card.appendChild(cap);
    wrap.appendChild(card);

    const ctx = canvas.getContext("2d");
    const cond = $("condition").value.trim();
    const draw = () => {
      renderChart(ctx, CANVAS_W, CANVAS_H, sec, chartOptions());
      cap.textContent = `${cond ? cond + ", " : ""}Cross Section at Station ${sec.stationLabel || "?"}`;
    };
    draw();
    state.canvases.push({ canvas, sec, redraw: draw });

    // wiring
    tools.querySelector(".station").addEventListener("input", (e) => { sec.stationLabel = e.target.value; cap.textContent = `${cond ? cond + ", " : ""}Cross Section at Station ${sec.stationLabel || "?"}`; });
    const yminEl = tools.querySelector(".ymin"), ymaxEl = tools.querySelector(".ymax");
    const applyY = () => {
      const a = parseFloat(yminEl.value), b = parseFloat(ymaxEl.value);
      sec.yOverride = !isNaN(a) && !isNaN(b) && b > a ? { min: a, max: b } : null;
      draw();
    };
    yminEl.addEventListener("change", applyY); ymaxEl.addEventListener("change", applyY);

    const stype = tools.querySelector(".stype"), sxEl = tools.querySelector(".sx"), stopEl = tools.querySelector(".stop");
    const applyStruct = () => {
      const t = stype.value;
      if (!t) { sec.structure = null; draw(); return; }
      const x = parseFloat(sxEl.value), top = parseFloat(stopEl.value);
      sec.structure = { type: t, box: t === "Bridge", width: t === "Bridge" ? Math.max(2, (Math.max(...sec.ground.dist) - Math.min(...sec.ground.dist)) * 0.05) : 0,
        x: isNaN(x) ? sec.ground.dist[argmin(sec.ground.val)] : x,
        bottom: sec.groundMin, top: isNaN(top) ? sec.groundMin + 6 : top };
      draw();
    };
    [stype, sxEl, stopEl].forEach((el) => el.addEventListener("change", applyStruct));
  });
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

// ---------- init ----------
renderEventList(PRESETS.existing);
$("addEvent").addEventListener("click", () => renderEventList([...eventRows(), ""]));
document.querySelectorAll("[data-preset]").forEach((b) =>
  b.addEventListener("click", () => {
    renderEventList(PRESETS[b.dataset.preset]);
    $("condition").value = b.dataset.preset === "proposed" ? "Proposed Conditions" : "Existing Conditions";
  })
);
$("generate").addEventListener("click", generate);
$("download").addEventListener("click", download);
["optEarth", "optWater", "optThalweg", "optLegend"].forEach((id) => $(id).addEventListener("change", redrawAll));
$("summary").addEventListener("input", updateAutoCount);
$("profile").addEventListener("input", updateAutoCount);
