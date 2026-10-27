import { cn } from "@/lib/utils";
import Image from "next/image";

/** Brasão completo para espaços compactos. */
export function LogoMark({ className }: { className?: string }) {
  return <Image src="/brand/crest-v2.webp" alt="" aria-hidden="true" width={434} height={512} className={cn("size-10 object-contain", className)} />;
}

/** Marca compacta com texto nítido em ambos os temas. */
export function Logo({ className }: { className?: string }) {
  return <span className={cn("inline-flex max-w-full items-center gap-2", className)}>
    <LogoMark className="h-12 w-10 shrink-0" />
    <span className="text-[11px] font-extrabold uppercase leading-tight tracking-wide text-foreground sm:text-xs">
      <span className="block whitespace-nowrap">Os Caras</span>
      <span className="block whitespace-nowrap">das Legends</span>
    </span>
  </span>;
}
