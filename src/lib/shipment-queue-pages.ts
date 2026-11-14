/** Lê em blocos internos; a interface continua mostrando uma única lista. */
export async function collectShipmentQueueRows<T>(
  readPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  all: boolean,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await readPage(from, from + 499);
    if (error) throw new Error(`Falha ao carregar a fila de envios: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < 500 || (!all && rows.length > 1000)) break;
  }
  return rows;
}
