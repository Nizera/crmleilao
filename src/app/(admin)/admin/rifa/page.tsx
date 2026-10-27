import { Ticket } from "lucide-react";

export const metadata = { title: "Rifa — em breve" };

export default function RafflePage() {
  return <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">
    <header><p className="text-sm text-muted-foreground">Rifa</p><h1 className="mt-1 text-2xl font-bold">Em breve</h1></header>
    <section className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center sm:p-12">
      <Ticket className="size-10 text-ouro-ink" aria-hidden="true" />
      <h2 className="text-lg font-semibold">Um espaço exclusivo para rifas</h2>
      <p className="max-w-md text-sm text-muted-foreground">Esta seção ainda está em preparação. Quando estiver disponível, você poderá gerenciar as rifas por aqui.</p>
    </section>
  </main>;
}
