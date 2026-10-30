import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowRight, CircleCheck, AtSign, Layers, QrCode, Truck } from "lucide-react";
import { AppPreviewTabs, LandingMobileMenu, ShowcaseCarousel, StickyGroupCta, WhatsAppGlyph } from "@/components/marketing/landing-interactions";
import { LANDING_FAQ, LANDING_GROUP_URL, LANDING_INSTAGRAM_URL, LANDING_STEPS } from "@/lib/landing-content";
import "@/components/marketing/landing.css";
import { landingStyles as s } from "@/components/marketing/landing-styles";

export const metadata: Metadata = {
  title: "Leilões de colecionáveis no WhatsApp",
  description: "Participe dos leilões de colecionáveis dos Caras das Legends no WhatsApp. Acompanhe seus lotes, pagamentos Pix, Caracoins e envios pelo painel do cliente.",
  alternates: { canonical: "/" },
};
const tiers = [{ key: "lilas", name: "Lilás" }, { key: "bronze", name: "Bronze" }, { key: "prata", name: "Prata" }, { key: "ouro", name: "Ouro" }, { key: "crumple", name: "Crumple" }, { key: "prizm", name: "Prizm" }];
const benefits = [
  { icon: Layers, title: "Seus lotes, todos juntos", text: "Veja as fotos, os valores e o histórico dos seus arremates, sem procurar mensagens antigas." },
  { icon: QrCode, title: "Pix sem complicação", text: "O painel reúne os pagamentos pendentes. Você paga e acompanha a confirmação." },
  { icon: Truck, title: "Envios com rastreio", text: "Da preparação do pacote até a entrega, confira as atualizações no seu painel." },
];

export default function LandingPage() {
  return <div className={s.root}>
    <a href="#conteudo" className={s.skip}>Ir para o conteúdo</a>
    <header className={s.header}><div className={`${s.container} ${s.headerInner}`}>
      <Link href="/" className={s.brand} aria-label="Os Caras das Legends — início"><Image src="/brand/logo-horizontal-v2.webp" alt="Os Caras das Legends" width={348} height={174} sizes="174px" /></Link>
      <nav className={s.desktopNav} aria-label="Navegação principal"><a href="#arremates">Arremates</a><a href="#como-funciona">Como funciona</a><a href="#o-app">O app</a></nav>
      <div className={s.navActions}><Link href="/painel/login" className={`${s.button} ${s.smallButton} ${s.outlineButton}`}>Entrar<span className="hidden lg:inline"> no painel</span></Link><a href={LANDING_GROUP_URL} target="_blank" rel="noopener noreferrer" className={`${s.button} ${s.smallButton} ${s.navGroupButton}`}>Entrar no grupo<WhatsAppGlyph /></a><LandingMobileMenu /></div>
    </div></header>
    <main id="conteudo">
      <section className={s.hero} aria-labelledby="hero-title"><div className={`${s.container} ${s.heroGrid}`}>
        <div><p className={s.eyebrow}>Leilão diário de colecionáveis</p><h1 id="hero-title">Leilões no WhatsApp.<span>Tudo organizado no app.</span></h1><p className={s.heroText}>Sua próxima peça de coleção pode estar no nosso grupo. Dê seu lance e acompanhe seus lotes, Pix e envios em um só lugar.</p>
          <div className={s.heroActions}><a href={LANDING_GROUP_URL} target="_blank" rel="noopener noreferrer" className={s.button} data-primary-group-cta="hero"><WhatsAppGlyph />Entrar no grupo do leilão<ArrowRight aria-hidden="true" /></a><a href="#o-app" className={s.quietLink}>Conhecer o painel<ArrowDown size={15} aria-hidden="true" /></a></div>
          <div className={s.heroTrust}><span><QrCode aria-hidden="true" />Pix no painel</span><span><Truck aria-hidden="true" />Rastreio dos envios</span><span><CircleCheck aria-hidden="true" />Lotes organizados</span></div>
        </div>
        <div className={s.heroVisual}><div className={s.halo} aria-hidden="true" /><div className={`${s.statusCard} ${s.paymentCard}`}><span className={s.statusIcon}><QrCode aria-hidden="true" /></span><span><small>PIX NO PAINEL</small><strong>Pagamento confirmado</strong><span className={s.statusDetail}><CircleCheck aria-hidden="true" />Tudo certo com seus lotes</span></span></div><div className={s.phone}><Image src="/landing/screens/painel-lotes.webp" alt="Painel real do cliente em uma conta de demonstração, com lotes e valores fictícios" width={390} height={844} sizes="(max-width:767px) 205px, 254px" priority /></div><div className={`${s.statusCard} ${s.shippingCard}`}><span className={s.statusIcon}><Truck aria-hidden="true" /></span><span><small>ACOMPANHE PELO APP</small><strong>Seu pacote está a caminho</strong><span className={s.statusDetail}>Rastreio em um só lugar<ArrowRight aria-hidden="true" /></span></span></div><p className={s.visualCaption}>Seu painel no celular · dados de demonstração</p></div>
      </div></section>

      <section id="arremates" className={s.section} aria-labelledby="arremates-title"><div className={s.container}>
        <div className={s.sectionTop}><div><p className={s.eyebrow}>Da nossa comunidade</p><h2 id="arremates-title" className={s.heading}>Já passou <em>pelo leilão.</em></h2><p className={s.intro}>Figurinhas, cards, pacotes e novas histórias para a sua coleção.</p></div><span className={s.sectionLabel}>Fotos reais · seleção de arremates</span></div><ShowcaseCarousel />
      </div></section>

      <section id="como-funciona" className={`${s.section} ${s.stepsSection}`} aria-labelledby="steps-title"><div className={s.container}>
        <p className={s.eyebrow}>Simples, do começo ao fim</p><h2 id="steps-title" className={s.heading}>Do grupo para <em>a sua coleção.</em></h2>
        <div className={s.stepsGrid}>{LANDING_STEPS.map((step, index) => <article className={s.step} key={step.icon}><span className={s.stepNumber}>0{index + 1}</span><Image className={s.stepArt} src={`/landing/icons/${step.icon}.webp`} alt="" width={122} height={122} sizes="122px" /><h3>{step.title}</h3><p>{step.text}</p></article>)}</div>
      </div></section>

      <section id="o-app" className={`${s.section} ${s.appSection}`} aria-labelledby="app-title"><div className={`${s.container} ${s.appGrid}`}>
        <div className={s.appCopy}><p className={s.eyebrow}>O painel que acompanha sua coleção</p><h2 id="app-title" className={s.heading}>Seu leilão,<br /><em>sem mensagens perdidas.</em></h2><p className={s.intro}>O lance acontece no grupo. A organização fica por nossa conta: você acessa seu painel pelo celular e acompanha cada etapa.</p>
          <div className={s.benefits}>{benefits.map(item => <div className={s.benefit} key={item.title}><span><item.icon aria-hidden="true" /></span><div><h3>{item.title}</h3><p>{item.text}</p></div></div>)}</div>
          <Link href="/painel/login" className={`${s.button} ${s.outlineButton}`}>Acessar meu painel<ArrowRight aria-hidden="true" /></Link>
        </div><AppPreviewTabs />
      </div></section>

      <section className={s.loyalty} aria-labelledby="ranking-title"><div className={`${s.container} ${s.loyaltyGrid}`}>
        <div><p className={s.eyebrow}>Caracoins e ranking</p><h2 id="ranking-title" className={s.heading}>Sua coleção cresce.<br /><em>Seu elo também.</em></h2><p>Acompanhe seus Caracoins, entenda as regras do programa e veja sua evolução. Cada etapa da sua jornada tem seu próprio brasão.</p><Link href="/painel/ranking">Ver meu ranking<ArrowRight size={14} aria-hidden="true" /></Link></div>
        <div className={s.tierGrid}>{tiers.map(tier => <div className={s.tier} key={tier.key}><Image src={`/elos/${tier.key}.svg`} alt={`Brasão do elo ${tier.name}`} width={76} height={88} /><span>{tier.name}</span></div>)}</div>
      </div></section>

      <section id="duvidas" className={s.section} aria-labelledby="faq-title"><div className={`${s.container} ${s.faqGrid}`}>
        <div><p className={s.eyebrow}>Tire suas dúvidas</p><h2 id="faq-title" className={s.heading}>Antes do<br /><em>primeiro lance.</em></h2><p className={s.intro}>Chegou agora? A gente te ajuda a entender como tudo funciona.</p></div>
        <div className={s.faqList}>{LANDING_FAQ.map(item => <details className={s.faqItem} key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div>
      </div></section>

      <section className={s.final} aria-labelledby="final-title"><div className={`${s.container} ${s.finalInner}`}>
        <div><h2 className={s.heading} id="final-title">Sua próxima peça<br /><em>começa com um lance.</em></h2><p>Entre no grupo e venha fazer parte da nossa comunidade de colecionadores.</p></div>
        <div className={s.finalActions}><a className={s.button} href={LANDING_GROUP_URL} target="_blank" rel="noopener noreferrer" data-primary-group-cta="footer"><WhatsAppGlyph />Entrar no grupo<ArrowRight aria-hidden="true" /></a><Link href="/painel/login" className={s.quietLink}>Já sou cliente. Acessar meu painel.</Link></div>
      </div></section>
    </main>
    <footer className={s.footer}><div className={s.container}><div className={s.footerInner}><Link href="/" className={s.footerBrand}><Image src="/brand/logo-horizontal-v2.webp" alt="Os Caras das Legends" width={280} height={140} sizes="145px" /></Link><nav aria-label="Links do rodapé"><a href="#como-funciona">Como funciona</a><Link href="/painel/login">Área do cliente</Link><a href={LANDING_INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2"><AtSign size={15} aria-hidden="true" />Instagram</a><Link href="/login">Painel interno</Link></nav></div><small>Os Caras das Legends · Leilão diário de colecionáveis</small></div></footer>
    <StickyGroupCta />
  </div>;
}
