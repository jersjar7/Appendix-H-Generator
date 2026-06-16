// minimal localStorage shim
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { isAvailable, listRuns, saveRun, deleteRun, clearRuns } = await import("../js/history.js");
let pass=0,fail=0; const ok=(c,m)=>c?(pass++,console.log("  ✓",m)):(fail++,console.error("  ✗",m));
ok(isAvailable(), "localStorage available");
ok(listRuns().length===0, "starts empty");
const id1=saveRun({condition:"Existing Conditions",events:["2-year"],summary:"S1",profile:"P1",count:3});
ok(listRuns().length===1, "saved one run");
saveRun({condition:"Proposed Conditions",events:["2-year","100-year"],summary:"S2",profile:"P2",count:5});
ok(listRuns().length===2, "saved second run");
ok(listRuns()[0].condition==="Proposed Conditions", "newest is first");
// dedup: same condition+summary+profile updates, no new entry
saveRun({condition:"Existing Conditions",events:["2-year"],summary:"S1",profile:"P1",count:3});
ok(listRuns().length===2, "duplicate run de-duped (still 2)");
ok(listRuns()[0].summary==="S1", "de-duped run moved to top");
deleteRun(listRuns()[0].id);
ok(listRuns().length===1, "delete removes one");
clearRuns();
ok(listRuns().length===0, "clear empties history");
// cap at 20
for(let i=0;i<25;i++) saveRun({condition:"C",summary:"s"+i,profile:"p"+i,count:1});
ok(listRuns().length===20, `capped at 20 (got ${listRuns().length})`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
