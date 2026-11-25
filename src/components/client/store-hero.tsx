'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { bannerImageUrl, storeProductImageUrl, defaultBanner, type StoreBanner } from '@/lib/store-presentation';

type HeroProps = { banner?: Partial<StoreBanner> | null; productImages?:{path:string;name:string}[]; previewImages?:{desktop?:string;mobile?:string}; publicView?:boolean; showCopa?: boolean };

const copaBanner = {
  title: 'Copa 2026 na Loja dos Caras',
  subtitle: 'Álbuns, dispensers e pacotinhos Panini para completar sua coleção.',
  button_label: 'Ver coleção Copa 2026',
  button_href: '/painel/loja?category=COPA%202026#catalogo-loja',
  desktop_path: '/store-banners/copa-2026-desktop.webp',
  mobile_path: '/store-banners/copa-2026-mobile.webp',
};

export function StoreHero({ showCopa = false, ...props }: HeroProps) {
  if (!showCopa || props.previewImages) return <BannerSlide {...props} />;
  if (!props.banner?.active) return <BannerSlide {...props} banner={copaBanner} />;
  return <StoreBannerCarousel {...props} />;
}

function StoreBannerCarousel(props: HeroProps) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!playing || hovered || focused) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const timer = window.setInterval(() => {
      if (!document.hidden && !motion.matches) setIndex(current => (current + 1) % 2);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [playing, hovered, focused, index]);

  const labels = [copaBanner.title, props.banner?.title || defaultBanner.title];
  return <div aria-label="Banners da loja" role="region"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
    }}>
    <BannerSlide {...props} banner={index === 0 ? copaBanner : props.banner} />
    <div className="flex items-center justify-center gap-2 pt-2">
      {labels.map((label, slot) => <button key={slot} type="button" aria-label={label}
        aria-pressed={slot === index} onClick={() => setIndex(slot)}
        className="grid min-h-9 min-w-9 place-items-center rounded-full focus-visible:outline-2">
        <span className={`block h-2 rounded-full ${slot === index ? 'w-6 bg-amber-500' : 'w-2 bg-muted-foreground/50'}`} />
      </button>)}
      <button type="button" className="min-h-9 rounded px-2 text-xs underline"
        onClick={() => setPlaying(current => !current)}>{playing ? 'Pausar rotação' : 'Retomar rotação'}</button>
    </div>
  </div>;
}

function BannerSlide({ banner, productImages=[], previewImages, publicView=false }: HeroProps) {
  const data = { ...defaultBanner, ...banner };
  const desktop=previewImages?.desktop || (data.desktop_path ? bannerImageUrl(data.desktop_path) : null);
  const mobile=previewImages?.mobile || (data.mobile_path ? bannerImageUrl(data.mobile_path) : null);
  const buttonHref=publicView ? data.button_href.replace(/^\/painel\/loja(?=\?|#|$)/,'/loja') : data.button_href;
  if (!data.active) return null;
  return <section aria-label="Destaque da loja" className="relative isolate overflow-hidden rounded-2xl bg-[#11120f] text-white sm:rounded-3xl">
    {desktop && <Image src={desktop} alt="" fill sizes="(max-width:768px) 100vw,1200px" className={`object-cover ${mobile ? 'hidden md:block' : ''}`} />}
    {mobile && <div className="relative aspect-[9/7] w-full md:hidden"><Image src={mobile} alt={data.title} fill sizes="(max-width:767px) 100vw,1px" className="object-cover" /><div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#11120f] to-transparent" /></div>}
    <div className={`absolute inset-0 bg-gradient-to-r from-black/95 via-black/75 to-black/10 ${mobile ? 'hidden md:block' : ''}`} />
    {!data.desktop_path && !data.mobile_path && <div aria-hidden className="absolute -right-10 top-0 size-80 rounded-full border-[40px] border-amber-400/10 bg-amber-400/10 blur-sm" />}
    {!data.desktop_path && !data.mobile_path && productImages.length>0 && <div aria-hidden className="pointer-events-none absolute inset-y-5 right-6 hidden w-[36%] items-center justify-center gap-2 opacity-70 md:flex">{productImages.slice(0,3).map((photo,index)=><div key={photo.path} style={{transform:`rotate(${(index-1)*10}deg) translateY(${index===1?-8:8}px)`}} className="relative h-[85%] w-1/3 overflow-hidden rounded-lg border-2 border-amber-300/40 bg-white shadow-2xl"><Image src={storeProductImageUrl(photo.path)} alt="" fill sizes="160px" className="object-contain p-2"/></div>)}</div>}
    <div className={`relative max-w-xl px-5 pb-8 sm:px-10 md:py-12 ${mobile ? 'pt-2' : 'pt-8 sm:py-12'}`}><p className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-amber-300"><Sparkles className="size-3.5"/>Loja dos Caras</p><h2 className="text-2xl font-bold leading-tight tracking-tight sm:text-4xl">{data.title}</h2><p className="mt-3 max-w-md text-xs leading-relaxed text-white/75 sm:text-sm">{data.subtitle}</p><Link href={buttonHref} className="mt-5 inline-flex min-h-11 items-center gap-3 rounded-lg bg-amber-300 px-4 py-2 text-xs font-bold text-black hover:bg-amber-200">{data.button_label}<ArrowRight className="size-4"/></Link></div>
  </section>;
}
