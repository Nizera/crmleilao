import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Consultas paginadas e em blocos para não estourar a URL do PostgREST. */
export async function fetchScopeRows<T>(
  db: ReturnType<typeof createAdminClient>, table: string, column: string,
  ids: string[], select: string, order: string[] = ["id"],
): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows: T[] = [];
  const unique = [...new Set(ids)];
  for (let index = 0; index < unique.length; index += 100) {
    for (let offset = 0; ; offset += 500) {
      let query = db.from(table).select(select).in(column, unique.slice(index, index + 100));
      for (const key of order) query = query.order(key, { ascending: true });
      const { data, error } = await query.range(offset, offset + 499);
      if (error) return { data: [], error };
      const page = (data ?? []) as unknown as T[];
      rows.push(...page);
      if (page.length < 500) break;
    }
  }
  return { data: rows, error: null };
}
