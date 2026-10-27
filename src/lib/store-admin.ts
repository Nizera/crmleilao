import { z } from "zod";
import type { LoyaltyReward } from "@/lib/loyalty";

export type AdminProduct = LoyaltyReward & { sku: string; category: string; image_paths: string[]; archived: boolean; low_stock_threshold: number | null; reserved: number };
export type CatalogStatus = "all" | "published" | "draft" | "sold-out" | "low-stock" | "archived" | "missing-photo" | "missing-cost";
export type CatalogData = { items: AdminProduct[]; total: number; counts: Record<CatalogStatus, number>; categories: string[] };
export const CATALOG_PATH = "/admin/fidelidade/recompensas";
export const MAX_PRODUCT_PHOTOS = 6;
export const MAX_PRODUCT_PHOTO_BYTES = 600_000;

export function parseCatalogNumber(raw: unknown): unknown {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return raw;
  let value = String(raw).trim().replace(/^R\$\s*/i, "");
  if (!value) return null;
  if (/^-?(?:\d{1,3}(?:\.\d{3})*|\d+),\d{1,2}$/.test(value)) value = value.replaceAll(".", "").replace(",", ".");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(value)) return Number.NaN;
  return Number(value);
}
const amount = (minimum: number) => z.preprocess(parseCatalogNumber,z.number({ error: "Informe um número válido." }).finite().min(minimum,"Valor abaixo do permitido.").max(9999999,"Valor acima do permitido.").nullable());
const integer = (minimum: number,maximum=9999999) => z.preprocess(parseCatalogNumber,z.number({ error: "Informe um inteiro válido." }).int("Informe um inteiro.").min(minimum).max(maximum).nullable());
const optionalText = (max: number) => z.preprocess((raw) => String(raw ?? "").trim() || null,z.string().max(max,`Use até ${max} caracteres.`).nullable());
export const storeProductSchema = z.object({
  name: z.string().trim().min(2,"Informe um nome com pelo menos 2 caracteres.").max(120),
  description: optionalText(2000),
  sku: optionalText(48).refine((value) => value === null || /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/.test(value),"SKU aceita letras, números, ponto, hífen e sublinhado.").transform((value) => value?.toUpperCase() ?? null),
  category: z.preprocess((raw) => String(raw ?? "").trim() || "Sem categoria",z.string().max(60)),
  delivery_kind: z.enum(['physical','digital']).default('physical'),
  points_cost: integer(1), cash_price: amount(0.01), mixed_cash_price: amount(0.01), mixed_points_cost: integer(1),
  internal_cost: amount(0), stock: integer(0,1000000), low_stock_threshold: integer(0,1000000),
  active: z.boolean().default(false), archived: z.boolean().default(false),
}).superRefine((value,ctx) => {
  if ((value.mixed_cash_price === null) !== (value.mixed_points_cost === null)) ctx.addIssue({code:"custom",path:["mixed_cash_price"],message:"Preencha os dois valores do combinado."});
  if (value.active && (value.internal_cost === null || (value.points_cost === null && value.cash_price === null && value.mixed_cash_price === null))) ctx.addIssue({code:"custom",path:["active"],message:"Para publicar, informe custo interno e ao menos uma modalidade de preço."});
  if (value.active && value.archived) ctx.addIssue({code:"custom",path:["active"],message:"Um produto arquivado não pode estar publicado."});
});
export type StoreProductInput = z.infer<typeof storeProductSchema>;
export function isProductImagePath(productId: string,path: string) {
  return /^[0-9a-f-]{36}$/i.test(productId) && new RegExp(`^loyalty-rewards/${productId}/[A-Za-z0-9_-]+\\.(jpg|jpeg|png|webp|avif)$`).test(path);
}
export function isProductImageContent(bytes: Uint8Array,mime: string) {
  const starts = (...values: number[]) => values.every((value,i) => bytes[i] === value);
  if (mime === "image/jpeg") return starts(0xff,0xd8,0xff);
  if (mime === "image/png") return starts(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a);
  return mime === "image/webp" && String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP";
}

const csvFields: Record<string,string> = { nome:"name",descricao:"description",sku:"sku",categoria:"category",preco_caracoins:"points_cost",preco_reais:"cash_price",combinado_reais:"mixed_cash_price",combinado_caracoins:"mixed_points_cost",custo_interno:"internal_cost",estoque:"stock",alerta_estoque:"low_stock_threshold" };
export const PRODUCT_CSV_TEMPLATE = '\uFEFFnome;descricao;sku;categoria;preco_caracoins;preco_reais;combinado_reais;combinado_caracoins;custo_interno;estoque;alerta_estoque\nKit do colecionador;Kit com acessórios;KIT-001;Colecionáveis;200;49,90;19,90;100;15,00;12;5\n';
function csvRecords(input: string) {
  const text = input.replace(/^\uFEFF/,"");
  const header = text.split(/\r?\n/,1)[0];
  const delimiter = header.includes(";") ? ";" : header.includes("\t") ? "\t" : ",";
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false; let closed = false;
  const pushRow = () => { row.push(field); if (row.some((value) => value.trim())) rows.push(row); row=[]; field=""; closed=false; if (rows.length > 201) throw new Error("Importe no máximo 200 produtos por vez."); };
  for (let i=0;i<text.length;i++) {
    const ch=text[i];
    if (ch === '"') {
      if (quoted && text[i+1] === '"') { field+='"'; i++; }
      else if (quoted) { quoted=false; closed=true; }
      else if (!field.trim() && !closed) { quoted=true; field=""; }
      else throw new Error("Aspas inválidas no CSV.");
    } else if (!quoted && ch === delimiter) { row.push(field); field=""; closed=false; }
    else if (!quoted && (ch === "\n" || ch === "\r")) { if (ch === "\r" && text[i+1] === "\n") i++; pushRow(); }
    else if (!quoted && closed) { if (ch.trim()) throw new Error("Conteúdo inesperado depois de aspas no CSV."); }
    else field+=ch;
    if (field.length > 5000) throw new Error("Uma coluna do CSV excede o tamanho permitido.");
  }
  if (quoted) throw new Error("Há aspas sem fechamento no CSV.");
  if (field || row.length) pushRow();
  return rows;
}
export function parseProductCsv(text: string): { rows: StoreProductInput[]; errors: string[] } {
  try {
    if (text.length > 256000) throw new Error("O CSV deve ter até 250 KB.");
    const records=csvRecords(text); const headers=(records.shift() ?? []).map((value) => value.trim().toLowerCase());
    if (!headers.includes("nome")) throw new Error("O CSV precisa da coluna nome. Baixe o modelo para começar.");
    if (new Set(headers).size !== headers.length || headers.some((key) => !Object.hasOwn(csvFields,key))) throw new Error("O CSV contém colunas desconhecidas ou duplicadas. Use os cabeçalhos do modelo.");
    if (!records.length) throw new Error("Inclua pelo menos um produto no CSV.");
    const rows: StoreProductInput[]=[]; const errors: string[]=[]; const skus=new Set<string>();
    for (const [index,record] of records.entries()) {
      if (record.length > headers.length) { errors.push(`Linha ${index+2}: colunas em excesso.`); continue; }
      const raw=Object.fromEntries(headers.map((header,i) => [csvFields[header],record[i] ?? ""]));
      const parsed=storeProductSchema.safeParse({...raw,active:false,archived:false});
      if (!parsed.success) { errors.push(`Linha ${index+2}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`); continue; }
      if (parsed.data.sku && skus.has(parsed.data.sku)) { errors.push(`Linha ${index+2}: SKU ${parsed.data.sku} duplicado no arquivo.`); continue; }
      if (parsed.data.sku) skus.add(parsed.data.sku);
      rows.push(parsed.data);
    }
    return {rows,errors:errors.slice(0,20)};
  } catch (error) { return {rows:[],errors:[error instanceof Error ? error.message : "CSV inválido."]}; }
}
