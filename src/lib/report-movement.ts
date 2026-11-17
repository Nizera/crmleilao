import type { SeparationCustomer } from "./reports-server";

export type ReportMovementFilter = "all" | "moved" | "unmoved";

/** Dispatch prevents a second separation, but never invents a movement date. */
export function reportItemMoved(movedAt: string | null | undefined, dispatched = false): boolean {
  return Boolean(movedAt) || dispatched;
}

export function filterReportMovement(customers: SeparationCustomer[], date: string, filter: ReportMovementFilter, customerId = "all") {
  const seen = new Set<string>();
  const keep = (kind: string, id: string, day: string | undefined, movedAt: string | null | undefined, dispatched = false) => {
    const key = `${kind}:${id}`;
    if (seen.has(key) || (date !== "all" && day !== date)) return false;
    const moved = reportItemMoved(movedAt, dispatched);
    if ((filter === "moved" && !moved) || (filter === "unmoved" && moved)) return false;
    seen.add(key);
    return true;
  };
  return customers.filter(customer => customerId === "all" || customer.customerId === customerId).map(customer => ({ ...customer,
    lots: customer.lots.filter(item => keep("lot", item.id, item.shippingDate, item.movedAt, item.dispatched)),
    logisticsPending: (customer.logisticsPending ?? []).filter(item => keep("issue", item.id, item.shippingDate, item.moved_at, item.dispatched)),
    storeOrders: (customer.storeOrders ?? []).filter(item => keep("store", item.id, item.shippingDate, item.boxed_at, item.dispatched)),
  })).filter(customer => customer.lots.length || customer.logisticsPending.length || customer.storeOrders.length);
}
