export const LANDING_LIVE_CHANNEL='public-landing-catalog-v1';
export type LandingLot={id:string;title:string;image:string|null;created_at:string};
export type LandingProduct={id:string;name:string;image:string|null;category:string;price:string};
export type LandingSnapshot={lots:LandingLot[];products:LandingProduct[];lotsAvailable:boolean;storeAvailable:boolean};
/** Only announce IDs not seen before, and only when newer than the initial visit. */
export function newLandingLots(previous:LandingLot[],next:LandingLot[],seen:Set<string>,since:string){
 const old=new Set(previous.map(l=>l.id));
 return next.filter(l=>!old.has(l.id)&&!seen.has(l.id)&&l.created_at>since);
}
