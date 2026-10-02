// Parse a kiwi compiled binary schema (evanw/kiwi decodeBinarySchema format).
import { readFileSync } from "node:fs";
export function parseSchema(buf) {
  const b = Buffer.from(buf); let p = 0;
  const u8 = () => b[p++];
  const varuint = () => { let s=0,r=0,c; do{ c=b[p++]; r|=(c&0x7f)<<s; s+=7; }while(c&0x80); return r>>>0; };
  const varint = () => { const u=varuint(); return (u>>>1) ^ -(u&1); };
  const cstr = () => { const st=p; while(b[p]!==0) p++; const s=b.subarray(st,p).toString("utf8"); p++; return s; };
  const defCount = varuint();
  const defs = [];
  for (let i=0;i<defCount;i++){
    const name=cstr(); const kind=u8(); const fc=varuint(); const fields=[];
    for (let j=0;j<fc;j++){ const fn=cstr(); const type=varint(); const isArray=!!u8(); const value=varuint(); fields.push({name:fn,type,isArray,value}); }
    defs.push({name,kind,fields});
  }
  return { defs, bytesRead:p };
}
const KIND=["ENUM","STRUCT","MESSAGE"];
const PRIM={"-1":"bool","-2":"byte","-3":"int","-4":"uint","-5":"float","-6":"string"};
if (import.meta.url===`file://${process.argv[1]}`){
  const {defs,bytesRead}=parseSchema(readFileSync("pixso.binary"));
  console.log("defs:",defs.length,"bytesRead:",bytesRead,"/ 32048");
  const tn=(t)=> t>=0 ? (defs[t]?.name||("#"+t)) : (PRIM[t]||("?"+t));
  for(const want of ["Paint","GUID","Matrix","Vector","Color","NodeChange"]){
    const d=defs.find(x=>x.name===want);
    if(!d){console.log("\n"+want+": NOT FOUND");continue;}
    console.log(`\n${d.name} [${KIND[d.kind]}] ${d.fields.length} fields:`);
    for(const f of d.fields.slice(0,40)) console.log(`  ${f.value}: ${f.name} : ${tn(f.type)}${f.isArray?"[]":""}`);
  }
}
