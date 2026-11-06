"use client";
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import {Clock3} from 'lucide-react';
import type {Lot} from '@/lib/lots';
import {auctionDeadlineLabel} from '@/lib/auction-deadlines';
export function AuctionPaymentNotice({lots}:{lots:Lot[]}){
 const router=useRouter();const [now,setNow]=useState<number|null>(null);
 const due=lots.filter(l=>l.status==='pending_payment'&&Number(l.arremate_value)>0&&l.payment_due_at).map(l=>l.payment_due_at!).sort()[0];
 useEffect(()=>{if(!due)return;const tick=()=>setNow(Date.now());tick();const t=setInterval(()=>{tick();router.refresh();},60000);return()=>clearInterval(t);},[due,router]);
 if(!due)return null;
 const minutes=now==null?null:Math.max(0,Math.ceil((Date.parse(due)-now)/60000));
 const urgent=minutes!==null&&minutes<=120;
 return <aside className={`rounded-xl border p-3 text-sm ${urgent?'border-red-400/40 bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-200':'border-amber-400/40 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200'}`}><p className="flex items-center gap-2 font-semibold"><Clock3 className="size-4 shrink-0"/>{minutes===0?'Prazo encerrado · conferindo pagamento':'Seus lotes têm prazo de 24h para pagamento'}</p><p className="mt-1 text-xs">{minutes===0?'Estamos conferindo o Pix antes de concluir o cancelamento. Pagamentos confirmados serão preservados.':`Próximo vencimento: ${auctionDeadlineLabel(due)} (horário de Brasília). ${minutes===null?'':`Restam ${Math.floor(minutes/60)}h ${minutes%60}min.`} Lotes não pagos serão cancelados e sairão da sua conta.`}</p>{minutes!==0&&<Link href="/painel/pix" className="mt-2 inline-block font-semibold underline">Pagar meus lotes</Link>}</aside>;
}
