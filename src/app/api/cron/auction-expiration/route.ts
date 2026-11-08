import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { reconcileAuctionDeadlines } from "@/lib/auction-expiration-server";

export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const received = request.headers.get("authorization") ?? "";
  const timestamp = request.headers.get("x-auction-cron-time");
  if (!secret) return Response.json({ error: "unauthorized" }, { status: 401 });
  let expected = `Bearer ${secret}`;
  if (timestamp !== null) {
    if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 90) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    expected = `Bearer ${createHmac("sha256", secret).update(`auction-expiration:${timestamp}`).digest("hex")}`;
  }
  if (!timingSafeEqual(createHash("sha256").update(expected).digest(), createHash("sha256").update(received).digest())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await reconcileAuctionDeadlines(45000);
    if(result.cancelled>0 || result.notifications>0){
    revalidateTag("dashboard",{expire:0});
    revalidatePath("/painel", "layout");
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/lotes");
    revalidatePath("/admin/envios");

    }
    return Response.json(result, { status: result.failed ? 503 : 200 });
  } catch { return Response.json({ error: "reconciliation_unavailable" }, { status: 503 }); }
}
