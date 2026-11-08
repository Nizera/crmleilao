/** Detecta novas conquistas e mudanças logísticas sem enviar fotos ou nomes. */
export function raffleAwardsSignature(rows: {id:string;order_status?:string;cancelled_at?:string|null;moved_at?:string|null;shipment_id?:string|null;shipment_status?:string|null;tracking_code?:string|null}[]) {
 return JSON.stringify(rows.map(row=>[row.id,row.order_status??null,row.cancelled_at??null,row.moved_at??null,row.shipment_id??null,row.shipment_status??null,row.tracking_code??null]));
}
