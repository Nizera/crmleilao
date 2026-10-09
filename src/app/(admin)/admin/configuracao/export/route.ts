import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/lots";

/** Escapa campo CSV (separador “;”, aspas duplas, UTF-8 com BOM no arquivo). */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csv(header: string[], rows: unknown[][]): string {
  const body = [header, ...rows].map((row) => row.map(cell).join(";"));
  return `\uFEFF${body.join("\r\n")}`;
}

function download(body: string, name: string): Response {
  return new Response(body, {
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
      const { data, error } = await supabase
        .from("customers")
        .select(
          "id, name, phone_e164, email, cpf_cnpj, address_cep, address_street, address_number, address_complement, address_district, address_city, address_state, created_at, updated_at",
        )
        .order("name", { ascending: true, nullsFirst: false });

      if (error) {
        return new Response(`Falha ao consultar clientes: ${error.message}`, {
          status: 500,
        });
      }

      return download(
        csv(
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
          (data ?? []).map((row) => [
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
          ]),
        ),
        `clientes-${stamp}.csv`,
      );
    }

    if (tipo === "lotes") {
      const { data, error } = await supabase
        .from("lots")
        .select(
          "code, title, arremate_value, status, auction_date, shipping_date, paid_at, shipped_at, created_at, customer:customers(name, phone_e164)",
        )
        .order("auction_date", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) {
        return new Response(`Falha ao consultar lotes: ${error.message}`, {
          status: 500,
        });
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

      return download(
        csv(
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
          rows,
        ),
        `lotes-${stamp}.csv`,
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
