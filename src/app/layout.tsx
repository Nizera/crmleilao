import type { Metadata } from "next";
import { Suspense } from "react";
import { StoreMarketing } from "@/components/client/store-marketing";
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
  metadataBase: new URL("https://www.oscarasdaslegends.com.br"),
  title: {
    default: "Os Caras das Legends — Leilão diário de colecionáveis",
    template: "%s · Os Caras das Legends",
  },
  description:
    "Leilão diário de colecionáveis",
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
          <Suspense fallback={null}><StoreMarketing pixelId={process.env.VERCEL_ENV === 'production' && process.env.META_TRACKING_DISABLED !== 'true' ? process.env.META_PIXEL_ID ?? null : null} /></Suspense>
          {children}
        </ThemeProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
