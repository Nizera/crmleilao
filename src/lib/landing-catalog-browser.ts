import type {LandingSnapshot} from './landing-live';
let pending:Promise<LandingSnapshot>|null=null;
/** Both landing sections share one bounded request rather than doubling database work. */
export function fetchLandingCatalog():Promise<LandingSnapshot>{
 if(pending)return pending;
 pending=fetch('/api/landing/catalog',{cache:'no-store',signal:AbortSignal.timeout(10000)})
 .then(async response=>{if(!response.ok)throw new Error('catalog unavailable');return await response.json() as LandingSnapshot;})
 .finally(()=>{pending=null;});
 return pending;
}
