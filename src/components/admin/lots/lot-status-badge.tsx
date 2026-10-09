import { Badge } from "@/components/ui/badge";
import { LOT_STATUS_LABELS, type LotStatus } from "@/lib/lots";

const TONE: Record<LotStatus, string> = {
  pending_payment: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  paid: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  shipped: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  delivered: "border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  cancelled: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
};

export function LotStatusBadge({ status }: { status: LotStatus }) {
  return (
    <Badge variant="outline" className={TONE[status]}>
      {LOT_STATUS_LABELS[status]}
    </Badge>
  );
}
