export type DeclaredItem = { id: string; shipping_declared_value: number | null };
export type LogisticsContentItem = DeclaredItem & { source_kind: string; moved_at: string | null };
export function logisticsDeclaredTotal(items: LogisticsContentItem[]) {
  if (items.some(i => !Number.isFinite(Number(i.shipping_declared_value??0)) || Number(i.shipping_declared_value??0)<0)) throw new Error("Confira o valor declarado dos itens avulsos.");
  return items.reduce((sum, i) => sum + Math.round(Number(i.shipping_declared_value ?? 0) * 100), 0) / 100;
}
export function shipmentContentSnapshot(lots: { id: string; arremate_value: number }[], store: DeclaredItem[], logistics: DeclaredItem[],declaredOverride=0) {
  return {
    ...(declaredOverride>0?{declared_value:declaredOverride}:{}),
    lots: lots.map(i => ({ id: i.id, value: Number(i.arremate_value) })),
    store: store.map(i => ({ id: i.id, value: Number(i.shipping_declared_value) })),
    logistics: logistics.map(i => ({ id: i.id, value: Number(i.shipping_declared_value ?? 0) })),
  };
}
