import Image from 'next/image';
import {Ticket} from 'lucide-react';
import {storeBRL} from '@/lib/store';

// Cada valor ganha uma arte da mesma coleção; não prende a imagem ao nome do cadastro.
const artwork:Record<number,string>={1000:'/store/vouchers/voucher-10-v1.webp'};
export function VoucherArtwork({amount,compact=false}:{amount:number;compact?:boolean}){
 const image=Number.isFinite(amount)?artwork[Math.round(amount*100)]:undefined;
 return <div className={`relative overflow-hidden rounded-xl border border-ouro/20 bg-neutral-950 ${compact?'w-24 shrink-0':'w-full'}`}>
  {image?<Image src={image} alt={`Voucher de ${storeBRL(amount)} de desconto`} width={1536} height={1024} sizes={compact?'96px':'(max-width:640px) 90vw,(max-width:1280px) 40vw,480px'} className="aspect-[3/2] h-auto w-full object-contain"/>:<div className={`flex aspect-[3/2] flex-col items-center justify-center gap-2 bg-gradient-to-br from-neutral-900 to-black px-3 text-center text-amber-300 ${compact?'text-xs':'text-xl'}`}><Ticket className={compact?'size-5':'size-8'}/><span className="text-[9px] font-semibold uppercase tracking-widest">Voucher</span><strong>{Number.isFinite(amount)&&amount>0?storeBRL(amount):'Loja dos Caras'}</strong></div>}
 </div>;
}
