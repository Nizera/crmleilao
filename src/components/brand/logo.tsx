import { cn } from "@/lib/utils";
import Image from "next/image";

/** Escudo original da marca: colecionáveis, futebol e conquista. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/app-emblem.webp"
      alt=""
      aria-hidden="true"
      width={384}
      height={384}
      className={cn("size-4 object-contain", className)}
    />
  );
}

type LogoProps = {
  className?: string;
  /** Nome exibido ao lado do tile. */
  name?: React.ReactNode;
  nameClassName?: string;
  /** Classe do tile (tamanho/raio). Padrão: size-7 rounded-lg. */
  tileClassName?: string;
  /** Classe do glifo dentro do tile. Padrão: size-4. */
  markClassName?: string;
  /** Esconde o nome em telas pequenas (< sm). */
  hideNameOnMobile?: boolean;
};

/**
 * Lockup da marca: escudo em tile + nome em texto vivo para manter boa leitura
 * em tamanhos pequenos e permitir que o nome seja localizado/acessível.
 */
export function Logo({
  className,
  name = <><span className="block">Os Caras</span><span className="block">das Legends</span></>,
  nameClassName,
  tileClassName,
  markClassName,
  hideNameOnMobile = false,
}: LogoProps) {
  return (
    <span className={cn("flex items-center gap-2 font-semibold", className)}>
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center",
          tileClassName,
        )}
      >
        <LogoMark className={cn("size-full", markClassName)} />
      </span>
      <span
        className={cn(
          "text-xs font-extrabold uppercase leading-tight tracking-wide",
          hideNameOnMobile && "hidden sm:inline",
          nameClassName,
        )}
      >
        {name}
      </span>
    </span>
  );
}
