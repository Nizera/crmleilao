import Link from 'next/link';
import {revalidatePath} from 'next/cache';
import {requireAdmin} from '@/lib/dal';
import {createAdminClient} from '@/lib/supabase/admin';
import {flushMetaConversions,metaConfiguration} from '@/lib/meta-conversions-server';
export const metadata={title:'Integração Meta — Loja'};
export const instant=false;
async function retry(){'use server';const {profile}=await requireAdmin();if(profile.role==='viewer')return;await flushMetaConversions(5);revalidatePath('/admin/fidelidade/meta');}
export default async function Page(){
 const {profile}=await requireAdmin(),config=metaConfiguration(),db=createAdminClient();
 const statuses=['pending','processing','sent','failed','skipped'];
 const counts=await Promise.all(statuses.map(async status=>{const {count,error}=await db.from('store_meta_events').select('id',{count:'exact',head:true}).eq('status',status);return {status,count,error:!!error};}));
 const {data:recent,error}=await db.from('store_meta_events').select('event_id,status,attempts,error_code,sent_at,created_at').order('created_at',{ascending:false}).limit(20);
 return <main className="grid gap-5"><Link className="text-sm underline" href="/admin/fidelidade">Voltar à loja</Link><h1 className="text-2xl font-bold">Meta — rastreamento da loja</h1><div className="rounded-xl border p-4 text-sm"><p>Pixel: {config.pixel??'Não configurado'}</p><p>Credencial do servidor: {config.token?'Configurada':'Ausente'}</p><p>Envio em produção: {config.enabled?'Habilitado':'Desabilitado'}</p><p>Eventos de teste: {process.env.META_TEST_EVENT_CODE?'Habilitados; remova META_TEST_EVENT_CODE para vendas reais':'Desabilitados'}</p></div><p className="text-sm">Compras em reais, após desconto e sem frete. Resgates e pedidos anteriores à integração não entram. Cada venda exige consentimento. “Enviado” indica recebimento pela Meta, sem garantir atribuição a anúncio.</p><div className="flex flex-wrap gap-3">{counts.map(x=><p key={x.status} className="rounded-lg border p-3">{x.status}: {x.error?'Indisponível':x.count}</p>)}</div>{profile.role!=='viewer'&&<form action={retry}><button className="rounded-lg border px-4 py-2">Processar eventos pendentes</button></form>}{error?<p>Não foi possível consultar a fila.</p>:<div className="overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th>Evento</th><th>Situação</th><th>Tentativas</th><th>Retorno</th></tr></thead><tbody>{recent?.map(x=><tr key={x.event_id}><td className="p-2">{x.event_id}</td><td>{x.status}</td><td>{x.attempts}</td><td>{x.error_code??'—'}</td></tr>)}</tbody></table>{!recent?.length&&<p className="py-4">Ainda não há compras elegíveis na fila.</p>}</div>}</main>;
}
