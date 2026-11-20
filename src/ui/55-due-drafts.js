function paymentBlocked(r){return !!(r.planNeedsReview||r.unmatchedCents>0||r.unallocatedCents!==0||r.futureDatedCount>0);}
function paymentSelection(model){const eligible=[],blocked=[];let cents=0;
 for(const r of model.active){if(r.plan.status==='paid'&&!r.planNeedsReview)continue;const items=r.plan.items||{};if(!Object.keys(items).length)continue;
 try{if(paymentBlocked(r))throw Error('Требуется сверка');const sum=checkTotal(r,items);if(sum>0){eligible.push(r);cents+=sum;}}catch(e){blocked.push(r);}}
 return {eligible,blocked,cents};}

// Preselect due invoices once per supplier, reporting date and 1C snapshot.
// This prepares a DRAFT only. It never approves a payment or marks it as paid.
// An existing plan (including an empty draft after manual removal) always wins.
function prepareDueDrafts(model){
 if(!model?.active || !state.snapshot || !state.date)return false;
 let changed=false;
 for(const r of model.active){
  if(!r.tracked || paymentBlocked(r) || !Number.isSafeInteger(r.debtCents) || r.debtCents<=0)continue;
  const id=planId(r.key);
  if(Object.hasOwn(state.plans,id))continue;
  if(typeof budgetStore==='function'&&Object.hasOwn(budgetStore(),orgBudgetKey(r.org)))continue;
  let available=r.debtCents;
  const items={};
  for(const d of r.allocatedDocuments||[]){
   if(!available)break;
   if(!d.dueNow || !Number.isSafeInteger(d.remainingCents) || d.remainingCents<=0)continue;
   const value=Math.min(available,d.remainingCents);
   if(value>0){items[d.id]=value;available-=value;}
  }
  if(!Object.keys(items).length)continue;
  state.plans[id]={
   status:'draft',items,sourceFingerprint:state.snapshot.fingerprint,
   delayDays:r.delay,suggestedBy:'due-date'
  };
  changed=true;
 }
 if(changed)saveLocal('plans',state.plans);
 return changed;
}
