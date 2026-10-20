import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { ThemeScope } from "@/components/theme-scope";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Os Caras das Legends — Leilão diário de Legends da Copa 2026",
    template: "%s · Os Caras das Legends",
  },
  description:
    "Leilão diário de figurinhas da Copa 2026: lotes, arremates, estoque, cobranças e envios.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Tema do painel: roda durante o parse, antes do primeiro paint
            (cobre o carregamento duro). A navegação SPA é coberta pelo
            ThemeScope. suppressHydrationWarning no <html> aceita a classe. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.classList.toggle("tema-painel",location.pathname.startsWith("/painel"))}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <ThemeScope />
          {children}
        </ThemeProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
