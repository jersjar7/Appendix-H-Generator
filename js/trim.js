// Detect (but never auto-remove) "weird extra areas": disconnected segments SMS
// sometimes emits in a profile — a cluster of points separated from the main
// cross-section by a gap in distance, with no connecting slope points. They
// don't change the thalweg or the station match, but they distort the chart
// (the ground line jumps off to a stray elevation and blows up the Y-range).
//
// The user decides whether to trim, via a per-chart control. These helpers are
// pure so they're unit-testable and shared by the model (flagging) and the UI.

// A real cross-section's elevation changes gradually point-to-point; SMS "extra
// areas" appear as a cluster sitting at a wildly different elevation, reached by
// an abrupt vertical jump with no connecting slope points. So we split the
// distance-sorted profile at large ELEVATION jumps (not distance gaps — channels
// are sampled densely and banks sparsely, which fools spacing-based detection).
const JUMP_FT = 10; // a >10 ft step between adjacent points is unphysical terrain

// Indices of the "main run" vs disconnected "outlier" points for one series.
export function detectDisconnected(dist, val) {
  const n = dist.length;
  const none = { keep: [...Array(n).keys()], dropped: [] };
  if (n < 8) return none; // too short to judge confidently

  // order points by distance (charts plot XY by distance anyway)
  const order = [...Array(n).keys()].sort((a, b) => dist[a] - dist[b]);
  const v = order.map((i) => val[i]);

  // split into runs wherever the elevation jumps more than JUMP_FT
  const runs = [];
  let cur = [order[0]];
  for (let i = 1; i < n; i++) {
    if (Math.abs(v[i] - v[i - 1]) > JUMP_FT) { runs.push(cur); cur = [order[i]]; }
    else cur.push(order[i]);
  }
  runs.push(cur);
  if (runs.length === 1) return none;

  // main run = the largest by point count
  let main = runs[0];
  for (const r of runs) if (r.length > main.length) main = r;

  const mainVals = main.map((i) => val[i]);
  const mLo = Math.min(...mainVals), mHi = Math.max(...mainVals);
  const dropped = [];
  for (const r of runs) {
    if (r === main) continue;
    // only drop a run that sits clearly outside the main run's elevation band
    const rv = r.map((i) => val[i]);
    const sep = Math.min(...rv) > mHi + JUMP_FT || Math.max(...rv) < mLo - JUMP_FT;
    if (sep && r.length <= 0.5 * main.length) dropped.push(...r);
  }
  if (!dropped.length) return none;

  const drop = new Set(dropped);
  return {
    keep: order.filter((i) => !drop.has(i)).sort((a, b) => a - b),
    dropped: dropped.sort((a, b) => a - b),
  };
}

// Apply detection to one {name,dist,val} series; returns a trimmed copy + count.
export function trimSeries(series) {
  const { keep, dropped } = detectDisconnected(series.dist, series.val);
  if (!dropped.length) return { series, dropped: 0 };
  return {
    series: { ...series, dist: keep.map((i) => series.dist[i]), val: keep.map((i) => series.val[i]) },
    dropped: dropped.length,
  };
}

// How many disconnected points a section carries across all its datasets.
export function sectionOutlierCount(sec) {
  let total = 0;
  total += trimSeries(sec.ground).dropped;
  for (const s of sec.surfaces || []) total += trimSeries(s).dropped;
  return total;
}

// A trimmed copy of a section's datasets (ground + surfaces). Pure — caller
// swaps these in only when the user opts to trim.
export function trimmedDatasets(sec) {
  return {
    ground: trimSeries(sec.ground).series,
    surfaces: (sec.surfaces || []).map((s) => trimSeries(s).series),
  };
}
