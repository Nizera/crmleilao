import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(fs.readFileSync("src/lib/dal.ts","utf8"), {
 compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText;
function loadDal(rows, failPage=-1, failTotals=false) {
 const pages=[];
 const db={
  from(table) {
   assert.equal(table,"lots");
   const filters=[],ordering=[];let projection;
   return {
    select(s){projection=s;return this;},
    eq(k,v){filters.push(r=>r[k]===v);return this;},
    is(k,v){filters.push(r=>r[k]===v);return this;},
    or(s){const parts=s.split(",").map(p=>{const[k,op,...v]=p.split(".");assert.equal(op,"eq");return r=>r[k]===v.join(".");});filters.push(r=>parts.some(p=>p(r)));return this;},
    order(k,{ascending}){ordering.push({k,ascending});return this;},
    async range(from,to){
     if(from===failPage)return {data:null,error:{message:"offline"}};
     const selected=rows.filter(r=>filters.every(f=>f(r))).sort((a,b)=>{
      for(const {k,ascending} of ordering)if(a[k]!==b[k])return(a[k]<b[k]?-1:1)*(ascending?1:-1);
      return 0;
     }).slice(from,to+1);
     pages.push({from,to,projection,data:selected});return {data:selected,error:null};
    }
   };
  },
  async rpc(name,args){
   assert.equal(name,"get_customer_home_lot_totals");
   if(failTotals)return {data:null,error:{message:"offline"}};
   const all=rows.filter(r=>r.customer_id===args.p_customer_id&&r.payment_expired_at===null);
   return {data:{total:all.length,paid:all.filter(r=>["paid","shipped","delivered"].includes(r.status)).length,awaiting_shipment:all.filter(r=>r.status==="paid").length},error:null};
  }
 };
 const module={exports:{}};
 const requireMock=n=>n==="react"?{cache:f=>f}:n==="@/lib/supabase/server"?{createClient:async()=>db}:{};
 vm.runInNewContext(compiled,{exports:module.exports,module,require:requireMock,console});
 return {dal:module.exports,pages};
}
const today="2026-11-23";
const make=(id,status,auction_date="2026-11-01",extra={})=>({
 id:String(id).padStart(5,"0"),created_at:String(id).padStart(5,"0"),
 customer_id:"mine",status,auction_date,payment_expired_at:null,
 arremate_value:"60.00",images:["photo.webp"],description:"Detalhes",...extra
});
const fixture=[
 ...Array.from({length:1007},(_,i)=>make(i,["paid","shipped","delivered"][i%3])),
 ...Array.from({length:501},(_,i)=>make(2000+i,"pending_payment")),
 make(4000,"paid",today),make(4001,"cancelled",today),make(4002,"pending_payment",today),
 make(4003,"pending_payment",today,{payment_expired_at:"2026-11-22"}),
 make(4004,"pending_payment",today,{customer_id:"other"})
];
test("Home keeps all actionable lots across pages, excludes other/expired lots and preserves totals and debts",async()=>{
 const {dal,pages}=loadDal(fixture);
 const rows=await dal.listCustomerHomeLots("mine",today);
 const old=fixture.filter(r=>r.customer_id==="mine"&&r.payment_expired_at===null);
 const expected=old.filter(r=>r.auction_date===today||r.status==="pending_payment")
  .sort((a,b)=>b.auction_date.localeCompare(a.auction_date)||b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
 assert.deepEqual(Array.from(rows,r=>r.id),expected.map(r=>r.id));
 assert.equal(rows.length,504);assert.equal(pages.length,2);
 assert.ok(pages.every(p=>p.projection.includes("images")&&p.projection.includes("description")&&!p.projection.includes("items:lot_items")));
 assert.ok(pages.every(p=>p.data.every(r=>r.auction_date===today||r.status==="pending_payment")));
 const debt=rs=>rs.filter(r=>r.status==="pending_payment").reduce((n,r)=>n+Number(r.arremate_value),0);
 assert.equal(debt(rows),debt(old));
 const totals=await dal.getCustomerHomeLotTotals("mine");
 assert.equal(totals.total,old.length);
 assert.equal(totals.paid,old.filter(r=>["paid","shipped","delivered"].includes(r.status)).length);
 assert.equal(totals.awaiting_shipment,old.filter(r=>r.status==="paid").length);
});
test("Empty home works; partial pages and failed totals never silently look complete",async()=>{
 const {dal}=loadDal([]);
 assert.equal((await dal.listCustomerHomeLots("mine",today)).length,0);
 assert.equal((await dal.getCustomerHomeLotTotals("mine")).total,0);
 await assert.rejects(loadDal(fixture,500).dal.listCustomerHomeLots("mine",today),/carregar seus lotes/);
 await assert.rejects(loadDal(fixture,-1,true).dal.getCustomerHomeLotTotals("mine"),/totais/);
});
