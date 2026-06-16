import { createCanvas } from "canvas";
import { parseProfile, parseSummary } from "../js/parse.js";
import { buildSections } from "../js/model.js";
import { renderChart } from "../js/chart.js";
import { buildDocx } from "../js/docx.js";
import { writeFileSync } from "node:fs";

// Synthetic but realistic: 3 sections, ground + 3 surfaces, scrambled dataset order.
function ground(base){return [0,2,4,6,8,10,12,14,16,18].map((d,i)=>[d, base+[7,5,3,1.5,0.4,0,0.5,2,4,6][i]]);}
function surf(lvl,x0,x1){const out=[];for(let d=x0;d<=x1;d+=1.5)out.push([d,lvl+(Math.random()-0.5)*0.05]);return out;}
function buildProfileTSV(secs){
  const cols=[];
  for(const s of secs){const[a,b,c]=s.surf;[c,s.g,a,b].forEach(series=>{cols.push(series.map(p=>p[0]));cols.push(series.map(p=>p[1]));});}
  const n=Math.max(...cols.map(c=>c.length));
  const head=[];for(let i=0;i<cols.length/2;i++)head.push("Distance","Value");
  const lines=[head.join("\t")];
  for(let r=0;r<n;r++){const cells=[String(r+1)];for(const col of cols)cells.push(col[r]!==undefined?col[r].toFixed(4):"");lines.push(cells.join("\t"));}
  return lines.join("\n");
}
const secs=[
  {g:ground(54.78),surf:[surf(56.4,4,14),surf(56.55,4,14),surf(56.72,4,14)]},
  {g:ground(65.25),surf:[surf(80.8,3,16),surf(83.2,3,16),surf(86.1,3,16)]},
  {g:ground(75.42),surf:[surf(78.0,5,15),surf(79.5,5,15),surf(81.0,5,15)]},
];
const profileText=buildProfileTSV(secs);
const summaryText=["Reach\tStation\tMin","Hood Canal\t1047.09\t54.78","Hood Canal\t1272.11\t65.25","Hood Canal\t1475.34\t75.42"].join("\n");

const {pairs}=parseProfile(profileText);
const {rows}=parseSummary(summaryText);
const {sections,warnings,datasetsPerSection}=buildSections(pairs,rows,{events:["2-year","100-year","500-year"],conditionLabel:"Existing Conditions",roundingMode:"nearest"});

console.log("sections:",sections.length,"dps:",datasetsPerSection,"warnings:",warnings);
console.log("stations:",sections.map(s=>s.stationLabel).join(", "));

// give the middle one a culvert
sections[0].structure={type:"Culvert",x:16,bottom:54.78,top:60.5};

const charts=sections.map((sec,i)=>{
  const W=1300,H=772;const cv=createCanvas(W,H);renderChart(cv.getContext("2d"),W,H,sec,{});
  if(i===0)writeFileSync("/tmp/e2e_chart0.png",cv.toBuffer("image/png"));
  const png=cv.toBuffer("image/png");
  return {png:new Uint8Array(png),caption:`Existing Conditions, Cross Section at Station ${sec.stationLabel}`,widthIn:6.5,heightIn:6.5*H/W};
});
const docx=buildDocx(charts);
writeFileSync("/tmp/e2e_out.docx",docx);
console.log("docx bytes:",docx.length);

// assertions
const okStations=sections.map(s=>s.stationLabel).join(",")==="10+47,12+72,14+75";
console.log(okStations?"PASS station matching":"FAIL station matching");
process.exit(okStations?0:1);
