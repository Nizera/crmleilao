import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { bannerImageUrl, defaultBanner, type StoreBanner } from '@/lib/store-presentation';

export function StoreHero({ banner, productImages=[], previewImages }: { banner?: Partial<StoreBanner> | null; productImages?:{path:string;name:string}[]; previewImages?:{desktop?:string;mobile?:string} }) {
  const data = { ...defaultBanner, ...banner };
  const desktop=previewImages?.desktop || (data.desktop_path ? bannerImageUrl(data.desktop_path) : null);
  const mobile=previewImages?.mobile || (data.mobile_path ? bannerImageUrl(data.mobile_path) : null);
  if (!data.active) return null;
  return <section aria-label="Destaque da loja" className="relative isolate overflow-hidden rounded-2xl bg-[#11120f] text-white sm:rounded-3xl">
    {desktop && <Image src={desktop} alt="" fill sizes="(max-width:768px) 100vw,1200px" className={`object-cover ${mobile ? 'hidden md:block' : ''}`} />}
    {mobile && <Image src={mobile} alt="" fill sizes="100vw" className="object-cover md:hidden" />}
    <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/75 to-black/10" />
    {!data.desktop_path && !data.mobile_path && <div aria-hidden className="absolute -right-10 top-0 size-80 rounded-full border-[40px] border-amber-400/10 bg-amber-400/10 blur-sm" />}
    {!data.desktop_path && !data.mobile_path && productImages.length>0 && <div aria-hidden className="pointer-events-none absolute inset-y-5 right-6 hidden w-[36%] items-center justify-center gap-2 opacity-70 md:flex">{productImages.slice(0,3).map((photo,index)=><div key={photo.path} style={{transform:`rotate(${(index-1)*10}deg) translateY(${index===1?-8:8}px)`}} className="relative h-[85%] w-1/3 overflow-hidden rounded-lg border-2 border-amber-300/40 bg-white shadow-2xl"><Image src={bannerImageUrl(photo.path)} alt="" fill sizes="160px" className="object-contain p-2"/></div>)}</div>}
    <div className="relative max-w-xl px-5 py-8 sm:px-10 sm:py-12"><p className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-amber-300"><Sparkles className="size-3.5"/>Loja dos Caras</p><h2 className="text-2xl font-bold leading-tight tracking-tight sm:text-4xl">{data.title}</h2><p className="mt-3 max-w-md text-xs leading-relaxed text-white/75 sm:text-sm">{data.subtitle}</p><Link href={data.button_href} className="mt-5 inline-flex min-h-11 items-center gap-3 rounded-lg bg-amber-300 px-4 py-2 text-xs font-bold text-black hover:bg-amber-200">{data.button_label}<ArrowRight className="size-4"/></Link></div>
  </section>;
}
