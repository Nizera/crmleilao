import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { sendAuctionInviteEmail } from "@/lib/auction-invite-email";
import { requireAdmin } from "@/lib/dal";
import { LANDING_GROUP_URL } from "@/lib/landing-content";
import { createAdminClient } from "@/lib/supabase/admin";

const path = "/admin/leads";
const pageSize = 25;
const stages = {
  new: "Novo cadastro",
  contacted: "Contatado",
  joined: "Entrou no grupo",
  converted: "Virou cliente",
  closed: "Encerrado",
} as const;
const stageSchema = z.enum(["new", "contacted", "joined", "converted", "closed"]);
const emailLabels: Record<string, string> = {
  pending: "Pendente",
  sending: "Em envio",
  accepted: "Aceito pelo serviço de e-mail",
  failed: "Falha no envio",
  unconfigured: "Envio não configurado",
};
const date = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo",
});
const field = "min-h-10 rounded-lg border bg-background px-3 text-sm";

async function manageLead(data: FormData) {
  "use server";
  const { profile } = await requireAdmin();
  if (profile.role === "viewer") return;
  const id = z.uuid().safeParse(data.get("id"));
  if (!id.success) return;
  const intent = data.get("intent");
  let success: boolean;
  if (intent === "retry-email") {
    success = await sendAuctionInviteEmail(id.data);
  } else {
    const stage = stageSchema.safeParse(data.get("status"));
    if (!stage.success) return;
    const { data: updated, error } = await createAdminClient().from("auction_preregistrations")
      .update({ status: stage.data, status_updated_at: new Date().toISOString(), status_updated_by: profile.id })
      .eq("id", id.data).select("id").maybeSingle();
    success = Boolean(updated && !error);
  }
  const params = filters({
    q: String(data.get("q") ?? ""),
    status: String(data.get("filterStatus") ?? ""),
    page: String(data.get("page") ?? ""),
  });
  revalidatePath(path);
  redirect(listUrl(params, params.page, success ? "saved" : "error"));
}

function filters(params: { q?: string; status?: string; page?: string }) {
  const status = stageSchema.safeParse(params.status);
  return {
    q: typeof params.q === "string" ? params.q.trim().slice(0, 100) : "",
    status: status.success ? status.data : "",
    page: Math.min(10000, Math.max(1, Math.trunc(Number(params.page)) || 1)),
  };
}

function listUrl(params: ReturnType<typeof filters>, page: number, result?: string) {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.status) search.set("status", params.status);
  if (page > 1) search.set("page", String(page));
  if (result) search.set("result", result);
  return search.size ? `${path}?${search}` : path;
}

export const metadata = { title: "Leads do leilão" };
export const instant = false;

export default async function AuctionLeadsPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; status?: string; page?: string; result?: string }> }) {
  const [{ profile }, params] = await Promise.all([requireAdmin(), searchParams]);
  const filter = filters(params);
  const offset = (filter.page - 1) * pageSize;
  let query = createAdminClient().from("auction_preregistrations")
    .select("id,name,phone_e164,email,created_at,attribution,status,status_updated_at,email_status,email_attempted_at", { count: "exact" })
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range(offset, offset + pageSize - 1);
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.q) {
    const digits = filter.q.replace(/\D/g, "");
    const value = filter.q.replace(/[\\%_]/g, match => `\\${match}`);
    query = digits && /^[+\d ().-]+$/.test(filter.q) ? query.ilike("phone_e164", `%${digits}%`)
      : query.ilike(filter.q.includes("@") ? "email" : "name", `%${value}%`);
  }
  const { data, count, error } = await query;
  const phones = data?.map(lead => lead.phone_e164) ?? [];
  const customers = phones.length
    ? await createAdminClient().from("customers").select("id,phone_e164").in("phone_e164", phones)
    : { data: [], error: null };
  const customerByPhone = new Map(customers.data?.map(customer => [customer.phone_e164, customer.id]));
  const canWrite = profile.role !== "viewer";
  return <main className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 p-4 md:p-8">
    <header>
      <h1 className="text-2xl font-semibold">Leads do leilão</h1>
      <p className="text-sm text-muted-foreground">Confira a fila do WhatsApp e atualize aqui quem entrou no grupo.</p>
    </header>
    <form action={path} className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
      <label className="grid gap-1 text-sm">Buscar lead
        <input name="q" defaultValue={filter.q} placeholder="Nome, WhatsApp ou e-mail" className={field} />
      </label>
      <label className="grid gap-1 text-sm">Situação
        <select name="status" defaultValue={filter.status} className={field}>
          <option value="">Todas</option>
          {Object.entries(stages).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <Button type="submit">Filtrar</Button>
    </form>
    {params.result === "saved" && <p role="status">Alteração registrada.</p>}
    {params.result === "error" && <p role="alert">A ação não foi concluída. Confira a situação do lead e tente novamente.</p>}
    {error ? <p role="alert">Não foi possível carregar os leads. Confira se a migração foi aplicada.</p> : <>
      <p className="text-sm text-muted-foreground">{count ?? 0} cadastro(s) com esses filtros</p>
      {customers.error && <p role="alert">Não foi possível conferir os clientes existentes.</p>}
      <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
        <Table className="min-w-[820px]">
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead scope="col" className="pl-4">Cadastro</TableHead>
              <TableHead scope="col">Lead</TableHead>
              <TableHead scope="col">Origem</TableHead>
              <TableHead scope="col">Situação</TableHead>
              {canWrite && <TableHead scope="col">Ações</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data?.length && <TableRow>
              <TableCell colSpan={canWrite ? 5 : 4} className="h-20 text-center text-muted-foreground">
                Nenhum cadastro encontrado.
              </TableCell>
            </TableRow>}
            {data?.map(lead => {
              const status = stageSchema.parse(lead.status);
              const customerId = customerByPhone.get(lead.phone_e164);
              const campaign = [lead.attribution?.utm_source, lead.attribution?.utm_campaign, lead.attribution?.utm_content].filter(Boolean).join(" · ");
              const message = `Oi, ${lead.name.split(" ")[0]}! Aqui é a equipe dos Caras das Legends. Você conseguiu solicitar entrada no grupo do leilão? Se precisar, aqui está o convite: ${LANDING_GROUP_URL}`;
              const messageUrl = `https://wa.me/${lead.phone_e164.slice(1)}?text=${encodeURIComponent(message)}`;
              return <TableRow key={lead.id}>
                <TableCell className="py-3 pl-4 tabular-nums">
                  <time dateTime={lead.created_at}>{date.format(new Date(lead.created_at))}</time>
                </TableCell>
                <TableCell className="max-w-64 whitespace-normal [overflow-wrap:anywhere]">
                  <p className="font-semibold">{lead.name}</p>
                  <p className="text-muted-foreground">{lead.phone_e164}</p>
                  {customerId && <Link href={`/admin/clientes/${customerId}`} className="text-xs font-medium underline">
                    Cliente já cadastrado
                  </Link>}
                  {lead.email && <>
                    <p className="text-muted-foreground">{lead.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {emailLabels[lead.email_status] ?? "Pendente"}
                      {lead.email_attempted_at && ` · ${date.format(new Date(lead.email_attempted_at))}`}
                    </p>
                  </>}
                </TableCell>
                <TableCell className="max-w-48 whitespace-normal text-muted-foreground [overflow-wrap:anywhere]">
                  {campaign || "—"}
                </TableCell>
                <TableCell>
                  <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium">{stages[status]}</span>
                  {lead.status_updated_at && <p className="mt-1 text-xs text-muted-foreground">
                    Atualizada em {date.format(new Date(lead.status_updated_at))}
                  </p>}
                </TableCell>
                {canWrite && <TableCell className="py-3 pr-4">
                  <form action={manageLead} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={lead.id} />
                    <input type="hidden" name="q" value={filter.q} />
                    <input type="hidden" name="filterStatus" value={filter.status} />
                    <input type="hidden" name="page" value={filter.page} />
                    <select name="status" defaultValue={status} aria-label={`Atualizar situação de ${lead.name}`} className="h-8 rounded-lg border bg-background px-2 text-xs">
                      {Object.entries(stages).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <Button size="sm" type="submit" name="intent" value="status" variant="outline">Salvar</Button>
                    {lead.email && lead.email_status !== "accepted" && <Button size="sm" type="submit" name="intent" value="retry-email" variant="outline">Tentar envio do e-mail</Button>}
                  </form>
                  {(status === "new" || status === "contacted") &&
                    <a href={messageUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-medium underline">Abrir mensagem no WhatsApp</a>}
                </TableCell>}
              </TableRow>;
            })}
          </TableBody>
        </Table>
      </div>
      <nav aria-label="Paginação dos leads" className="flex gap-4 text-sm">
        {filter.page > 1 && <Link href={listUrl(filter, filter.page - 1)} className="underline">Anterior</Link>}
        {offset + pageSize < (count ?? 0) && <Link href={listUrl(filter, filter.page + 1)} className="underline">Próxima</Link>}
      </nav>
    </>}
  </main>;
}
