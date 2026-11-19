import Link from "next/link";
import {requireAdmin} from "@/lib/dal";
import {getAdminVouchers} from "@/lib/admin-collection-reports-server";
import {collectionReportFilters,VOUCHER_FILTERS} from "@/lib/admin-collection-reports";
import {CollectionReportError,ReportPagination,VoucherSummary} from "@/components/admin/collection-report-ui";
import {formatBRL} from "@/lib/lots";
import {formatPhoneBR} from "@/lib/customers";
export const metadata={title:"Vouchers do leilão"};
export const instant=false;
export default async function Page({searchParams}:PageProps<"/admin/vouchers-leilao">){
 await requireAdmin();const filters=collectionReportFilters(await searchParams);
 const data=await getAdminVouchers(filters.query,filters.status,filters.page).catch(()=>null);
 return <main className="grid min-w-0 gap-5 p-4 md:p-6"><header><h1 className="text-2xl font-semibold">Vouchers do leilão</h1><p className="mt-1 text-sm text-muted-foreground">Créditos de rifas, saldo por cliente e aplicações nos arremates.</p></header>
 {data&&<VoucherSummary data={data.summary}/>}
 <form action="/admin/vouchers-leilao" className="flex flex-wrap gap-3"><input aria-label="Buscar voucher" name="q" defaultValue={filters.query} placeholder="Cliente, telefone ou rifa" maxLength={120} className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3"/><select aria-label="Situação do voucher" name="status" defaultValue={filters.status} className="h-10 max-w-full rounded-lg border bg-background px-3">{Object.entries(VOUCHER_FILTERS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><button className="rounded-lg border px-4 py-2 font-semibold">Buscar</button><Link href="/admin/vouchers-leilao" className="px-2 py-2 text-sm underline">Limpar</Link></form>
 {!data?<CollectionReportError href="/admin/vouchers-leilao"/>:<><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[800px] text-left text-sm"><thead className="bg-muted/50"><tr>{["Cliente","Rifa / voucher","Emitido","Disponível","Em lotes pendentes","Em lotes quitados","Histórico"].map(label=><th key={label} className="p-3 font-medium">{label}</th>)}</tr></thead><tbody>{data.items.map(v=><tr key={v.id} className="border-t"><td className="p-3"><Link href={`/admin/clientes/${v.customer_id}`} className="font-semibold underline">{v.customer_name||"Cliente cadastrado"}</Link><p className="mt-1 text-xs text-muted-foreground">{formatPhoneBR(v.phone_e164)}</p></td><td className="max-w-64 p-3"><Link href={`/admin/rifa/${v.campaign_id}`} className="underline">{v.campaign_title}</Link><p className="mt-1 text-xs text-muted-foreground">{v.title}</p>{v.status==="review"&&<p className="mt-1 font-semibold text-amber-700 dark:text-amber-300">Em revisão · saldo bloqueado</p>}</td><td className="p-3 tabular-nums">{formatBRL(v.amount)}</td><td className="p-3 font-semibold tabular-nums">{formatBRL(v.status==="review"?0:v.remaining)}</td><td className="p-3 tabular-nums">{formatBRL(v.reserved)}</td><td className="p-3 tabular-nums">{formatBRL(v.used)}</td><td className="p-3"><Link className="whitespace-nowrap font-semibold underline" href={`/admin/vouchers-leilao/${v.id}`}>Ver aplicações →</Link></td></tr>)}</tbody></table>{!data.items.length&&<p className="p-6 text-center text-sm text-muted-foreground">Nenhum voucher encontrado para este filtro.</p>}</div><ReportPagination path="/admin/vouchers-leilao" page={data.page} total={data.total} filters={{q:filters.query,status:filters.status}}/></>}
 </main>;
}
