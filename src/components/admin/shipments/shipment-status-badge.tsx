import { Badge } from "@/components/ui/badge";
import {
  SHIPMENT_STATUS_LABELS,
  type ShipmentStatus,
} from "@/lib/shipments";

const TONE: Record<ShipmentStatus, string> = {
  pending: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  released: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  posted: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  delivered:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  cancelled: "border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

export function ShipmentStatusBadge({ status }: { status: ShipmentStatus }) {
  return (
    <Badge variant="outline" className={TONE[status]}>
      {SHIPMENT_STATUS_LABELS[status]}
    </Badge>
  );
}
