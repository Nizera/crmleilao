import { cn } from "@/lib/utils";

/**
 * Mark da marca "Figurinha-Legend": figurinha (retângulo arredondado com o
 * canto superior direito cortado a 45°) com estrela de 5 pontas vazada
 * (fill-rule evenodd — o miolo mostra a cor do fundo do tile).
 * Grid 24×24, mesma gramática dos ícones Lucide.
 */
export function LogoMark({ className }: React.ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={cn("size-4", className)}
    >
      <path
        fillRule="evenodd"
        d="M6 3H16.5L21 7.5V18A3 3 0 0 1 18 21H6A3 3 0 0 1 3 18V6A3 3 0 0 1 6 3ZM12 7.4L13.23 10.7L16.76 10.85L14 13.05L14.94 16.45L12 14.5L9.06 16.45L10 13.05L7.24 10.85L10.77 10.7Z"
      />
    </svg>
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
 * Lockup da marca: tile `bg-primary` (mesmo slot que a UI já usa) + nome em
 * texto vivo. O tile inverte sozinho no dark mode via --primary.
 */
export function Logo({
  className,
  name = "Os Caras das Legends",
  nameClassName,
  tileClassName,
  markClassName,
  hideNameOnMobile = false,
}: LogoProps) {
  return (
    <span className={cn("flex items-center gap-2 font-semibold", className)}>
      <span
        className={cn(
          "flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground",
          tileClassName,
        )}
      >
        <LogoMark className={cn("size-4", markClassName)} />
      </span>
      <span
        className={cn(
          hideNameOnMobile && "hidden sm:inline",
          nameClassName,
        )}
      >
        {name}
      </span>
    </span>
  );
}
