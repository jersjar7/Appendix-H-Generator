import { createCanvas } from "canvas";
import { renderChart } from "../js/chart.js";
import { writeFileSync } from "node:fs";

// existing w/ culvert (4 series)
const secA = {
  ground: { name: "Existing Ground",
    dist:[0,2,4,6,8,10,11.5,12,13,14,15,16,18,20,22,24],
    val:[61.2,59,57.2,55.8,55.2,54.9,54.78,54.8,55.4,56.6,56.9,57,57,57.6,58.5,59.4] },
  surfaces:[
    {name:"2-year", dist:[4.5,6,8,10,12,14,15], val:[56.40,56.42,56.40,56.35,56.30,56.25,56.30]},
    {name:"100-year",dist:[4.5,6,8,10,12,14,15], val:[56.55,56.58,56.55,56.50,56.45,56.40,56.45]},
    {name:"500-year",dist:[4.5,6,8,10,12,14,15], val:[56.72,56.74,56.72,56.68,56.62,56.55,56.40]},
  ],
  structure:{ type:"Culvert", x:24, bottom:54.78, top:60.2 },
};
// proposed 5 series no culvert
const secB = {
  ground:{ name:"Proposed Ground",
    dist:[0,2,5,7,8,9,11,13,15,17,19,21,23,26,29],
    val:[71.9,71.7,70.5,68.0,67.6,67.5,66.0,65.3,65.6,66.2,67.1,67.2,70.0,69.0,70.5] },
  surfaces:[
    {name:"2-year", dist:[8,10,12,14,16,18,20,22], val:[65.95,65.95,65.9,65.85,65.9,66.35,66.95,67.05]},
    {name:"100-year",dist:[8,10,12,14,16,18,20,22], val:[66.8,66.8,66.75,66.7,66.75,66.9,67.0,67.1]},
    {name:"500-year",dist:[8,10,12,14,16,18,20,22], val:[67.1,67.15,67.1,67.05,67.1,67.2,67.25,67.2]},
    {name:"2080 100-year",dist:[8,10,12,14,16,18,20,22], val:[67.35,67.2,67.1,67.05,67.1,67.2,67.28,67.25]},
  ],
  structure:null,
};
for (const [name, sec] of [["A",secA],["B",secB]]) {
  const W=1300,H=772;
  const cv=createCanvas(W,H); const ctx=cv.getContext("2d");
  renderChart(ctx,W,H,sec,{});
  writeFileSync(`/tmp/chart_${name}.png`, cv.toBuffer("image/png"));
}
console.log("rendered");
