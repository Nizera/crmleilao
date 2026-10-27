/** Destaques da home: dia civil do leilão e dívidas antigas que ainda exigem ação. */
export function selectHomeLots<T extends {auction_date:string;status:string}>(lots:T[],today:string):T[] {
  return lots.filter(lot=>lot.auction_date===today || lot.status==='pending_payment');
}
