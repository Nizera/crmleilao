import type { SVGProps } from "react";

/**
 * Sistema de ícones da marca "Os Caras das Legends".
 * Mesma gramática dos Lucide: grid 24×24, stroke-width 2, cantos
 * arredondados, currentColor. Ver BRANDING.md §5.
 */

type Props = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Figurinha (canto cortado) com estrela — categoria Legends. */
export function StickerStarIcon(props: Props) {
  return (
    <IconBase {...props}>
      <path d="M6 3h10.5L21 7.5V18a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z" />
      <path d="M12 8.1 13.09 10.8 16 11 13.76 12.87 14.47 15.7 12 14.15 9.53 15.7 10.24 12.87 8 11 10.91 10.8Z" />
    </IconBase>
  );
}

/** Figurinha amassada — categoria Crumple. */
export function CrumpleIcon(props: Props) {
  return (
    <IconBase {...props}>
      <path d="M6 3h10.5L21 7.5V18a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z" />
      <path d="M7.8 10.2c1.4 1.1 2.8-1.1 4.2 0s2.8 1.1 4.2 0" />
      <path d="M8.6 14.8c1.2.9 2.4-.9 3.6 0s2.4.9 3.6 0" />
    </IconBase>
  );
}

/** Moldura com estrela (retrato de Legend) — categoria Quadros. */
export function PictureFrameIcon(props: Props) {
  return (
    <IconBase {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M12 8.4 12.94 10.71 15.42 10.89 13.52 12.49 14.12 14.91 12 13.6 9.88 14.91 10.48 12.49 8.58 10.89 11.06 10.71Z" />
    </IconBase>
  );
}

/** Camiseta — categoria Camisetas. */
export function JerseyIcon(props: Props) {
  return (
    <IconBase {...props}>
      <path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" />
    </IconBase>
  );
}

/** Álbum com anéis e selo na capa — categoria Álbuns. */
export function AlbumIcon(props: Props) {
  return (
    <IconBase {...props}>
      <rect x="5.5" y="2.5" width="13.5" height="19" rx="2" />
      <path d="M9.5 2.5v19" />
      <circle cx="7.5" cy="6.5" r="1" />
      <circle cx="7.5" cy="12" r="1" />
      <circle cx="7.5" cy="17.5" r="1" />
      <circle cx="15" cy="10.5" r="2.75" />
    </IconBase>
  );
}

/** Balão de conversa com pontos — passo "entre no grupo". */
export function GroupChatIcon(props: Props) {
  return (
    <IconBase {...props}>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
      <circle cx="8.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="12" r="1" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

/** Placa de lance com estrela — passo "dê seu lance". */
export function BidPaddleIcon(props: Props) {
  return (
    <IconBase {...props}>
      <rect x="7.5" y="2.5" width="9" height="12" rx="2.5" />
      <path d="M12 14.5v7" />
      <path d="M12 5.8 12.71 7.53 14.57 7.67 13.14 8.87 13.59 10.68 12 9.7 10.41 10.68 10.86 8.87 9.43 7.67 11.29 7.53Z" />
    </IconBase>
  );
}

/** QR Code — passo "pague no Pix". */
export function PixQrIcon(props: Props) {
  return (
    <IconBase {...props}>
      <path d="M4 9V6a2 2 0 0 1 2-2h3" />
      <path d="M15 4h3a2 2 0 0 1 2 2v3" />
      <path d="M20 15v3a2 2 0 0 1-2 2h-3" />
      <path d="M9 20H6a2 2 0 0 1-2-2v-3" />
      <rect x="9.5" y="9.5" width="2.2" height="2.2" rx="0.4" fill="currentColor" stroke="none" />
      <rect x="13.3" y="10" width="1.6" height="1.6" rx="0.4" fill="currentColor" stroke="none" />
      <rect x="10" y="13.3" width="1.6" height="1.6" rx="0.4" fill="currentColor" stroke="none" />
      <rect x="13.5" y="13.5" width="2.2" height="2.2" rx="0.4" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

/** Caixa de envio — passo "receba em casa". */
export function ParcelIcon(props: Props) {
  return (
    <IconBase {...props}>
      <path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7z" />
      <path d="M3.5 7 12 11.5 20.5 7" />
      <path d="M12 11.5V21.5" />
    </IconBase>
  );
}
