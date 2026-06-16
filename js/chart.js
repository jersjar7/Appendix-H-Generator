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
    { name: section.ground.name, dist: section.ground.dist, val: section.ground.val, ground: true },
    ...section.surfaces.map((s, i) => ({
      name: s.name,
      dist: s.dist,
      val: s.val,
      ...surfaceColor(s.name, i, section.surfaces.length),
    })),
  ];

  // data bounds
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const s of series)
    for (let i = 0; i < s.dist.length; i++) {
      xmin = Math.min(xmin, s.dist[i]); xmax = Math.max(xmax, s.dist[i]);
      ymin = Math.min(ymin, s.val[i]); ymax = Math.max(ymax, s.val[i]);
    }
  const st = section.structure;
  if (st) { ymin = Math.min(ymin, st.bottom); ymax = Math.max(ymax, st.top); xmin = Math.min(xmin, st.x); xmax = Math.max(xmax, st.x); }
  if (section.yOverride) { ymin = section.yOverride.min; ymax = section.yOverride.max; }
  else { const pad = (ymax - ymin) * 0.08 + 0.4; ymin -= pad; ymax += pad * 1.3; }

  // plot rect
  const L = 70, R = 18, T = 14, B = 52;
  const pL = L, pT = T, pW = W - L - R, pH = H - T - B;
  const sx = (x) => pL + ((x - xmin) / (xmax - xmin)) * pW;
  const sy = (y) => pT + ((ymax - y) / (ymax - ymin)) * pH;

  // gridlines + ticks
  const fontPx = Math.round(W / 72);
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

  // earth fill
  if (o.showEarthFill) {
    ctx.fillStyle = o.earthColor;
    ctx.beginPath();
    const g = series[0];
    ctx.moveTo(sx(g.dist[0]), sy(g.val[0]));
    for (let i = 1; i < g.dist.length; i++) ctx.lineTo(sx(g.dist[i]), sy(g.val[i]));
    ctx.lineTo(sx(g.dist[g.dist.length - 1]), sy(ymin));
    ctx.lineTo(sx(g.dist[0]), sy(ymin));
    ctx.closePath();
    ctx.fill();
  }

  // inundation between ground and the highest surface
  if (o.showInundation && section.surfaces.length) {
    const top = series[series.length - 1];
    const g = series[0];
    const x0 = Math.max(min(top.dist), min(g.dist));
    const x1 = Math.min(max(top.dist), max(g.dist));
    ctx.fillStyle = o.waterColor;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    let started = false;
    const N = 240;
    const pts = [];
    for (let k = 0; k <= N; k++) {
      const x = x0 + ((x1 - x0) * k) / N;
      const gy = interp(g.dist, g.val, x);
      const ty = interp(top.dist, top.val, x);
      if (ty > gy) pts.push([x, gy, ty]);
    }
    for (const [x, , ty] of pts) { const px = sx(x), py = sy(ty); started ? ctx.lineTo(px, py) : (ctx.moveTo(px, py), (started = true)); }
    for (let i = pts.length - 1; i >= 0; i--) { const [x, gy] = pts[i]; ctx.lineTo(sx(x), sy(gy)); }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // series lines
  for (const s of series) {
    ctx.strokeStyle = s.ground ? o.groundColor : s.color;
    ctx.lineWidth = s.ground ? Math.max(2.2, W / 500) : Math.max(1.4, W / 760);
    ctx.lineJoin = "round";
    ctx.setLineDash(s.dash || []);
    ctx.beginPath();
    for (let i = 0; i < s.dist.length; i++) { const px = sx(s.dist[i]), py = sy(s.val[i]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // structure (culvert/bridge)
  if (st) {
    ctx.strokeStyle = o.structureColor;
    ctx.lineWidth = Math.max(2, W / 600);
    if (st.type === "Bridge" || st.box) {
      // box: two verticals + top
      const w = (st.width || 0);
      const x0 = sx(st.x - w / 2), x1 = sx(st.x + w / 2);
      line(ctx, x0, sy(st.bottom), x0, sy(st.top));
      line(ctx, x1, sy(st.bottom), x1, sy(st.top));
      line(ctx, x0, sy(st.top), x1, sy(st.top));
    } else {
      line(ctx, sx(st.x), sy(st.bottom), sx(st.x), sy(st.top));
    }
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

  // axis frame + tick labels + titles
  ctx.strokeStyle = o.axisColor; ctx.lineWidth = 1;
  line(ctx, pL, pT + pH, pL + pW, pT + pH);
  line(ctx, pL, pT, pL, pT + pH);
  ctx.fillStyle = o.tickColor; ctx.font = `${fontPx}px Arial, sans-serif`;
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (const y of yt) if (y >= ymin && y <= ymax) ctx.fillText(String(trimNum(y)), pL - 6, sy(y));
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (const x of xt) if (x >= xmin && x <= xmax) ctx.fillText(String(trimNum(x)), sx(x), pT + pH + 6);

  ctx.fillStyle = "#333"; ctx.font = `${Math.round(fontPx * 1.05)}px Arial, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText(o.xTitle, pL + pW / 2, H - 6);
  ctx.save();
  ctx.translate(14, pT + pH / 2); ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "top"; ctx.fillText(o.yTitle, 0, 0);
  ctx.restore();

  // note box (bottom-left, inside plot)
  drawNote(ctx, o.note, pL + 8, pT + pH - 8, fontPx);

  // legend (smart inside placement, or fixed top-right)
  drawLegend(ctx, series, o, { pL, pT, pW, pH, sx, sy }, fontPx);

  ctx.restore();
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
  ctx.font = `${Math.round(fontPx * 0.95)}px Arial, sans-serif`;
  const rowH = Math.round(fontPx * 1.5);
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
  let best = candidates[0], bestScore = Infinity;
  if (o.legendInside) {
    for (const [bx, by] of candidates) {
      let score = 0;
      for (const s of series)
        for (let i = 0; i < s.dist.length; i++) {
          const px = sx(s.dist[i]), py = sy(s.val[i]);
          if (px >= bx && px <= bx + boxW && py >= by && py <= by + boxH) score++;
        }
      if (score < bestScore) { bestScore = score; best = [bx, by]; }
    }
  } else best = candidates[0];

  const [bx, by] = best;
  ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.strokeStyle = "#cccccc"; ctx.lineWidth = 1;
  roundRect(ctx, bx, by, boxW, boxH, 5); ctx.fill(); ctx.stroke();
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  series.forEach((s, i) => {
    const cy = by + 6 + rowH * i + rowH / 2;
    ctx.strokeStyle = s.ground ? o.groundColor : s.color;
    ctx.lineWidth = s.ground ? 3 : 2;
    ctx.setLineDash(s.dash || []);
    line(ctx, bx + 10, cy, bx + 10 + swatch, cy);
    ctx.setLineDash([]);
    ctx.fillStyle = "#222";
    ctx.fillText(s.name, bx + 10 + swatch + 8, cy);
  });
}

// helpers
function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
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
function trimNum(n) { return Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100; }
