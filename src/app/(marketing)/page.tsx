import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  CalendarClock,
  Coins,
  MessageCircle,
  ShieldCheck,
  Trophy,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const features = [
  {
    icon: MessageCircle,
    title: "Aviso pronto no WhatsApp",
    description:
      "Um clique gera a mensagem com lote, valor e o link do painel do cliente — você só aperta enviar.",
  },
  {
    icon: Coins,
    title: "Pix agrupado por cobrança",
    description:
      "Vários lotes pendentes viram uma única cobrança. O pagamento confirma tudo automaticamente.",
  },
  {
    icon: Boxes,
    title: "Estoque que se entende",
    description:
      "“Kit lilas Caicedo, Dias, Modrić e Jude” vira 4 figurinhas baixadas — com revisão antes de gravar.",
  },
  {
    icon: CalendarClock,
    title: "Envios de terça organizados",
    description:
      "Cotação, etiqueta e rastreio de cada pacote, com data de envio visível para o cliente.",
  },
  {
    icon: ShieldCheck,
    title: "Painel do cliente seguro",
    description:
      "Acesso pelo número de WhatsApp com código de 6 dígitos e permissões isoladas por linha.",
  },
  {
    icon: Trophy,
    title: "Feito para o leilão diário",
    description:
      "Cadastrar lote arrematado leva segundos, do jeito que a operação do grupo funciona hoje.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 md:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Trophy className="size-4" />
            </span>
            Caras das Legends
          </Link>
          <nav className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/painel/login">Área do cliente</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/login">Painel interno</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 md:px-6">
        <section className="flex flex-col items-center gap-6 py-16 text-center md:py-24">
          <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground">
            Leilão diário de figurinhas · Copa 2026
          </span>
          <h1 className="max-w-3xl text-balance text-4xl font-bold tracking-tight md:text-5xl">
            O CRM que cuida do leilão enquanto você cuida do grupo
          </h1>
          <p className="max-w-2xl text-balance text-muted-foreground md:text-lg">
            Lotes, arremates, estoque, cobranças em Pix e envios de terça — tudo
            em um painel, com o cliente acompanhando pelo próprio celular.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" asChild>
              <Link href="/login">
                Entrar no painel interno
                <ArrowRight />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/painel/login">Acessar meu painel</Link>
            </Button>
          </div>
        </section>

        <section className="grid gap-4 pb-16 sm:grid-cols-2 lg:grid-cols-3 md:pb-24">
          {features.map((feature) => (
            <Card key={feature.title}>
              <CardHeader className="pb-3">
                <span className="flex size-9 items-center justify-center rounded-md border bg-muted">
                  <feature.icon className="size-4" />
                </span>
                <CardTitle className="text-base">{feature.title}</CardTitle>
                <CardDescription>{feature.description}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          ))}
        </section>
      </main>

      <footer className="border-t py-6 text-center text-sm text-muted-foreground">
        Caras das Legends · Grupo de leilão de figurinhas da Copa 2026
      </footer>
    </div>
  );
}
