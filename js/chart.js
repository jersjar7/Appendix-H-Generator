// Canvas renderer for a single cross-section chart.
// Pure Canvas2D so it runs in the browser and headless (node-canvas) for tests.

export const DEFAULTS = {
  groundColor: "#7a5c3e",
  earthColor: "#ece0cf",
  waterColor: "#bcd6ef",
  structureColor: "#000000",
  gridColor: "#dcdcdc",
  minorGridColor: "#efefef",
  minorDivisions: 5,
  axisColor: "#bdbdbd",
  tickColor: "#666666",
  showEarthFill: true,
  showInundation: true,
  showThalweg: true,
  legendInside: true,
  xTitle: "Distance (feet)",
  yTitle: "Elevation (feet, NAVD88)",
  note: "Cross Section is looking downstream",
};

// Blue -> green ramp for N water surfaces.
const RAMP = [
  [31, 111, 180], // #1f6fb4
  [86, 160, 211], // #56a0d3
  [58, 157, 74], // #3a9d4a
];
function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}
function rampColor(i, n) {
  if (n <= 1) return `rgb(${RAMP[0].join(",")})`;
  const t = i / (n - 1);
  const seg = t * (RAMP.length - 1);
  const k = Math.min(RAMP.length - 2, Math.floor(seg));
  const f = seg - k;
  const c = [0, 1, 2].map((j) => lerp(RAMP[k][j], RAMP[k + 1][j], f));
  return `rgb(${c.join(",")})`;
}
export function surfaceColor(name, i, n) {
  if (/2080/.test(name)) return { color: "#e8a93b", dash: [10, 5] };
  return { color: rampColor(i, n), dash: null };
}

// Named line styles → dash patterns (px on/off). Solid = no dash. Used by the
// per-line style picker so close flows can be told apart by line type.
export const LINE_STYLES = {
  solid: [], dashed: [10, 6], longDash: [20, 9], dashDot: [13, 6, 3, 6], dotted: [2, 6],
};
// Default line weight (px at the reference render width) per line role.
export const DEFAULT_WIDTHS = { ground: 2.6, surface: 1.7, culvert: 2.2 };
const REF_W = 1300;
// A weight is resolution-independent: it equals px at REF_W and scales with W.
export const lineWidthPx = (W, weight) => Math.max(0.4, (weight * W) / REF_W);
// Apply a user override { color?, style?, width? } on top of a line's defaults.
function applyStyle(base, ov) {
  return {
    color: (ov && ov.color) || base.color,
    dash: ov && ov.style ? (LINE_STYLES[ov.style] || base.dash) : base.dash,
    width: ov && ov.width != null ? ov.width : base.width,
  };
}

function niceNum(range, round) {
  const exp = Math.floor(Math.log10(range));
  const frac = range / Math.pow(10, exp);
  let nice;
  if (round) nice = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
  else nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * Math.pow(10, exp);
}
function ticks(lo, hi, max = 7) {
  const range = niceNum(hi - lo, false);
  const step = niceNum(range / (max - 1), true);
  const start = Math.ceil(lo / step) * step;
  const out = [];
  for (let v = start; v <= hi + step * 0.5; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

// Positions between major ticks, used for faint minor gridlines.
function minorPositions(major, lo, hi, div) {
  if (!major || major.length < 2 || div < 2) return [];
  const step = (major[1] - major[0]) / div;
  if (!(step > 0)) return [];
  const out = [];
  const start = Math.floor(lo / step) * step;
  for (let v = start; v <= hi + step * 0.5; v += step) {
    if (v < lo || v > hi) continue;
    if (major.some((m) => Math.abs(m - v) < step * 0.25)) continue; // skip majors
    out.push(v);
  }
  return out;
}

export function renderChart(ctx, W, H, section, optsIn = {}) {
  const o = { ...DEFAULTS, ...optsIn };
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  const series = [
    {
      name: section.ground.name, dist: section.ground.dist, val: section.ground.val, ground: true,
      ...applyStyle({ color: o.groundColor, dash: null, width: DEFAULT_WIDTHS.ground }, o.styles && o.styles.__ground__),
    },
    ...section.surfaces.map((s, i) => ({
      name: s.name,
      dist: s.dist,
      val: s.val,
      ...applyStyle({ ...surfaceColor(s.name, i, section.surfaces.length), width: DEFAULT_WIDTHS.surface }, o.styles && o.styles[s.name]),
    })),
  ];

  // data bounds (null vals = gaps, e.g. a dry reach under a culvert — skip them)
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const s of series)
    for (let i = 0; i < s.dist.length; i++) {
      const x = s.dist[i], v = s.val[i];
      if (Number.isFinite(x)) { xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); }
      if (v != null && Number.isFinite(v)) { ymin = Math.min(ymin, v); ymax = Math.max(ymax, v); }
    }
  const st = section.structure;
  if (st) {
    const halfW = culvertHalfWidth(st);
    ymin = Math.min(ymin, st.bottom); ymax = Math.max(ymax, st.top);
    xmin = Math.min(xmin, st.x - halfW); xmax = Math.max(xmax, st.x + halfW);
  }
  if (section.yOverride) { ymin = section.yOverride.min; ymax = section.yOverride.max; }
  else { const pad = (ymax - ymin) * 0.08 + 0.4; ymin -= pad; ymax += pad * 1.3; }

  // plot rect (B/L leave room so axis titles clear the tick values)
  const L = 96, R = 20, T = 16, B = 80;
  const pL = L, pT = T, pW = W - L - R, pH = H - T - B;
  const sx = (x) => {
    const f = o.reverseX ? (xmax - x) / (xmax - xmin) : (x - xmin) / (xmax - xmin);
    return pL + f * pW;
  };
  const sy = (y) => pT + ((ymax - y) / (ymax - ymin)) * pH;

  // gridlines + ticks
  const fontPx = Math.round(W / 60);
  ctx.lineWidth = 1;
  ctx.font = `${fontPx}px Arial, sans-serif`;
  ctx.textBaseline = "middle";
  const yt = ticks(ymin, ymax), xt = ticks(xmin, xmax);
  // minor gridlines first (lighter), then major over them — finer to read off,
  // without adding more axis numbers.
  ctx.strokeStyle = o.minorGridColor;
  for (const y of minorPositions(yt, ymin, ymax, o.minorDivisions)) { const py = sy(y); line(ctx, pL, py, pL + pW, py); }
  for (const x of minorPositions(xt, xmin, xmax, o.minorDivisions)) { const px = sx(x); line(ctx, px, pT, px, pT + pH); }
  ctx.strokeStyle = o.gridColor;
  for (const y of yt) { const py = sy(y); line(ctx, pL, py, pL + pW, py); }
  for (const x of xt) { const px = sx(x); line(ctx, px, pT, px, pT + pH); }

  // earth fill (semi-transparent so the gridlines read through it)
  if (o.showEarthFill) {
    ctx.fillStyle = o.earthColor;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    const g = series[0];
    ctx.moveTo(sx(g.dist[0]), sy(g.val[0]));
    for (let i = 1; i < g.dist.length; i++) ctx.lineTo(sx(g.dist[i]), sy(g.val[i]));
    ctx.lineTo(sx(g.dist[g.dist.length - 1]), sy(ymin));
    ctx.lineTo(sx(g.dist[0]), sy(ymin));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // inundation between ground and the highest surface (filled in segments so it
  // breaks across null gaps where a water surface goes dry, e.g. under a culvert)
  if (o.showInundation && section.surfaces.length) {
    const top = series[series.length - 1];
    const g = series[0];
    const x0 = Math.max(min(top.dist), min(g.dist));
    const x1 = Math.min(max(top.dist), max(g.dist));
    ctx.fillStyle = o.waterColor;
    ctx.globalAlpha = 0.6;
    const N = 240, pts = [];
    for (let k = 0; k <= N; k++) {
      const x = x0 + ((x1 - x0) * k) / N;
      const gy = interpSafe(g.dist, g.val, x), ty = interpSafe(top.dist, top.val, x);
      pts.push({ x, gy, ty, ok: Number.isFinite(gy) && Number.isFinite(ty) && ty > gy });
    }
    for (let i = 0; i <= N; i++) {
      if (!pts[i].ok) continue;
      let j = i; while (j + 1 <= N && pts[j + 1].ok) j++;          // contiguous wet run i..j
      ctx.beginPath();
      for (let k = i; k <= j; k++) { const p = pts[k]; k === i ? ctx.moveTo(sx(p.x), sy(p.ty)) : ctx.lineTo(sx(p.x), sy(p.ty)); }
      for (let k = j; k >= i; k--) { const p = pts[k]; ctx.lineTo(sx(p.x), sy(p.gy)); }
      ctx.closePath(); ctx.fill();
      i = j;
    }
    ctx.globalAlpha = 1;
  }

  // series lines
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = lineWidthPx(W, s.width);
    ctx.lineJoin = "round";
    ctx.setLineDash(s.dash || []);
    ctx.beginPath();
    let pen = false;                                   // break the line across null gaps
    for (let i = 0; i < s.dist.length; i++) {
      const v = s.val[i];
      if (v == null || !Number.isFinite(v)) { pen = false; continue; }
      const px = sx(s.dist[i]), py = sy(v);
      pen ? ctx.lineTo(px, py) : (ctx.moveTo(px, py), (pen = true));
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // culvert outline — box, arch (legs + curved crown), circle, or ellipse
  const culvertStyle = applyStyle({ color: o.structureColor, dash: null, width: DEFAULT_WIDTHS.culvert }, o.styles && o.styles.__culvert__);
  if (st) {
    const k = st.kind || "box";
    ctx.strokeStyle = culvertStyle.color;
    ctx.lineWidth = lineWidthPx(W, culvertStyle.width);
    ctx.lineJoin = k === "box" ? "miter" : "round";
    ctx.setLineDash(culvertStyle.dash || []);
    if (k === "box" && (st.width || 0) <= 0) {
      line(ctx, sx(st.x), sy(st.bottom), sx(st.x), sy(st.top));   // zero-width → centerline
    } else {
      const pts = culvertPoints(st);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1]))));
      ctx.closePath();
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // thalweg marker
  if (o.showThalweg) {
    const g = series[0];
    let ti = 0;
    for (let i = 1; i < g.val.length; i++) if (g.val[i] < g.val[ti]) ti = i;
    const px = sx(g.dist[ti]), py = sy(g.val[ti]);
    ctx.fillStyle = "#ffffff"; ctx.strokeStyle = o.groundColor; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(px, py, Math.max(3, W / 300), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#555"; ctx.font = `${Math.round(fontPx * 0.82)}px Arial, sans-serif`;
    ctx.textBaseline = "top"; ctx.textAlign = "left";
    ctx.fillText(`Thalweg ${g.val[ti].toFixed(2)}`, px + 6, py + 4);
  }

  // cross-section location markers (longitudinal): vertical dash-dot lines with
  // boxed labels. Side per marker: per-marker override > global mode > alternate.
  const markerBoxes = [];
  if (o.markers && o.markers.length) {
    ctx.font = `${Math.round(fontPx * 0.82)}px Arial, sans-serif`;
    o.markers.forEach((m, i) => {
      const px = sx(m.dist);
      if (px < pL - 0.5 || px > pL + pW + 0.5) return;          // outside the plot
      ctx.strokeStyle = "#7a7a7a"; ctx.lineWidth = 1; ctx.setLineDash([7, 3, 2, 3]);
      line(ctx, px, pT, px, pT + pH); ctx.setLineDash([]);
      const label = m.label, tw = ctx.measureText(label).width, bw = tw + 10, bh = Math.round(fontPx * 1.25);
      let bx = px - bw / 2; bx = Math.max(pL + 1, Math.min(bx, pL + pW - bw - 1));
      const top = pT + 3, bottom = pT + pH - bh - 3;
      const override = o.markerOverrides && o.markerOverrides[label];
      const side = override || (o.markerLabels === "top" ? "top" : o.markerLabels === "bottom" ? "bottom" : (i % 2 === 0 ? "top" : "bottom"));
      const by = side === "top" ? top : bottom;
      ctx.fillStyle = "rgba(255,255,255,0.95)"; ctx.strokeStyle = "#9a9a9a"; ctx.lineWidth = 1;
      roundRect(ctx, bx, by, bw, bh, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#333"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(label, bx + bw / 2, by + bh / 2);
      markerBoxes.push({ label, side, x: bx, y: by, w: bw, h: bh });
    });
  }

  // axis frame + tick labels + titles
  ctx.strokeStyle = o.axisColor; ctx.lineWidth = 1;
  line(ctx, pL, pT + pH, pL + pW, pT + pH);
  line(ctx, pL, pT, pL, pT + pH);
  ctx.fillStyle = o.tickColor; ctx.font = `${fontPx}px Arial, sans-serif`;
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (const y of yt) if (y >= ymin && y <= ymax) ctx.fillText(String(trimNum(y)), pL - 6, sy(y));
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  // longitudinal profiles label X as stationing (SS+FF) offset by stationStart
  const fmtX = (x) => (o.stationStart != null ? fmtStation(o.stationStart + x) : String(trimNum(x)));
  for (const x of xt) if (x >= xmin && x <= xmax) ctx.fillText(fmtX(x), sx(x), pT + pH + 6);

  ctx.fillStyle = "#333"; ctx.font = `${Math.round(fontPx * 1.05)}px Arial, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText(o.xTitle, pL + pW / 2, H - 6);
  ctx.save();
  ctx.translate(18, pT + pH / 2); ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "top"; ctx.fillText(o.yTitle, 0, 0);
  ctx.restore();

  // note box (bottom-left, inside plot) — skip when empty (e.g. longitudinal)
  if (o.note) drawNote(ctx, o.note, pL + 8, pT + pH - 8, fontPx);

  // legend (smart inside placement, or fixed top-right)
  const legendItems = st ? series.concat([{ name: "Culvert", ...culvertStyle }]) : series;
  drawLegend(ctx, legendItems, o, { pL, pT, pW, pH, sx, sy }, fontPx);

  ctx.restore();
  return { markerBoxes };   // label hit-boxes (canvas px) for click-to-flip
}

function drawNote(ctx, text, x, yBottom, fontPx) {
  ctx.font = `${Math.round(fontPx * 0.92)}px Arial, sans-serif`;
  ctx.textAlign = "left"; ctx.textBaseline = "bottom";
  const padX = 8, padY = 6, tw = ctx.measureText(text).width, th = fontPx;
  ctx.fillStyle = "rgba(255,255,255,0.95)"; ctx.strokeStyle = "#cccccc"; ctx.lineWidth = 1;
  roundRect(ctx, x, yBottom - th - padY * 2, tw + padX * 2, th + padY * 2, 5);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#333"; ctx.fillText(text, x + padX, yBottom - padY + 1);
}

function drawLegend(ctx, series, o, geo, fontPx) {
  ctx.font = `${Math.round(fontPx * 1.05)}px Arial, sans-serif`;
  const rowH = Math.round(fontPx * 1.6);
  const swatch = Math.round(fontPx * 1.4);
  let textW = 0;
  for (const s of series) textW = Math.max(textW, ctx.measureText(s.name).width);
  const boxW = swatch + 12 + textW + 20;
  const boxH = rowH * series.length + 12;

  const { pL, pT, pW, pH, sx, sy } = geo;
  const candidates = [
    [pL + pW - boxW - 10, pT + 10], // top-right
    [pL + 10, pT + 10], // top-left
    [pL + pW - boxW - 10, pT + pH - boxH - 10], // bottom-right
    [pL + 10, pT + pH - boxH - 10], // bottom-left
    [pL + (pW - boxW) / 2, pT + 8], // top-center
  ];
  // explicit anchor positions (user-chosen); "auto" falls back to smart placement
  const m = 10;
  const anchorPos = {
    "top-left": [pL + m, pT + m],
    "top-center": [pL + (pW - boxW) / 2, pT + m],
    "top-right": [pL + pW - boxW - m, pT + m],
    "left-middle": [pL + m, pT + (pH - boxH) / 2],
    "right-middle": [pL + pW - boxW - m, pT + (pH - boxH) / 2],
    "bottom-left": [pL + m, pT + pH - boxH - m],
    "bottom-center": [pL + (pW - boxW) / 2, pT + pH - boxH - m],
    "bottom-right": [pL + pW - boxW - m, pT + pH - boxH - m],
  };
  let best = candidates[0], bestScore = Infinity;
  if (o.legendAnchor && anchorPos[o.legendAnchor]) {
    best = anchorPos[o.legendAnchor];
  } else if (o.legendInside) {
    for (const [bx, by] of candidates) {
      let score = 0;
      for (const s of series) {
        if (!s.dist) continue;
        for (let i = 0; i < s.dist.length; i++) {
          const px = sx(s.dist[i]), py = sy(s.val[i]);
          if (px >= bx && px <= bx + boxW && py >= by && py <= by + boxH) score++;
        }
      }
      if (score < bestScore) { bestScore = score; best = [bx, by]; }
    }
  } else best = candidates[0];
  // user nudge, clamped so the box stays within the plot
  const bx = Math.max(pL, Math.min(pL + pW - boxW, best[0] + (o.legendOffX || 0)));
  const by = Math.max(pT, Math.min(pT + pH - boxH, best[1] + (o.legendOffY || 0)));
  ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.strokeStyle = "#cccccc"; ctx.lineWidth = 1;
  roundRect(ctx, bx, by, boxW, boxH, 5); ctx.fill(); ctx.stroke();
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  series.forEach((s, i) => {
    const cy = by + 6 + rowH * i + rowH / 2;
    ctx.strokeStyle = s.color || o.groundColor;
    ctx.lineWidth = Math.max(1.2, Math.min(5, s.width || 2));   // legend reflects relative thickness
    ctx.setLineDash(s.dash || []);
    line(ctx, bx + 10, cy, bx + 10 + swatch, cy);
    ctx.setLineDash([]);
    ctx.fillStyle = "#222";
    ctx.fillText(s.name, bx + 10 + swatch + 8, cy);
  });
}

// helpers
function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

// Half horizontal extent of a culvert, by shape kind (for x-bounds).
export function culvertHalfWidth(st) {
  const k = st.kind || "box";
  if (k === "arch") return (st.span || 0) / 2;
  if (k === "circle") return (st.diameter || 0) / 2;
  return (st.width || 0) / 2;                       // box, ellipse
}
// Closed culvert outline in MODEL coords (ft), anchored at center-x st.x and
// invert st.bottom. Parametric shapes are sampled finely so curves stay smooth.
// box/(unknown) → rectangle; arch → straight legs + elliptical crown;
// circle/ellipse → full sampled ellipse.
export function culvertPoints(st) {
  const x = st.x, b = st.bottom, k = st.kind || "box";
  if (k === "arch") {
    const rx = (st.span || 0) / 2, leg = st.legHeight || 0, rise = st.rise || 0, springY = b + leg, pts = [[x - rx, b], [x - rx, springY]];
    for (let i = 0; i <= 96; i++) { const t = Math.PI * (1 - i / 96); pts.push([x + rx * Math.cos(t), springY + rise * Math.sin(t)]); }
    pts.push([x + rx, b]);
    return pts;
  }
  if (k === "circle" || k === "ellipse") {
    const rx = (k === "circle" ? st.diameter : st.width) / 2, ry = (k === "circle" ? st.diameter : st.height) / 2, cy = b + ry, pts = [];
    for (let i = 0; i < 128; i++) { const t = (Math.PI * 2 * i) / 128; pts.push([x + rx * Math.cos(t), cy + ry * Math.sin(t)]); }
    return pts;
  }
  const w = st.width || 0;                          // box
  return [[x - w / 2, b], [x - w / 2, st.top], [x + w / 2, st.top], [x + w / 2, b]];
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
const min = (a) => Math.min(...a);
const max = (a) => Math.max(...a);
function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) {
    const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
    return ys[i - 1] + t * (ys[i] - ys[i - 1]);
  }
  return ys[ys.length - 1];
}
// like interp but returns NaN across null gaps (so fills break instead of dropping to 0)
function interpSafe(xs, ys, x) {
  if (x <= xs[0]) return ys[0] == null ? NaN : ys[0];
  if (x >= xs[xs.length - 1]) { const v = ys[ys.length - 1]; return v == null ? NaN : v; }
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) {
    const a = ys[i - 1], b = ys[i];
    if (a == null || b == null) return NaN;
    return a + ((x - xs[i - 1]) / (xs[i] - xs[i - 1])) * (b - a);
  }
  return NaN;
}
function trimNum(n) { return Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100; }
// Engineering stationing: feet → "SS+FF" (e.g. 1047 → "10+47").
function fmtStation(ft) {
  const r = Math.round(ft), whole = Math.floor(r / 100), rem = r - whole * 100;
  return `${whole}+${String(rem).padStart(2, "0")}`;
}
