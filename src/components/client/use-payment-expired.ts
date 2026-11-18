"use client";
import { useCallback, useSyncExternalStore } from "react";
import { isPaymentExpired } from "@/lib/payment-ui";
const serverSnapshot = () => false;
export function usePaymentExpired(expiresAt: string | null) {
  const snapshot = useCallback(() => isPaymentExpired(expiresAt, Date.now()), [expiresAt]);
  const subscribe = useCallback((notify: () => void) => {
    const deadline = expiresAt ? Date.parse(expiresAt) : NaN;
    if (!Number.isFinite(deadline)) return () => {};
    let timer:ReturnType<typeof setTimeout>|undefined;
    const schedule=()=>{
      const remaining=deadline-Date.now();
      if(remaining<=0)return;
      timer=setTimeout(()=>{notify();schedule();},Math.min(remaining,2147483647));
    };
    const resume=()=>{if(document.visibilityState==='hidden')return;notify();clearTimeout(timer);schedule();};
    schedule();document.addEventListener('visibilitychange',resume);
    return ()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',resume);};
  }, [expiresAt]);
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
