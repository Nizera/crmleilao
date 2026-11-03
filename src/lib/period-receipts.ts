import { isInAuctionPeriod, type AuctionPeriod } from "@/lib/auction-period";
import { spWeekdayKey, type FreightDayKey } from "@/lib/freight";
type PaidLot = { status: string; paid_at: string | null; arremate_value: number | string };
export type FreightReceipt = { id: string; customer_id: string; status: string; paid_at: string | null; freight_amount: number | string };
export function computePeriodReceipts(lots: PaidLot[], charges: FreightReceipt[], store: FreightReceipt[], period: AuctionPeriod) {
  const paid = lots.filter(l => Number(l.arremate_value)>0 && ["paid","shipped","delivered"].includes(l.status) && l.paid_at && isInAuctionPeriod(l.paid_at,period));
  const byDay: Record<FreightDayKey,number>={ter:0,qua:0,qui:0,sex:0,sab:0,dom:0,seg:0};
  const customers=new Set<string>(),seen=new Set<string>();let freightCents=0;
  for(const [source,rows,state] of [["auction",charges,"approved"],["store",store,"paid"]] as const)for(const r of rows){
    const key=source+":"+r.id;
    if(seen.has(key)||r.status!==state||!r.paid_at||!isInAuctionPeriod(r.paid_at,period)||Number(r.freight_amount)<=0)continue;
    seen.add(key);const cents=Math.round(Number(r.freight_amount)*100);freightCents+=cents;customers.add(r.customer_id);const day=spWeekdayKey(r.paid_at);if(day)byDay[day]+=cents/100;
  }
  const lotsTotal=paid.reduce((n,l)=>n+Math.round(Number(l.arremate_value)*100),0)/100;
  return {lotsTotal,paidLots:paid.length,freightTotal:freightCents/100,total:Math.round(lotsTotal*100+freightCents)/100,paidCustomers:customers.size,byDay};
}
