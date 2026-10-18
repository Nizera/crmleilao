import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Observações internas da equipe (migração 0012).
 *
 * Antes moravam em `customers.notes` / `lots.notes` — colunas que o próprio
 * cliente conseguia ler pela RLS (linha inteira). Agora ficam numa tabela com
 * policy `is_admin()`, então o cliente nem vê as linhas.
 */
export type NoteTarget = "customer" | "lot";

/**
 * Grava a observação de uma entidade. Corpo vazio apaga a linha, para que o
 * formulário possa limpar o campo.
 *
 * Lança em caso de erro: quem chama decide se a operação inteira falha.
 */
export async function saveNote(
  target: NoteTarget,
  id: string,
  body: string,
  by?: string | null,
): Promise<void> {
  const value = body.trim();
  const supabase = await createClient();

  if (!value) {
    const { error } = await supabase
      .from("internal_notes")
      .delete()
      .eq("entity_type", target)
      .eq("entity_id", id);
    if (error) throw new Error(`Falha ao limpar observação: ${error.message}`);
    return;
  }

  const { error } = await supabase.from("internal_notes").upsert(
    {
      entity_type: target,
      entity_id: id,
      body: value,
      created_by: by ?? null,
    },
    { onConflict: "entity_type,entity_id" },
  );

  if (error) throw new Error(`Falha ao salvar observação: ${error.message}`);
}

/**
 * Carrega as observações de um lote de entidades de uma vez.
 * Devolve o mapa `id -> body`; quem não tem observação não entra no mapa.
 */
export async function loadNotes(
  target: NoteTarget,
  ids: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const supabase = await createClient();

  // `.in()` monta a lista na query string: com centenas de ids a URL passa do
  // limite do PostgREST/edge e a tela inteira falha. Pedacos de 200 cabem
  // com folga (200 uuids ≈ 7,4 KB).
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 200) {
    chunks.push(unique.slice(i, i + 200));
  }

  const results = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from("internal_notes")
        .select("entity_id, body")
        .eq("entity_type", target)
        .in("entity_id", chunk),
    ),
  );

  const map = new Map<string, string>();
  for (const result of results) {
    if (result.error) {
      throw new Error(`Falha ao carregar observações: ${result.error.message}`);
    }
    for (const row of (result.data ?? []) as { entity_id: string; body: string | null }[]) {
      map.set(row.entity_id, row.body ?? "");
    }
  }
  return map;
}

/** Remove as observações de uma entidade (ex.: cliente excluído). */
export async function deleteNotes(target: NoteTarget, id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("internal_notes")
    .delete()
    .eq("entity_type", target)
    .eq("entity_id", id);
  if (error) throw new Error(`Falha ao remover observações: ${error.message}`);
}
