import { Badge } from "@/components/ui/badge";
import { CHARGE_STATUS_LABELS, type ChargeStatus } from "@/lib/charges";

const TONE: Record<ChargeStatus, string> = {
  pending: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  in_process: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  approved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  cancelled: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  expired: "border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  rejected: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

export function ChargeStatusBadge({ status }: { status: ChargeStatus }) {
  return (
    <Badge variant="outline" className={TONE[status]}>
      {CHARGE_STATUS_LABELS[status]}
    </Badge>
  );
}
