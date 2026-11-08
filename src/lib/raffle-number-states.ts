export type RaffleNumberState = {number:number;state:"available"|"paid"|"reserved"};
import type { RafflePriceTier } from "@/lib/raffle-pricing";
export type RaffleNumberStates = {instant_awards?:{prize_id:string;confirmed:boolean;number:number|null;winner_name:string|null}[];unit_price?:number;price_tiers?:RafflePriceTier[];total:number;occupied:RaffleNumberState[]};

export function expandRaffleNumberStates(snapshot: RaffleNumberStates, expectedTotal: number): RaffleNumberState[] {
  if(!Number.isInteger(expectedTotal)||expectedTotal<2||expectedTotal>10000||snapshot.total!==expectedTotal)throw new Error("Quantidade de cotas inválida.");
  const occupied=new Map<number,RaffleNumberState["state"]>();
  for(const row of snapshot.occupied){
    if(!Number.isInteger(row.number)||row.number<0||row.number>=expectedTotal||!["paid","reserved"].includes(row.state)||occupied.has(row.number))throw new Error("Estado de cotas inválido.");
    occupied.set(row.number,row.state);
  }
  return Array.from({length:expectedTotal},(_,number)=>({number,state:occupied.get(number)??"available"}));
}
