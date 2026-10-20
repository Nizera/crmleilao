"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";

const TEMA = "tema-painel";

/**
 * Ativa o tema do painel do cliente (preto · amarelo · dourado) em
 * /painel/*. No carregamento duro o script no <head> do root layout já
 * aplica a classe antes do primeiro paint; aqui cobre a navegação SPA e o
 * remount do Strict Mode no dev (que limpa atributos gerenciados fora do
 * JSX do <html>). A classe vive no <html> para valer também nos portais
 * (sheet/dialog/toast), que renderizam no <body>.
 */
export function ThemeScope() {
  const pathname = usePathname();

  useLayoutEffect(() => {
    document.documentElement.classList.toggle(
      TEMA,
      pathname.startsWith("/painel"),
    );
  }, [pathname]);

  return null;
}
