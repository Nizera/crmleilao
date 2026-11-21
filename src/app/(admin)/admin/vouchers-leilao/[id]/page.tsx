import Link from "next/link";
import {notFound} from "next/navigation";
import {z} from "zod";
import {requireAdmin} from "@/lib/dal";
import {collectionReportFilters} from "@/lib/admin-collection-reports";
import {getAdminVoucherDetail} from "@/lib/admin-collection-reports-server";
import {CollectionReportError,ReportPagination,reportDate} from "@/components/admin/collection-report-ui";
import {formatBRL,LOT_STATUS_LABELS,type LotStatus} from "@/lib/lots";
import {formatPhoneBR} from "@/lib/customers";
export const metadata={title:"Histórico do voucher"};
export const instant=false;
export default async function Page({params,searchParams}:PageProps<"/admin/vouchers-leilao/[id]">){
 await requireAdmin();const {id}=await params;if(!z.uuid().safeParse(id).success)notFound();
 const filters=collectionReportFilters(await searchParams);
 let data;try{data=await getAdminVoucherDetail(id,filters.page);}catch{return <main className="p-6"><CollectionReportError href={`/admin/vouchers-leilao/${id}`}/></main>;}
 if(!data)notFound();const v=data.voucher;
 return <main className="grid min-w-0 gap-5 p-4 md:p-6"><Link className="text-sm underline" href="/admin/vouchers-leilao">← Vouchers do leilão</Link><header><h1 className="text-2xl font-semibold">{v.title}</h1><p className="mt-2"><Link className="font-semibold underline" href={`/admin/clientes/${v.customer_id}`}>{v.customer_name||"Cliente cadastrado"}</Link> · {formatPhoneBR(v.phone_e164)}</p><p className="mt-1 text-sm">{v.campaign_id ? <Link className="underline" href={`/admin/rifa/${v.campaign_id}`}>{v.campaign_title}</Link> : <span>{v.campaign_title}</span>}</p></header>
 <section className="rounded-xl border border-yellow-500/50 bg-yellow-50/50 p-4 dark:bg-yellow-950/20"><p>Crédito recebido: <strong>{formatBRL(v.amount)}</strong></p><p className="mt-1 text-xl font-bold">{v.status==="review"?"Saldo bloqueado em revisão":"Saldo disponível"}: {formatBRL(v.remaining)}</p><p className="mt-2 text-xs text-muted-foreground">Aplicações em lotes pendentes reservam o crédito. Cancelamentos elegíveis devolvem o saldo. Estes valores não são recebimentos em dinheiro.</p></section>
 <section className="grid gap-3"><h2 className="text-lg font-semibold">Lotes vinculados ({data.lots_total})</h2><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[600px] text-left text-sm"><thead className="bg-muted/50"><tr>{["Lote","Situação","Voucher","Valor a pagar do lote"].map(x=><th className="p-3" key={x}>{x}</th>)}</tr></thead><tbody>{data.lots.map(l=><tr className="border-t" key={l.id}><td className="p-3"><Link href={`/admin/lotes?q=${encodeURIComponent(l.code)}`} className="font-semibold underline">{l.code}</Link><p className="text-xs text-muted-foreground">{l.title}</p></td><td className="p-3">{LOT_STATUS_LABELS[l.status as LotStatus]??l.status}{l.status==="cancelled"&&<p className="text-xs">Crédito devolvido</p>}</td><td className="p-3">{formatBRL(l.voucher_amount)}</td><td className="p-3">{formatBRL(l.arremate_value)}<span className="ml-1 text-xs text-muted-foreground">sem frete</span></td></tr>)}</tbody></table>{!data.lots.length&&<p className="p-5 text-sm text-muted-foreground">Nenhum lote nesta página. Aplicações anteriores continuam registradas nos movimentos.</p>}</div></section>
 <section className="grid gap-3"><h2 className="text-lg font-semibold">Movimentações ({data.movements_total})</h2><div className="divide-y rounded-xl border">{data.movements.map(m=><article key={m.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"><div><p className="font-semibold">{Number(m.delta)>0?"Devolução / ajuste de crédito":"Aplicação no lote"} · {m.lot_code?<Link className="underline" href={`/admin/lotes?q=${encodeURIComponent(m.lot_code)}`}>{m.lot_code}</Link>:"Lote removido"}</p><p className="mt-1 text-xs text-muted-foreground">{reportDate(m.created_at)}</p></div><strong className={Number(m.delta)>0?"text-emerald-700 dark:text-emerald-300":"text-ouro-ink"}>{Number(m.delta)>0?"+":"−"}{formatBRL(Math.abs(Number(m.delta)))}</strong></article>)}{!data.movements.length&&<p className="p-5 text-sm text-muted-foreground">Sem movimentos nesta página.</p>}</div></section>
 <ReportPagination path={`/admin/vouchers-leilao/${id}`} page={data.page} total={data.total} filters={{}}/>
 </main>;
}
