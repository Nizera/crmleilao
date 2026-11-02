"use client";
import { useCallback, useSyncExternalStore } from "react";
import { isPaymentExpired } from "@/lib/payment-ui";
const serverSnapshot = () => false;
export function usePaymentExpired(expiresAt: string | null) {
  const snapshot = useCallback(() => isPaymentExpired(expiresAt, Date.now()), [expiresAt]);
  const subscribe = useCallback((notify: () => void) => {
    const deadline = expiresAt ? Date.parse(expiresAt) : NaN;
    if (!Number.isFinite(deadline)) return () => {};
    const timer = setInterval(notify, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
