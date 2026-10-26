import type { OrderHistoryData } from "./order-history";

export const STORE_DASHBOARD_PATH = "/admin/fidelidade";
export type DashboardPeriod = { preset: "today" | "7d" | "30d" | "custom"; from: string; to: string; today: string };
export type StoreDashboardData = {
  active: boolean;
  metrics: { cash: number; coins: number; orders: number; known_cost: number; missing_cost_units: number };
  operations: { "to-fulfill": number; processing: number; review: number; "low-stock": number };
  chart: { day: string; cash: number; orders: number }[];
  top_products: { reward_id: string | null; name: string; units: number; cash: number; coins: number }[];
  alerts: { "missing-photo": number; "missing-cost": number; "sold-out": number };
  recent: OrderHistoryData;
};
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
const shift = (s: string,n: number) => { const d=new Date(`${s}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10); };
export function dashboardPeriod(params: Record<string,string|string[]|undefined>,now=new Date()): DashboardPeriod {
  const one=(key:string)=>(Array.isArray(params[key]) ? params[key][0] : params[key]) ?? "";
  const parts = new Intl.DateTimeFormat("en",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  const part=(type:string)=>parts.find(p=>p.type===type)!.value;
  const today=`${part('year')}-${part('month')}-${part('day')}`;
  const requested=one('period');
  if(requested==='custom' && validDate(one('from')) && validDate(one('to'))) {
    const to=one('to')>today ? today : one('to');
    const earliest=shift(to,-365);
    const from=one('from')>to ? to : one('from')<earliest ? earliest : one('from');
    return {preset:'custom',from,to,today};
  }
  const preset=requested==='today'||requested==='7d' ? requested : '30d';
  return {preset,from:shift(today,preset==='today' ? 0 : preset==='7d' ? -6 : -29),to:today,today};
}
export const dashboardDate = (day:string) => day.split('-').reverse().join('/');
