import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

// CSP: sem nonce (nenhum middleware injeta um), então o script inline do Next
// precisa de 'unsafe-inline'. Ainda bloqueia script/font/frame de origens
// externas não listadas, que é onde a maior parte do XSS prático mora.
// `img-src` precisa da origem do Supabase: é de onde vêm as fotos do lote
// (storage/v1/object/public/lot-images/...). Sem ela as imagens somem.
const supabaseOrigin = (() => {
  try {
    return supabaseUrl ? new URL(supabaseUrl).origin : null;
  } catch {
    return null;
  }
})();

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  `font-src 'self' data:`,
  // `connect-src` precisa do ViaCEP: o formulário de endereço busca o CEP do
  // cliente no navegador. Sem a origem o lookup falha em silêncio.
  `connect-src 'self' https://viacep.com.br${supabaseUrl ? ` ${supabaseUrl}` : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Fotos do lote ficam no storage público do Supabase (origem remota):
  // o next/image só otimiza o que estiver em remotePatterns.
  images: {
    remotePatterns: supabaseOrigin
      ? [
          {
            protocol: "https",
            hostname: new URL(supabaseOrigin).hostname,
            pathname: "/storage/v1/object/public/**",
          },
        ]
      : [],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Fotos do lote: até 6 imagens já comprimidas no navegador (WebP, ~500 KB
  // cada) no mesmo FormData de uma server action. O Next padrão é 1 MB e
  // derrubava o upload. Isto é só o teto do Next: na Vercel o corpo é cortado
  // em 4,5 MB na infraestrutura e nenhuma flag muda isso — por isso a
  // compressão acontece no cliente, não aqui.
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          // Só em HTTPS (em http://localhost o browser ignora).
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
