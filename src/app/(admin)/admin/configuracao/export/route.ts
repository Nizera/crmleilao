import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/lots";

/** Escapa campo CSV (separador “;”, aspas duplas, UTF-8 com BOM no arquivo). */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/** Linhas por consulta: abaixo do `max-rows` do PostgREST (1000 padrão). */
const PAGE_SIZE = 500;

type PageResult = { rows: unknown[][]; size: number };

/**
 * Exporta o CSV em streaming, página a página.
 *
 * Antes tudo era lido de uma vez e montado em memória antes da resposta — com
 * as tabelas crescendo, era o único caminho que conseguia derrubar a função
 * por OOM. Agora só uma página de 500 linhas existe na RAM por vez.
 */
function streamCsv(
  header: string[],
  name: string,
  fetchPage: (from: number, to: number) => Promise<PageResult>,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(
          encoder.encode(`\uFEFF${header.map(cell).join(";")}\r\n`),
        );
        for (let from = 0; ; from += PAGE_SIZE) {
          const { rows, size } = await fetchPage(from, from + PAGE_SIZE - 1);
          if (rows.length > 0) {
            const body = rows.map((row) => row.map(cell).join(";")).join("\r\n");
            controller.enqueue(encoder.encode(`${body}\r\n`));
          }
          if (size < PAGE_SIZE) break;
        }
        controller.close();
      } catch (error) {
        console.error("[export] streaming interrompido:", error);
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  // Fora do try/catch: o redirect do guard tem que propagar.
  const { profile } = await requireAdmin();
  if (profile.role !== "owner") {
    return new Response("Apenas o dono exporta os dados.", { status: 403 });
  }

  const tipo = new URL(request.url).searchParams.get("tipo") ?? "clientes";

  try {
    const supabase = await createClient();
    const stamp = todayISO();

    if (tipo === "clientes") {
      return streamCsv(
        [
          "id",
          "nome",
          "whatsapp",
          "email",
          "cpf_cnpj",
          "cep",
          "rua",
          "numero",
          "complemento",
          "bairro",
          "cidade",
          "uf",
          "criado_em",
          "atualizado_em",
        ],
        `clientes-${stamp}.csv`,
        async (from, to) => {
          const { data, error } = await supabase
            .from("customers")
            .select(
              "id, name, phone_e164, email, cpf_cnpj, address_cep, address_street, address_number, address_complement, address_district, address_city, address_state, created_at, updated_at",
            )
            .order("name", { ascending: true, nullsFirst: false })
            // Desempate: sem ele, nomes iguais trocam de posição entre páginas
            // e o CSV perde (ou repete) linhas.
            .order("id")
            .range(from, to);

          if (error) {
            throw new Error(`Falha ao consultar clientes: ${error.message}`);
          }

          const rows = (data ?? []).map((row) => [
            row.id,
            row.name,
            row.phone_e164,
            row.email,
            row.cpf_cnpj,
            row.address_cep,
            row.address_street,
            row.address_number,
            row.address_complement,
            row.address_district,
            row.address_city,
            row.address_state,
            row.created_at,
            row.updated_at,
          ]);
          return { rows, size: rows.length };
        },
      );
    }

    if (tipo === "lotes") {
      return streamCsv(
        [
          "codigo",
          "titulo",
          "arremate",
          "status",
          "data_leilao",
          "data_envio",
          "pago_em",
          "enviado_em",
          "criado_em",
          "cliente",
          "whatsapp",
        ],
        `lotes-${stamp}.csv`,
        async (from, to) => {
          const { data, error } = await supabase
            .from("lots")
            .select(
              "code, title, arremate_value, status, auction_date, shipping_date, paid_at, shipped_at, created_at, customer:customers(name, phone_e164)",
            )
            .order("auction_date", { ascending: false })
            .order("created_at", { ascending: false })
            .order("id")
            .range(from, to);

          if (error) {
            throw new Error(`Falha ao consultar lotes: ${error.message}`);
          }

          const rows = (data ?? []).map((row) => {
            const embedded = row.customer as unknown;
            const customer = (
              Array.isArray(embedded) ? embedded[0] : embedded
            ) as { name: string | null; phone_e164: string } | null;
            return [
              row.code,
              row.title,
              row.arremate_value,
              row.status,
              row.auction_date,
              row.shipping_date,
              row.paid_at,
              row.shipped_at,
              row.created_at,
              customer?.name ?? "",
              customer?.phone_e164 ?? "",
            ];
          });
          return { rows, size: rows.length };
        },
      );
    }

    return new Response("Tipo inválido: use ?tipo=clientes ou ?tipo=lotes.", {
      status: 400,
    });
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : "Erro inesperado.",
      { status: 500 },
    );
  }
}
