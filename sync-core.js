// Shared, pure validation and conflict checks. No credentials or record data in source.
export function validDate(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)||s<'1900-01-01'||s>'2199-12-31')return false;const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s}
export function validRecords(records){
 if(!Array.isArray(records)||records.length>100000)return false;
 const ids=new Set(),batches=new Map();
 const text=(v,max,required=false)=>typeof v==='string'&&v.length<=max&&(!required||v.trim().length>0);
 const int=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
 for(const r of records){
  if(!r||!text(r.id,100,true)||ids.has(r.id)||!validDate(r.date)||(r.harvest&&!validDate(r.harvest))||!text(r.crop,80,true)||!text(r.destination,100)||!int(r.boxes,1,1e6)||(r.price!==null&&!int(r.price,0,1e8))||!int(r.deductions,0,1e9)||!text(r.slip,100)||!text(r.memo,2000)||(r.batchId!==undefined&&!text(r.batchId,100,true)))return false;
  ids.add(r.id);const key=r.batchId||r.id,b=batches.get(key)||{date:r.date,destinations:new Set()};if(b.date!==r.date||b.destinations.has(r.destination))return false;b.destinations.add(r.destination);batches.set(key,b);
 }
 return true;
}
export function readState(doc,account){
 if(!doc)return {revision:0,records:[],account,updatedAt:null};
 if(doc.schemaVersion!==1||!Number.isSafeInteger(doc.revision)||doc.revision<1||typeof doc.recordsJson!=='string')throw new Error('共有記録の形式が違います。上書きせず、管理者に確認してください。');
 let records;try{records=JSON.parse(doc.recordsJson)}catch{throw new Error('共有記録を読み取れません。')}
 if(!validRecords(records))throw new Error('共有記録の形式を確認してください。');
 return {revision:doc.revision,records,account,updatedAt:doc.updatedAt?.toDate?.().toISOString()||null};
}
export function applyWrite(current,payload,account){
 if(!payload||!Number.isSafeInteger(payload.revision)||payload.revision<0||!validRecords(payload.records))throw new Error('保存する記録の形式を確認してください。');
 const prior=readState(current,account);
 if(prior.revision!==payload.revision)throw Object.assign(new Error('別の端末で変更されました'),{status:409});
 const records=payload.records.map(r=>({id:r.id,...(r.batchId?{batchId:r.batchId}:{}),date:r.date,harvest:r.harvest||'',crop:r.crop,destination:r.destination,boxes:r.boxes,price:r.price,deductions:r.deductions,slip:r.slip,memo:r.memo}));
 if(new TextEncoder().encode(JSON.stringify(records)).length>850000)throw new Error('共有保存の容量に近づきました。バックアップを保存して管理者にご相談ください。');
 return {revision:prior.revision+1,records,account,updatedAt:new Date().toISOString()};
}
