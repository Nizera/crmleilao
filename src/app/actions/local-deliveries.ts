"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { getShipmentById } from "@/lib/shipments-server";
import type { Shipment } from "@/lib/shipments";
import { rethrowIfRedirect, type ActionResult } from "@/lib/result";

const item = z.object({ id: z.uuid(), value: z.number().finite().min(0).nullable() });
const schema = z.object({ customerId: z.uuid(), day: z.iso.date(), requestId: z.uuid(), note: z.string().trim().max(500),
  expected: z.object({ lots: z.array(item).max(500), store: z.array(item).max(500), logistics: z.array(item).max(500) }).strict(),
});
function refresh() {
  updateTag("dashboard");
  for (const path of ["/admin/envios", "/admin/lotes", "/admin/relatorios", "/admin/pendencias", "/admin/rifa/premios", "/painel", "/painel/envios", "/painel/lotes"]) revalidatePath(path);
}
function errorMessage(code: string, message: string) {
  return code === "P0001" ? message : "Não foi possível atualizar a entrega. Confira se a atualização 0085 foi aplicada.";
}
export async function createLocalDelivery(input: z.infer<typeof schema>): Promise<ActionResult<Shipment>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") return { ok: false, error: "Seu perfil é somente leitura." };
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Confira os itens e a data da entrega." };
    const { customerId, day, requestId, note, expected } = parsed.data;
    const { data, error } = await (await createClient()).rpc("create_local_delivery", { p_customer: customerId, p_day: day, p_expected: expected, p_request: requestId, p_note: note });
    if (error) return { ok: false, error: errorMessage(error.code, error.message) };
    refresh();
    const shipment = await getShipmentById(String(data));
    if (!shipment) return { ok: false, error: "A saída foi registrada. Atualize a lista de envios para consultar." };
    return { ok: true, data: shipment };
  } catch (error) {
    rethrowIfRedirect(error);
    return { ok: false, error: "Não foi possível concluir. Atualize a lista antes de tentar novamente; uma saída já registrada permanece salva." };
  }
}
export async function handleLocalDelivery(id: string, action: "delivered" | "cancel"): Promise<ActionResult<Shipment>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") return { ok: false, error: "Seu perfil é somente leitura." };
    if (!z.uuid().safeParse(id).success || !["delivered", "cancel"].includes(action)) return { ok: false, error: "Ação inválida." };
    const { error } = await (await createClient()).rpc("handle_local_delivery", { p_shipment: id, p_action: action });
    if (error) return { ok: false, error: errorMessage(error.code, error.message) };
    refresh();
    const shipment = await getShipmentById(id);
    if (!shipment) return { ok: false, error: "Entrega atualizada. Recarregue a lista." };
    return { ok: true, data: shipment };
  } catch (error) {
    rethrowIfRedirect(error);
    return { ok: false, error: "Não foi possível atualizar a entrega. Atualize a tela e confira a situação." };
  }
}
