import Link from "next/link";
import Image from "next/image";
import {
  ArrowRightIcon,
  AtSignIcon,
  CalendarClockIcon,
  CoinsIcon,
  MessageCircleIcon,
} from "lucide-react";

import { Logo } from "@/components/brand/logo";
import {
  AlbumIcon,
  BidPaddleIcon,
  CrumpleIcon,
  GroupChatIcon,
  JerseyIcon,
  ParcelIcon,
  PictureFrameIcon,
  PixQrIcon,
  StickerStarIcon,
} from "@/components/icons/collectibles";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const GROUP_URL = "https://chat.whatsapp.com/EYD5CmJ0Oer4aeM0zQ9mqu";
const INSTAGRAM_URL = "https://www.instagram.com/oscarasdaslegends/";

const rarities = [
  { label: "Roxa", seal: "/brand/seal-roxa.png" },
  { label: "Bronze", seal: "/brand/seal-bronze.png" },
  { label: "Prata", seal: "/brand/seal-prata.png" },
  { label: "Ouro", seal: "/brand/seal-ouro.png" },
];

const items = [
  {
    icon: StickerStarIcon,
    title: "Legends",
    description:
      "As 80 figurinhas Legend da Copa 2026 — 20 jogadores em acabamento roxo, bronze, prata e ouro.",
    rarity: true,
  },
  {
    icon: CrumpleIcon,
    title: "Crumple",
    description:
      "Crumple avulsos da Copa 2026 para fechar o álbum sem depender da sorte do pacote.",
  },
  {
    icon: PictureFrameIcon,
    title: "Quadros",
    description:
      "Quadros e molduras temáticas para decorar o espaço do colecionador.",
  },
  {
    icon: JerseyIcon,
    title: "Camisetas",
    description:
      "Camisetas do grupo e dos times, tamanhos e modelos variados no leilão.",
  },
  {
    icon: AlbumIcon,
    title: "Álbuns",
    description:
      "Álbuns da Copa 2026, cheios ou em início de coleção, direto do grupo.",
  },
];

const steps = [
  {
    icon: GroupChatIcon,
    title: "Entre no grupo",
    description:
      "É grátis: clique no link, entre no WhatsApp e já acompanha o leilão de hoje.",
  },
  {
    icon: BidPaddleIcon,
    title: "Dê seu lance",
    description:
      "Os lotes saem no grupo com foto e descrição. Quem der o último lance leva.",
  },
  {
    icon: PixQrIcon,
    title: "Pague no Pix",
    description:
      "O QR Code fica no seu painel, com copia e cola. Pagou, confirmou, fim.",
  },
  {
    icon: ParcelIcon,
    title: "Receba em casa",
    description:
      "Envio fixo terça-feira, com etiqueta e rastreio — você acompanha pelo painel.",
  },
];

const panelPerks = [
  "Seus lotes arrematados em um lugar só, com foto e valor",
  "Gere o Pix de tudo que está pendente em 1 clique",
  "Acompanhe o envio, o rastreio e a data da postagem",
  "Acesso pelo seu WhatsApp e a senha do seu convite",
];

export default function LandingPage() {
  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 md:px-6">
          <Link href="/">
            <Logo />
          </Link>
          <nav className="ml-auto hidden items-center gap-1 md:flex">
            <Button variant="ghost" size="sm" asChild>
              <Link href="#itens">O que leiloamos</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="#como-funciona">Como funciona</Link>
            </Button>
          </nav>
          <div className="ml-auto flex items-center gap-2 md:ml-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/painel/login">Área do cliente</Link>
            </Button>
            <Button size="sm" asChild>
              <a href={GROUP_URL} target="_blank" rel="noopener noreferrer" aria-label="Entrar no grupo do leilão">
                <MessageCircleIcon />
                <span className="hidden sm:inline">Entrar no grupo</span>
              </a>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 md:px-6">
        {/* Hero */}
        <section className="flex flex-col items-center gap-6 py-16 text-center md:py-24">
          <div className="flex flex-col items-center gap-2">
            <Image
              src="/brand/app-emblem.webp"
              alt="Escudo preto e dourado de Os Caras das Legends"
              width={384}
              height={384}
              className="h-40 w-40 object-contain"
            />
            <p className="text-center text-2xl font-black uppercase leading-tight tracking-wide sm:text-3xl">
              <span className="block text-ouro-ink">Os Caras</span>
              <span className="block">das Legends</span>
            </p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground">
            Leilão diário · Legends da Copa 2026
          </span>
          <h1 className="max-w-3xl text-balance text-4xl font-bold tracking-tight md:text-5xl">
            Todo dia tem leilão de Legend na Copa 2026
          </h1>
          <p className="max-w-2xl text-balance text-muted-foreground md:text-lg">
            Legends, Crumple, quadros, camisetas e álbuns — lance no grupo do
            WhatsApp, pague no Pix e receba em casa com rastreio. Envio fixo
            terça-feira.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" asChild>
              <a href={GROUP_URL} target="_blank" rel="noopener noreferrer">
                <MessageCircleIcon />
                Entrar no grupo do leilão
                <ArrowRightIcon />
              </a>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/painel/login">Acessar meu painel</Link>
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            {rarities.map((rarity) => (
              <span key={rarity.label} className="flex items-center gap-1.5">
                <Image
                  src={rarity.seal}
                  alt=""
                  width={16}
                  height={16}
                  className="size-4"
                />
                {rarity.label}
              </span>
            ))}
          </div>
        </section>

        {/* Faixa de números */}
        <section className="grid gap-4 pb-16 sm:grid-cols-2 lg:grid-cols-4 md:pb-20">
          {[
            { icon: BidPaddleIcon, title: "Todo dia", description: "Leilão no grupo" },
            {
              icon: StickerStarIcon,
              title: "80 Legends",
              description: "4 raridades · 20 jogadores",
            },
            { icon: CalendarClockIcon, title: "Envio fixo", description: "terça-feira · com rastreio" },
            { icon: CoinsIcon, title: "Pix", description: "QR Code no painel" },
          ].map((stat) => (
            <Card key={stat.title}>
              <CardHeader className="pb-3">
                <span className="flex size-9 items-center justify-center rounded-md border bg-muted">
                  <stat.icon className="size-4" />
                </span>
                <CardTitle className="text-base">{stat.title}</CardTitle>
                <CardDescription>{stat.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </section>

        {/* O que leiloamos */}
        <section id="itens" className="scroll-mt-20 pb-16 md:pb-20">
          <div className="mb-6 flex flex-col gap-1">
            <h2 className="text-2xl font-semibold tracking-tight">
              O que sai no leilão
            </h2>
            <p className="text-sm text-muted-foreground">
              Do grupo para a sua coleção — item por item, com foto de verdade.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <Card key={item.title}>
                <CardHeader className="pb-3">
                  <span className="flex size-9 items-center justify-center rounded-md border bg-muted">
                    <item.icon className="size-4" />
                  </span>
                  <CardTitle className="text-base">{item.title}</CardTitle>
                  <CardDescription>{item.description}</CardDescription>
                </CardHeader>
                {item.rarity && (
                  <CardContent className="flex flex-wrap gap-x-4 gap-y-1 pt-0">
                    {rarities.map((rarity) => (
                      <span
                        key={rarity.label}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground"
                      >
                        <Image
                          src={rarity.seal}
                          alt=""
                          width={14}
                          height={14}
                          className="size-3.5"
                        />
                        {rarity.label}
                      </span>
                    ))}
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        </section>

        {/* Como funciona */}
        <section id="como-funciona" className="scroll-mt-20 pb-16 md:pb-20">
          <div className="mb-6 flex flex-col gap-1">
            <h2 className="text-2xl font-semibold tracking-tight">
              Como funciona
            </h2>
            <p className="text-sm text-muted-foreground">
              Do grupo ao seu álbum em 4 passos.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => (
              <Card key={step.title}>
                <CardHeader className="pb-3">
                  <span className="flex size-9 items-center justify-center rounded-md border bg-muted">
                    <step.icon className="size-4" />
                  </span>
                  <CardTitle className="text-base">
                    <span className="text-muted-foreground tabular-nums">
                      {String(index + 1).padStart(2, "0")}
                    </span>{" "}
                    {step.title}
                  </CardTitle>
                  <CardDescription>{step.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>

        {/* Painel do cliente */}
        <section className="pb-16 md:pb-20">
          <Card>
            <div className="grid gap-6 p-6 md:grid-cols-2 md:p-8">
              <div className="flex flex-col gap-3">
                <span className="inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground">
                  Área do cliente
                </span>
                <h2 className="text-2xl font-semibold tracking-tight">
                  Seu painel no celular
                </h2>
                <p className="text-sm text-muted-foreground">
                  Você arremata no grupo e acompanha tudo aqui: lotes, Pix e
                  envio — sem procurar mensagem antiga no zap.
                </p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <Button asChild>
                    <Link href="/painel/login">
                      Acessar meu painel
                      <ArrowRightIcon />
                    </Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <a href={GROUP_URL} target="_blank" rel="noopener noreferrer">
                      Entrar no grupo
                    </a>
                  </Button>
                </div>
              </div>
              <ul className="flex flex-col gap-3">
                {panelPerks.map((perk) => (
                  <li
                    key={perk}
                    className="flex items-start gap-3 rounded-md border p-3 text-sm"
                  >
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-muted-foreground">
                      <StickerStarIcon className="size-3" />
                    </span>
                    {perk}
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </section>

        {/* CTA final */}
        <section className="pb-16 md:pb-24">
          <Card className="border-primary/30 bg-muted/40">
            <CardContent className="flex flex-col items-center gap-4 p-8 text-center md:p-12">
              <h2 className="text-balance text-2xl font-semibold tracking-tight md:text-3xl">
                Bora pro leilão de hoje?
              </h2>
              <p className="max-w-xl text-balance text-sm text-muted-foreground md:text-base">
                Entre no grupo, acompanhe os lotes e dê seu lance. Se já é
                cliente, seu painel espera por você.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Button size="lg" asChild>
                  <a href={GROUP_URL} target="_blank" rel="noopener noreferrer">
                    <MessageCircleIcon />
                    Entrar no grupo do leilão
                  </a>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="/painel/login">Área do cliente</Link>
                </Button>
              </div>
              <a
                href={INSTAGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                <AtSignIcon className="size-4" />
                oscarasdaslegends no Instagram
              </a>
            </CardContent>
          </Card>
        </section>
      </main>

      <footer className="border-t py-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 text-sm text-muted-foreground sm:flex-row md:px-6">
          <span>Os Caras das Legends · Leilão de Legends da Copa 2026</span>
          <nav className="flex items-center gap-4">
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground"
            >
              Instagram
            </a>
            <Link href="/painel/login" className="hover:text-foreground">
              Área do cliente
            </Link>
            <Link href="/login" className="hover:text-foreground">
              Painel interno
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
