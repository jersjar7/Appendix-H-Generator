// Per-browser run history using localStorage. No accounts, no server.
// Stores the inputs of previous runs so they can be reloaded later.
// Note: history lives on this device/browser only and is cleared if the
// user clears site data.

const KEY = "appendixH.history.v1";
const MAX = 20;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false; // quota / disabled storage
  }
}

export function isAvailable() {
  try {
    const k = "__ah_test__";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function listRuns() {
  return read();
}

// A run: { condition, events:[], summary, profile, options:{}, count }
// De-dupes against the most recent identical run (same condition + pastes):
// updates its timestamp instead of adding a duplicate.
export function saveRun(run) {
  const list = read();
  const sig = signature(run);
  const existingIdx = list.findIndex((r) => signature(r) === sig);
  const entry = {
    ...run,
    id: existingIdx >= 0 ? list[existingIdx].id : `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    savedAt: Date.now(),
  };
  if (existingIdx >= 0) list.splice(existingIdx, 1);
  list.unshift(entry);
  while (list.length > MAX) list.pop();
  write(list);
  return entry.id;
}

export function deleteRun(id) {
  write(read().filter((r) => r.id !== id));
}

export function clearRuns() {
  write([]);
}

function signature(run) {
  return [run.condition || "", run.summary || "", run.profile || ""].join("");
}
