import { createCanvas } from "canvas";
import { renderChart } from "../js/chart.js";
import { writeFileSync } from "node:fs";
// section with thalweg ~65.25, culvert centered off-thalweg
const sec = {
  ground: { name: "Proposed Ground",
    dist:[0,4,8,12,16,20,24,28,32,36,40],
    val:[75,72,69,66.5,65.6,65.25,65.8,67,70,73,75.5] },
  surfaces:[
    {name:"2-year", dist:[10,14,18,22,26,30], val:[68.0,68.1,68.0,67.9,68.0,68.2]},
    {name:"100-year",dist:[8,12,16,20,24,28,32], val:[70.0,70.1,70.0,69.9,70.0,70.1,70.2]},
    {name:"500-year",dist:[6,12,18,24,30,34], val:[71.2,71.3,71.2,71.1,71.2,71.3]},
  ],
  // box: scour 4, bed 2 -> bottom = 65.25-6 = 59.25; height 15.2 -> top 74.45; width 12; center 26
  structure: { type:"Culvert", scour:4, height:15.2, width:12, bed:2, center:26, x:26, bottom:59.25, top:74.45 },
};
const W=1300,H=772; const cv=createCanvas(W,H);
renderChart(cv.getContext("2d"), W, H, sec, {});
writeFileSync("/tmp/culvert_chart.png", cv.toBuffer("image/png"));
console.log("rendered");
