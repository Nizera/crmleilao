import { createHash, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { reconcileRafflePayments } from "@/lib/raffles-server";

export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const received = request.headers.get("authorization") ?? "";
  if (!secret || !timingSafeEqual(createHash("sha256").update(`Bearer ${secret}`).digest(), createHash("sha256").update(received).digest())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await reconcileRafflePayments(45000);
    revalidatePath("/painel/rifas", "layout");
    revalidatePath("/admin/rifa", "layout");
    return Response.json(result, { status: result.failed ? 503 : 200 });
  } catch { return Response.json({ error: "reconciliation_unavailable" }, { status: 503 }); }
}
