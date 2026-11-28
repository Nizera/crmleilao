import {MarketingPreferencesLink} from "@/components/client/marketing-preferences-link";
import { AuctionPreregistration } from "@/components/marketing/auction-preregistration";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, AtSign, Layers, QrCode, Truck } from "lucide-react";
import { AppPreviewTabs, LandingMobileMenu, StickyGroupCta, WhatsAppGlyph } from "@/components/marketing/landing-interactions";
import { LANDING_FAQ, LANDING_GROUP_URL, LANDING_INSTAGRAM_URL, LANDING_STEPS } from "@/lib/landing-content";
import "@/components/marketing/landing.css";
import {LandingLiveCatalog} from "@/components/marketing/landing-live";
import { landingStyles as s } from "@/components/marketing/landing-styles";

export const metadata: Metadata = {
  title: "Leilões de Legends, Prizm e Gold Crumple",
  description: "Dois leilões por dia. Veja os lotes de Legends, Prizm e Gold Crumple, confira os horários e dê seu lance no grupo do WhatsApp.",
  alternates: { canonical: "/" },
};
const tiers = [{ key: "lilas", name: "Lilás" }, { key: "bronze", name: "Bronze" }, { key: "prata", name: "Prata" }, { key: "ouro", name: "Ouro" }, { key: "crumple", name: "Crumple" }, { key: "prizm", name: "Prizm" }];
const benefits = [
  { icon: Layers, title: "Histórico de arremates", text: "Consulte as fotos e os valores dos lotes que você arrematou." },
  { icon: QrCode, title: "Pagamento via Pix", text: "Veja o total a pagar e acompanhe a confirmação." },
  { icon: Truck, title: "Rastreio do pedido", text: "Confira quando seu pacote for postado e acompanhe a entrega." },
];

const customerFeedback = [
  {
    title: "Primeiro lote",
    quote: "Recebi o meu primeiro lote hoje, top demais. Material original e muito bem protegido.",
    image: "/landing/feedbacks/primeiro-lote.webp",
    alt: "Figurinhas Legends recebidas junto da embalagem do pedido",
  },
  {
    title: "Entrega em Pernambuco",
    quote: "Mas a organização e qualidade dos produtos é indiscutível. Chega numa organização gigante aqui em Pernambuco.",
    image: "/landing/feedbacks/entrega-pernambuco.webp",
    alt: "Figurinhas douradas de um pedido recebido em Pernambuco",
  },
  {
    title: "Coleção recebida",
    quote: "Boa tarde. As minhas figurinhas chegaram nessa semana.",
    image: "/landing/feedbacks/colecao-recebida.webp",
    alt: "Figurinhas recebidas organizadas em fileiras sobre a mesa do colecionador",
  },
];

export default function LandingPage() {
  return <div className={s.root}>
    <AuctionPreregistration emailEnabled={Boolean(process.env.RESEND_API_KEY && process.env.AUCTION_INVITE_EMAIL_FROM)} />
    <a href="#conteudo" className={s.skip}>Ir para o conteúdo</a>
    <header className={s.header}><div className={`${s.container} ${s.headerInner}`}>
      <Link href="/" className={s.brand} aria-label="Os Caras das Legends — início"><Image src="/brand/logo-horizontal-v2.webp" alt="Os Caras das Legends" width={348} height={174} sizes="174px" /></Link>
      <nav className={s.desktopNav} aria-label="Navegação principal"><a href="#arremates">Arremates</a><a href="#como-funciona">Como funciona</a><a href="#loja">Loja</a></nav>
      <div className={s.navActions}>
        <Link href="/painel/login" className={`${s.quietLink} landing-existingCustomer`}>Já sou cliente</Link>
        <a href={LANDING_GROUP_URL} target="_blank" rel="noopener noreferrer" className={`${s.button} ${s.smallButton} ${s.navGroupButton}`}>Entrar no grupo<WhatsAppGlyph /></a>
        <LandingMobileMenu />
      </div>
    </div></header>
    <main id="conteudo">
      <section className={s.hero} aria-labelledby="hero-title"><div className={`${s.container} ${s.heroGrid}`}>
        <div>
          <h1 id="hero-title">Figurinhas raras, <span>dois leilões por dia</span></h1>
          <p className={s.heroText}>Entre no grupo do WhatsApp para ver os próximos lotes de Legends, Prizm e Gold Crumple, conferir os horários e dar seu lance.</p>
          <div className={s.heroActions}><a href={LANDING_GROUP_URL} target="_blank" rel="noopener noreferrer" className={s.button} data-primary-group-cta="hero"><WhatsAppGlyph />Ver lotes e horários no grupo<ArrowRight aria-hidden="true" /></a></div>
        </div>
        <figure className="landing-heroLot">
          <Image src="/landing/arremates/lote-legends-prizm-crumple.webp" alt="Prizm do Messi, Gold Crumple do Cristiano Ronaldo e figurinhas Legends, incluindo Vini Jr." width={1600} height={1250} sizes="(max-width: 767px) calc(100vw - 40px), (max-width: 1248px) 44vw, 540px" loading="eager" fetchPriority="high" />
          <figcaption>Legends, Prizm e Gold Crumple</figcaption>
        </figure>
      </div></section>

      <section id="arremates" className={s.section} aria-labelledby="arremates-title"><div className={s.container}>
        <div className={s.sectionTop}><div><h2 id="arremates-title" className={s.heading}>O que já saiu nos <em>nossos leilões</em></h2><p className={s.intro}>Veja as fotos dos lotes já arrematados. Os próximos lotes são anunciados no grupo.</p></div></div><LandingLiveCatalog section="lots" />
      </div></section>

      <section id="feedbacks" className={`${s.section} landing-feedbacks`} aria-labelledby="feedbacks-title">
        <div className={s.container}>
          <h2 id="feedbacks-title" className={s.heading}>Pedidos que já chegaram</h2>
          <p className={s.intro}>Veja as fotos e leia os relatos de quem recebeu as figurinhas.</p>
          <div className="landing-feedbackGrid">
            {customerFeedback.map(({ title, quote, image, alt }) => (
              <article className="landing-feedbackCard" key={image}>
                <div className="landing-feedbackPhoto">
                  <Image
                    src={image}
                    alt={alt}
                    fill
                    sizes="(max-width: 767px) calc(100vw - 48px), (max-width: 1248px) 32vw, 386px"
                  />
                </div>
                <div className="landing-feedbackBody">
                  <h3>{title}</h3>
                  <blockquote><p>“{quote}”</p></blockquote>
                </div>
              </article>
            ))}
          </div>
          <a href={LANDING_GROUP_URL} target="_blank" rel="noopener noreferrer" className={`${s.button} landing-feedbackCta`} data-primary-group-cta="feedbacks">
            <WhatsAppGlyph />Entrar no grupo do leilão<ArrowRight aria-hidden="true" />
          </a>
        </div>
      </section>

      <section id="como-funciona" className={`${s.section} ${s.stepsSection}`} aria-labelledby="steps-title"><div className={s.container}>
        <h2 id="steps-title" className={s.heading}>Como participar do <em>leilão</em></h2>
        <div className={s.stepsGrid}>{LANDING_STEPS.map((step, index) => <article className={s.step} key={step.icon}><span className={s.stepNumber}>0{index + 1}</span><Image className={s.stepArt} src={`/landing/icons/${step.icon}.webp`} alt="" width={122} height={122} sizes="122px" /><h3>{step.title}</h3><p>{step.text}</p></article>)}</div>
      </div></section>

      <section id="o-app" className={`${s.section} ${s.appSection}`} aria-labelledby="app-title"><div className={`${s.container} ${s.appGrid}`}>
        <div><p className={s.eyebrow}>Depois do primeiro arremate</p><h2 id="app-title" className={s.heading}>Do Pix ao rastreio, <em>tudo no painel</em></h2><p className={s.intro}>Depois do seu primeiro arremate, a equipe envia pelo WhatsApp o convite para ativar seu acesso.</p>
          <div className={s.benefits}>{benefits.map(item => <div className={s.benefit} key={item.title}><span><item.icon aria-hidden="true" /></span><div><h3>{item.title}</h3><p>{item.text}</p></div></div>)}</div>
          <Link href="/painel/login" className={`${s.quietLink} landing-panelLogin`}>Já tem acesso? Entre no painel</Link>
        </div><AppPreviewTabs />
      </div></section>

      <section id="loja" className={s.section} aria-labelledby="loja-title"><div className={s.container}>
        <div className={s.sectionTop}><div><h2 id="loja-title" className={s.heading}>Figurinhas e cards <em>na loja</em></h2><p className={s.intro}>Confira as peças disponíveis para compra direta.</p></div><Link href="/loja" className="landing-storeLink">Visitar a loja<ArrowRight size={18} /></Link></div>
        <LandingLiveCatalog section="store" />
      </div></section>

      <section className={s.loyalty} aria-labelledby="ranking-title"><div className={`${s.container} ${s.loyaltyGrid}`}>
        <div><h2 id="ranking-title" className={s.heading}>Caracoins e <em>elos da comunidade</em></h2><p>No painel, você consulta seu saldo, as regras do programa e a evolução do seu elo.</p><Link href="/painel/ranking">Ver meu ranking<ArrowRight size={14} aria-hidden="true" /></Link></div>
        <div className={s.tierGrid}>{tiers.map(tier => <div className={s.tier} key={tier.key}><Image src={`/elos/${tier.key}.svg`} alt={`Brasão do elo ${tier.name}`} width={76} height={88} /><span>{tier.name}</span></div>)}</div>
      </div></section>

      <section id="duvidas" className={s.section} aria-labelledby="faq-title"><div className={`${s.container} ${s.faqGrid}`}>
        <div><h2 id="faq-title" className={s.heading}>Dúvidas antes do <em>primeiro lance</em></h2></div>
        <div className={s.faqList}>{LANDING_FAQ.map(item => <details className={s.faqItem} key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div>
      </div></section>

      <section className={s.final} aria-labelledby="final-title"><div className={`${s.container} ${s.finalInner}`}>
        <div><h2 className={s.heading} id="final-title">Quer acompanhar a <em>próxima rodada?</em></h2><p>Abra o convite no WhatsApp e toque em “Solicitar entrada”. Depois da aprovação, você pode conferir os próximos lotes e horários.</p></div>
        <div className={s.finalActions}><a className={s.button} href={LANDING_GROUP_URL} target="_blank" rel="noopener noreferrer" data-primary-group-cta="footer"><WhatsAppGlyph />Entrar no grupo<ArrowRight aria-hidden="true" /></a></div>
      </div></section>
    </main>
    <footer className={s.footer}><div className={s.container}><div className={s.footerInner}><Link href="/" className={s.footerBrand}><Image src="/brand/logo-horizontal-v2.webp" alt="Os Caras das Legends" width={280} height={140} sizes="145px" /></Link><nav aria-label="Links do rodapé"><a href="#como-funciona">Como funciona</a><Link href="/painel/login">Área do cliente</Link><a href={LANDING_INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2"><AtSign size={15} aria-hidden="true" />Instagram</a><Link href="/login">Painel interno</Link><MarketingPreferencesLink/></nav></div><small>Os Caras das Legends · Leilão diário de colecionáveis</small></div></footer>
    <StickyGroupCta />
  </div>;
}
