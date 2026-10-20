# Branding — Os Caras das Legends

Guia de identidade visual do site e dos painéis. A base é o design
monocromático do shadcn (preto/branco + cinzas) que o tema `nova` já usa em
`src/app/globals.css`; as **cores de raridade** são o acento cromático de
conteúdo, e o **painel do cliente** tem tema próprio com preto, amarelo e
dourado (ver §2).

---

## 1. A marca: "Figurinha-Legend"

O mark é uma **figurinha** — retângulo arredondado com o **canto superior
direito cortado a 45°** (aquele canto que a gente arranca da folha de
figurinhas) e uma **estrela de 5 pontas vazada** no miolo.

- **Figurinha** = o ramo: stickers, cards, quadros, álbuns da Copa 2026
- **Canto cortado** = o gesto de colar/destacar a figurinha
- **Estrela** = a linha *Legend* (o produto principal do leilão)
- O retângulo arredondado **ecoa o tile `rounded-lg`** que a interface já usa
  em botões, badges e no slot da logo — a marca é a própria UI em miniatura

### Geometria (grid 24×24, como os ícones Lucide)

- Corpo: retângulo de 3→21 com `rx 3`, canto superior direito cortado da
  diagonal `(16.5, 3) → (21, 7.5)`
- Estrela: centro `(12, 12.4)`, raio externo 5, interno 2.1, **vazada** com
  `fill-rule: evenodd` — a cor que aparece no miolo é sempre a do fundo do tile

Implementação: `src/components/brand/logo.tsx` (`LogoMark` + `Logo`).

---

## 2. Paleta

| Papel | Valor | Uso |
| --- | --- | --- |
| Ink | `#0A0A0A` | marca, texto forte, tile em app icons |
| Paper | `#FFFFFF` | fundo claro, marca sobre tile escuro |
| Muted | `#737373` | texto secundário (`--muted-foreground`) |
| Border | `#E5E5E5` | bordas (`--border`) |

Acentos — **só em badges, chips e detalhes** (nunca na marca):

| Raridade | Hex |
| --- | --- |
| Roxa | `#8b5cf6` |
| Bronze | `#b45309` |
| Prata | `#94a3b8` |
| Ouro | `#eab308` |

**Regra de ouro:** a marca é 100% monocromática. Cor entra em *conteúdo*
(raridade, status), nunca no logotipo.

### Tema do painel do cliente — preto · amarelo · dourado

O painel (`/painel/*`, incluindo login e convite) tem tema próprio que
espelha o brasão: no **claro** preto com texto amarelo (escudo sobre papel),
no **escuro** amarelo com texto preto (wordmark sobre o escudo). Admin e
landing ficam com a paleta neutra de sempre.

| Papel | Valor | Uso |
| --- | --- | --- |
| Preto | `#0A0A0A` | `--primary` no claro; fundo no escuro |
| Amarelo | `#FACC15` | `--primary` no escuro; texto dos CTAs no claro |
| Dourado | `#C9A227` | filete do header, borda do Pix ativo (`ouro/40`) |
| Ouro-ink | `#A16207` | números hero sobre papel (≥4.5:1); vira amarelo no escuro |

- **Mecanismo:** classe `tema-painel` no `<html>` (script pré-paint no
  `layout.tsx` + `ThemeScope` na navegação SPA) — assim os portais
  (sheet/dialog/toast), que nascem no `<body>`, também herdam. Tokens em
  `globals.css` (`html.tema-painel` / `html.tema-painel.dark`) + utilities
  `text-ouro-ink`, `border-ouro/40`, `via-ouro`.
- **Onde a cor aparece:** CTA/botão default, tab ativa (via `border-primary`),
  tile da logo (preto+marca amarela no claro / amarelo+marca preta no
  escuro), filete dourado no header, e 3 números hero (total do Pix, valor
  no QR sheet, valor do lote).
- **Onde NÃO aparece:** status badges (continuam semânticos — são
  `variant="outline"`), linhas pequenas de lista, empty states, e nada
  fora de `/painel/*`.

## 3. Tipografia

- **Inter** (`--font-inter`) — wordmark e toda a UI
- **Geist Mono** (`--font-geist-mono`) — códigos de lote, rastreio, valores
- Wordmark: `font-semibold`, title case, **texto vivo** (nunca imagem) — assim
  é selecionável, acessível e escala perfeitamente

## 4. Usos da marca

| Onde | Arquivo | Versão |
| --- | --- | --- |
| Header da landing | `src/app/(marketing)/page.tsx` | lockup (tile 28px + nome) |
| Login admin | `src/app/(auth)/login/page.tsx` | lockup (tile 32px) |
| Login cliente | `src/app/(client)/painel/login/page.tsx` | lockup (tile 32px) |
| Convite | `src/app/(client)/painel/convite/page.tsx` | lockup (tile 32px) |
| Form de login admin | `src/components/login-form.tsx` | tile 40px, sem nome |
| Header do painel cliente | `src/components/client/client-header.tsx` | lockup (tile 28px) |
| Sidebar do admin | `src/components/admin/admin-sidebar.tsx` | tile 32px + duas linhas |
| Favicon | `src/app/icon.svg` | mark só, Ink sobre transparente |
| Ícone iOS | `src/app/apple-icon.tsx` | mark branco em tile Ink 180×180 |
| Preview de link (WhatsApp) | `src/app/opengraph-image.tsx` | lockup vertical 1200×630 |

### Regras de aplicação

- **Tamanho mínimo do mark:** 16px (já valida no favicon)
- **Clear space:** meia largura do mark em todos os lados
- **Sempre dentro do tile** `bg-primary text-primary-foreground rounded-lg`
  quando usada como logo de header — nunca o mark solto sobre fundo colorido
- **Dark mode:** nada a fazer — o tile inverte sozinho via `--primary`
- **Proibido:** gradientes, sombras, 3D, contornar a marca, inclinar, trocar a
  estrela por outro glifo, preencher o vazado da estrela

## 5. Sistema de ícones

Ícones próprios seguem a gramática Lucide: grid 24×24, `stroke-width: 2`,
cantos arredondados, `currentColor`. Ficam em
`src/components/icons/collectibles.tsx`.

| Ícone | Onde |
| --- | --- |
| `StickerStarIcon` | categoria Legends + vazio de lotes |
| `CrumpleIcon` | categoria Crumple |
| `PictureFrameIcon` | categoria Quadros |
| `JerseyIcon` | categoria Camisetas |
| `AlbumIcon` | categoria Álbuns |
| `GroupChatIcon` | passo 1 — entre no grupo |
| `BidPaddleIcon` | passo 2 — dê seu lance (+ stat "Todo dia") |
| `PixQrIcon` | passo 3 — pague no Pix (+ vazio de pagamentos) |
| `ParcelIcon` | passo 4 — receba em casa (+ vazio de envios) |

Ícones utilitários continuam sendo Lucide (`MessageCircle`, `Truck`, `QrCode`…).

## 6. Assets gerados por IA (GPT Image)

O mark, o favicon, o app icon e a OG image **já existem em código** (vetor,
nítidos, sem custo de build extra). A IA entra onde vetor puro não resolve:

| # | Asset | Uso | Tamanho no ChatGPT |
| --- | --- | --- | --- |
| A1 | Mark "render" | foto de perfil Instagram e do grupo | 1024×1024 |
| A2 | Variação hero | topo da landing | 1536×1024 |
| A3 | Vazio — lotes | painel do cliente | 1024×1024 |
| A4 | Vazio — Pix | painel do cliente | 1024×1024 |
| A5 | Vazio — envios | painel do cliente | 1024×1024 |
| A6 | Selos de raridade | chips Roxa/Bronze/Prata/Ouro na landing | 1536×1024 |
| A7 | Flat lay do leilão | card "Seu painel no celular" (não gerado) | 1536×1024 |

### Arquivos finais (public/brand/)

Gerados por `node scripts/process-brand-images.mjs <pasta-com-A1..A6>`
(fundo transparente via ink-to-alpha, selos recortados em 4, export 2×):

| Arquivo | px | Origem | Onde é usado | Convenção dark |
| --- | --- | --- | --- | --- |
| `mark.png` | 512×560 | A1 | header do dashboard admin | `dark:invert` |
| `hero-variation.png` | 526×708 | A2 | topo do hero da landing | `dark:invert dark:hue-rotate-180` |
| `empty-lots.png` | 320×302 | A3 | `EmptyState` de lotes (lista + histórico) | `dark:invert` |
| `empty-pix.png` | 320×391 | A4 | `EmptyState` de Pagamentos (card + histórico) | `dark:invert` |
| `empty-shipments.png` | 320×217 | A5 | `EmptyState` de Envios (card + histórico) | `dark:invert` |
| `seal-{roxa,bronze,prata,ouro}.png` | 96×96 | A6 | chips de raridade da landing | sem filtro (só alpha) |

Regra: **line art monocromático → `dark:invert`; imagem com cor →
`dark:invert dark:hue-rotate-180`; PNG colorido com alpha (selos) → sem
filtro.** O `EmptyState` (`src/components/empty-state.tsx`) já aplica
`dark:invert` sozinho quando recebe a prop `image`.

### Estilo global (cole no início de todo prompt)

> Flat 2D vector illustration, pure monochrome black (#0A0A0A) on pure white
> background, bold uniform strokes with rounded caps and joins, geometric
> shapes built on a grid, minimal modern Swiss style matching a clean SaaS
> interface, no gradients, no shadows, no textures, no 3D, no photorealism,
> absolutely no text, letters, numbers or watermarks anywhere, centered
> composition with generous margins, crisp clean edges, square format.

### A1 — Mark render (perfil do Instagram / foto do grupo)

> A minimal logo mark for a Brazilian collectible-sticker auction brand: a
> single rounded-square sticker shape with its top-right corner cleanly cut
> at 45 degrees, and a five-pointed star cut out from the center of the
> sticker so the white background shows through the star. Solid black
> sticker, star-shaped hole, perfectly centered, generous padding around it,
> flat vector monochrome, no text.

*Serve para:* `@oscarasdaslegends` e a foto do grupo do WhatsApp.
Pós-produção: remover fundo, exportar PNG 512×512 e 1024×1024.

### A2 — Variação hero (opcional)

> Same sticker-with-star logo mark, but now shown at a slight playful angle
> (about 8 degrees), with three small solid dots in a row below it in purple
> (#8B5CF6), brown-gold (#B45309) and yellow (#EAB308), hinting at rarity
> tiers. Everything else monochrome, flat vector, wide horizontal
> composition, no text.

*Serve para:* topo do hero da landing (`hero-variation.png`).

### A3 — Empty state: lotes vazios

> A small stack of collectible stickers (rounded rectangles with one corner
> cut at 45 degrees) slightly fanned out like a hand of cards, the top
> sticker showing a five-pointed star outline. Friendly minimal line art,
> uniform black outline strokes on white, lots of white space, no text.

*Serve para:* `ClientLotsList` sem lotes. Sugestão de uso: recortar o
fundo e exibir a ~96px acima do texto do empty state.

### A4 — Empty state: Pix vazio

> A rounded QR code card floating gently above a simple open wallet, one
> tiny five-pointed star in the center of the QR code. Friendly minimal
> line art, uniform black outline strokes on white, lots of white space,
> no text.

*Serve para:* `ClientChargesCard` sem cobranças.

### A5 — Empty state: envios vazios

> A small closed cardboard box with a blank shipping label and a couple of
> tiny motion lines behind it, waiting. Friendly minimal line art, uniform
> black outline strokes on white, lots of white space, no text.

*Serve para:* `ClientShipmentsCard` sem envios.

### A6 — Selos de raridade (opcional)

> Four small circular foil seals in a horizontal row, each with a
> five-pointed star in the center and a subtle holographic sheen: the first
> purple (#8B5CF6), the second bronze (#B45309), the third silver (#94A3B8),
> the fourth gold (#EAB308). Flat vector, white background, no text.

*Serve para:* os chips de raridade da landing (`seal-*.png`), junto do
label em texto.

### A7 — Flat lay do leilão (opcional)

> Top-down flat lay of a collector's table: three stickers with cut corners
> and star outlines, one small framed picture, a folded t-shirt, and a
> bidding paddle with a star on it, arranged with generous spacing. Minimal
> monochrome line art, uniform black strokes on white, no text.

*Serve para:* metade visual do card "Seu painel no celular" na landing.

### Pós-produção (sempre)

1. GPT Image entrega PNG com fundo — rodar em remove.bg (ou pedir
   "transparent background" e conferir) e ajustar levels pra preto puro
2. Para uso vetorial (perfil, materiais): subir o PNG noVectorizer.io e
   conferir o resultado no grid 24×24 antes de escalar
3. Exportar sempre em 2× do tamanho de uso final; nunca esticar
4. Antes de publicar: testar o mark a 16px (favicon), 28px (header) e
   32px (sidebar) — se a estrela encher de miado, simplifique
