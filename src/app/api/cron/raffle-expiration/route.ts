import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { reconcileRafflePayments } from "@/lib/raffles-server";

export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const received = request.headers.get("authorization") ?? "";
  const timestamp = request.headers.get("x-raffle-cron-time");
  if (!secret) return Response.json({ error: "unauthorized" }, { status: 401 });
  let expected = `Bearer ${secret}`;
  if (timestamp !== null) {
    if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 90) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    expected = `Bearer ${createHmac("sha256", secret).update(`raffle-expiration:${timestamp}`).digest("hex")}`;
  }
  if (!timingSafeEqual(createHash("sha256").update(expected).digest(), createHash("sha256").update(received).digest())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await reconcileRafflePayments(45000);
    revalidatePath("/painel/rifas", "layout");
    revalidatePath("/admin/rifa", "layout");
    return Response.json(result, { status: result.failed ? 503 : 200 });
  } catch { return Response.json({ error: "reconciliation_unavailable" }, { status: 503 }); }
}
