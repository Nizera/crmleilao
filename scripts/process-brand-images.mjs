#!/usr/bin/env node
/**
 * Trata as imagens geradas por IA (assets A1–A6 do BRANDING.md) e exporta
 * as versões finais pra public/brand/.
 *
 * O que é feito aqui:
 *  - fundo branco → alpha (linha de tinta fica com borda anti-aliased limpa)
 *  - RGB forçado ao preto puro nas artes monocromáticas (no dark mode o
 *    componente aplica `dark:invert` e a arte fica branca sem halo)
 *  - A6 (selos de raridade) é dividido em 4 selos e mascarado em círculo
 *  - reescala pro tamanho real de uso (2× do display)
 *
 * Uso:
 *   node scripts/process-brand-images.mjs [pasta-com-A1..A6]
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const SRC = process.argv[2] ?? process.env.BRAND_SRC ?? "";
const OUT = path.join(process.cwd(), "public", "brand");

if (!SRC) {
  console.error(
    "Informe a pasta com as imagens originais:\n" +
      "  node scripts/process-brand-images.mjs <pasta>",
  );
  process.exit(1);
}

/** Fundo/ cinza claro: croma baixo + luminância alta vira transparente. */
const ACHROMATIC = 20;

async function loadRaw(file) {
  return sharp(path.join(SRC, file))
    .trim({ threshold: 6 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

/** Arte preta sobre branco → alpha pela luminância, RGB = tinta preta. */
async function inkToAlpha(file, out, width) {
  const { data, info } = await loadRaw(file);
  for (let i = 0; i < data.length; i += 4) {
    const lum =
      0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = Math.round(255 - lum);
  }
  await sharp(data, { raw: { ...info, channels: 4 } })
    .resize({ width, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toFile(out);
}

/**
 * Fundo branco → transparente preservando cores (pra imagens com acentos
 * cromáticos, tipo a variação de hero com as bolinhas de raridade).
 */
async function whiteToAlpha(file, out, width) {
  const { data, info } = await loadRaw(file);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < ACHROMATIC) {
      // cinza/branco/preto: alfa pela luminância (remove fundo e suaviza borda)
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      data[i + 3] = Math.round(255 - lum);
    } else if (min > 245 && max - min < 30) {
      data[i + 3] = 0;
    }
  }
  await sharp(data, { raw: { ...info, channels: 4 } })
    .resize({ width, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toFile(out);
}

/** Localiza os4 selos da tira A6 por perfil de colunas e recorta cada um. */
async function splitSeals(file) {
  const { data, info } = await sharp(path.join(SRC, file))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const colCount = new Uint32Array(width);
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * channels;
      const max = Math.max(data[i], data[i + 1], data[i + 2]);
      const min = Math.min(data[i], data[i + 1], data[i + 2]);
      if (!(min > 246 && max - min < 12)) count++;
    }
    colCount[x] = count;
  }

  // agrupa colunas com conteúdo, fundindo lacunas pequenas
  const runs = [];
  let start = -1;
  for (let x = 0; x <= width; x++) {
    const filled = x < width && colCount[x] > 0;
    if (filled && start < 0) start = x;
    if (!filled && start >= 0) {
      const prev = runs.at(-1);
      if (prev && start - prev.end < width * 0.02) prev.end = x;
      else runs.push({ start, end: x });
      start = -1;
    }
  }

  if (runs.length !== 4) {
    throw new Error(`Esperava 4 selos em ${file}, encontrei ${runs.length}`);
  }
  return runs;
}

const CIRCLE = (size) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );

async function seal(out, { start, end }, size = 96) {
  // extract e trim precisam de pipelines separados (o sharp falha com
  // "bad extract area" quando os dois vão na mesma cadeia)
  const crop = await sharp(path.join(SRC, "A6-rarity-seals.png"))
    .extract({ left: start, top: 0, width: end - start, height: 1536 })
    .png()
    .toBuffer();
  const trimmed = await sharp(crop).trim({ threshold: 6 }).png().toBuffer();

  await sharp(trimmed)
    .resize(size, size, { fit: "cover" })
    .composite([{ input: CIRCLE(size), blend: "dest-in" }])
    .png({ compressionLevel: 9 })
    .toFile(out);
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });

  const jobs = [
    // A1 — mark sólido (rede social, favicon social, app icon alternativo)
    ["A1-mark-render.png", () => inkToAlpha("A1-mark-render.png", path.join(OUT, "mark.png"), 512)],
    // A2 — variação de hero (marca inclinada + bolinhas de raridade)
    ["A2-hero-variation.png", () => whiteToAlpha("A2-hero-variation.png", path.join(OUT, "hero-variation.png"), 720)],
    // A3–A5 — ilustrações de estado vazio
    ["A3-empty-lots.png", () => inkToAlpha("A3-empty-lots.png", path.join(OUT, "empty-lots.png"), 320)],
    ["A4-empty-pix.png", () => inkToAlpha("A4-empty-pix.png", path.join(OUT, "empty-pix.png"), 320)],
    ["A5-empty-shipments.png", () => inkToAlpha("A5-empty-shipments.png", path.join(OUT, "empty-shipments.png"), 320)],
  ];

  for (const [, job] of jobs) await job();

  // A6 — selos de raridade, um arquivo por cor
  const seals = await splitSeals("A6-rarity-seals.png");
  const names = ["seal-roxa", "seal-bronze", "seal-prata", "seal-ouro"];
  for (const [index, run] of seals.entries()) {
    await seal(path.join(OUT, `${names[index]}.png`), run);
  }

  const files = (await fs.readdir(OUT)).sort();
  for (const file of files) {
    const full = path.join(OUT, file);
    const meta = await sharp(full).metadata();
    const kb = ((await fs.stat(full)).size / 1024).toFixed(1);
    console.log(
      `${file.padEnd(24)} ${String(meta.width).padStart(4)}×${String(meta.height).padEnd(4)} ${kb.padStart(7)} KB`,
    );
  }
}

await main();
