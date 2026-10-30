"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Menu } from "lucide-react";
import { LANDING_GROUP_URL, LANDING_SHOWCASE } from "@/lib/landing-content";
import { landingStyles as s } from "./landing-styles";

export function WhatsAppGlyph() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M20.2 11.7a8.2 8.2 0 0 1-12.1 7.2L3 20.4l1.5-4.8a8.2 8.2 0 1 1 15.7-3.9Z" /><path d="M8.4 7.4c-.8.2-.9 1.2-.6 2.3.7 2.5 3.6 5.3 6.3 5.9 1.2.3 2.1-.1 2.3-1l-2.2-1.3-.9.8c-1.6-.7-3.2-2.2-3.8-3.7l.7-.9-1.1-2.1h-.7Z" /></svg>;
}

export function LandingMobileMenu() {
  return <details className={s.mobileMenu} onClick={event => {
    if ((event.target as HTMLElement).closest("a")) event.currentTarget.open = false;
  }}><summary aria-label="Abrir menu de navegação"><Menu size={24} aria-hidden="true" /></summary><nav aria-label="Navegação mobile">
    <a href="#arremates">Arremates</a><a href="#como-funciona">Como funciona</a><a href="#o-app">Conheça o app</a><a href="#duvidas">Dúvidas frequentes</a>
    <Link href="/painel/login">Entrar no painel</Link>
  </nav></details>;
}

export function ShowcaseCarousel() {
  const scroller = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ start: true, end: false });
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const update = () => setBounds({ start: element.scrollLeft < 4, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 4 });
    update();
    element.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(element);
    return () => { element.removeEventListener("scroll", update); resize.disconnect(); };
  }, []);
  const move = (direction: number) => {
    const element = scroller.current;
    if (!element) return;
    const card = element.querySelector("article");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollBy({ left: direction * ((card?.getBoundingClientRect().width ?? element.clientWidth) + parseFloat(getComputedStyle(element).gap || "0")), behavior: reduceMotion ? "instant" : "smooth" });
  };
  return <>
    <div className={s.carouselTools}><button className={s.arrow} aria-label="Ver arremates anteriores" aria-controls="landing-arremates" disabled={bounds.start} onClick={() => move(-1)}><ArrowLeft /></button><button className={s.arrow} aria-label="Ver próximos arremates" aria-controls="landing-arremates" disabled={bounds.end} onClick={() => move(1)}><ArrowRight /></button></div>
    <div ref={scroller} id="landing-arremates" className={s.carousel} role="region" aria-roledescription="carrossel" aria-label="Fotos de arremates anteriores" tabIndex={0} onKeyDown={event => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); move(event.key === "ArrowRight" ? 1 : -1); }
    }}>
      {LANDING_SHOWCASE.map(item => <article className={s.lotCard} key={item.image}>
        <div className={s.lotPicture}><Image src={item.image} alt={item.alt} fill sizes="(max-width: 767px) 82vw, (max-width: 1200px) 25vw, 285px" /></div>
        <p className={s.lotCategory}>{item.category}</p><h3>{item.title}</h3><span className={s.sold}>Arrematado</span>
      </article>)}
    </div>
    <div className={s.carouselNote}><p>Fotos reais de lotes anteriores. Novos lotes e condições são divulgados no grupo.</p><a href={LANDING_GROUP_URL} target="_blank" rel="noopener noreferrer">Quero participar →</a></div>
  </>;
}

const APP_TABS = [
  { id: "lotes", label: "Lotes", image: "/landing/screens/painel-lotes.webp", alt: "Captura real da interface de lotes, com dados de uma conta de demonstração" },
  { id: "pix", label: "Pagamentos", image: "/landing/screens/painel-pix.webp", alt: "Captura real da interface de pagamentos Pix, com valores fictícios" },
  { id: "envios", label: "Envios", image: "/landing/screens/painel-envios-v2.webp", alt: "Captura real da interface de envios e rastreamento, com dados fictícios" },
] as const;

export function AppPreviewTabs() {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  return <div>
    <div className={s.tabs} role="tablist" aria-label="Telas do painel do cliente">
      {APP_TABS.map((tab, index) => <button key={tab.id} ref={element => { tabRefs.current[index] = element; }} id={`app-tab-${tab.id}`} type="button" role="tab" aria-selected={active === index} aria-controls={`app-preview-${tab.id}`} tabIndex={active === index ? 0 : -1} className={s.tab} onClick={() => setActive(index)} onKeyDown={event => {
        const next = event.key === "ArrowRight" ? (index + 1) % APP_TABS.length : event.key === "ArrowLeft" ? (index + APP_TABS.length - 1) % APP_TABS.length : event.key === "Home" ? 0 : event.key === "End" ? APP_TABS.length - 1 : null;
        if (next !== null) { event.preventDefault(); setActive(next); tabRefs.current[next]?.focus(); }
      }}>{tab.label}</button>)}
    </div>
    {APP_TABS.map((tab, index) => <div key={tab.id} role="tabpanel" id={`app-preview-${tab.id}`} aria-labelledby={`app-tab-${tab.id}`} hidden={active !== index} tabIndex={0}><div className={s.appPhone}><a href={tab.image} target="_blank" rel="noopener noreferrer" aria-label={`Ampliar captura de ${tab.label}`}><Image src={tab.image} alt={tab.alt} width={390} height={844} sizes="270px" /></a></div></div>)}
    <p className={s.captureCaption}>Toque na imagem para ampliar.<br />Interface real do app · conta de demonstração, com dados fictícios</p>
  </div>;
}

export function StickyGroupCta() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const anchors = document.querySelectorAll<HTMLElement>("[data-primary-group-cta]");
    const seen = new Map<Element, boolean>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) seen.set(entry.target, entry.isIntersecting);
      setVisible(![...seen.values()].some(Boolean));
    }, { threshold: .3 });
    anchors.forEach(anchor => observer.observe(anchor));
    return () => observer.disconnect();
  }, []);
  if (!visible) return null;
  return <aside className={s.sticky} aria-label="Participar do leilão"><a href={LANDING_GROUP_URL} target="_blank" rel="noopener noreferrer" className={s.button}><WhatsAppGlyph />Entrar no grupo<ArrowRight size={18} aria-hidden="true" /></a></aside>;
}
