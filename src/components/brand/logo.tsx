import { cn } from "@/lib/utils";
import Image from "next/image";

/** Brasão completo para espaços compactos. */
export function LogoMark({ className }: { className?: string }) {
  return <Image src="/brand/crest-v2.webp" alt="" aria-hidden="true" width={434} height={512} className={cn("size-10 object-contain", className)} />;
}

/** Fundo escuro mantém o nome branco legível nos dois temas. */
export function Logo({ className }: { className?: string }) {
  return <span className={cn("inline-flex w-44 max-w-full shrink-0 items-center rounded-lg bg-[#0a0a0a] px-2 py-1", className)}>
    <Image src="/brand/logo-horizontal-v2.webp" alt="Os Caras das Legends" width={1400} height={700} className="h-auto w-full object-contain" />
  </span>;
}
