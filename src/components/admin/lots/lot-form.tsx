"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ImagePlus, X } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { saveLot, searchLotCustomers } from "@/app/actions/lots";
import { StockPicker } from "@/components/admin/lots/stock-picker";
import { LotAiReview } from "@/components/admin/lots/lot-ai-review";
import { Button } from "@/components/ui/button";
import { formatPhoneBR } from "@/lib/customers";
import type { Customer } from "@/lib/dal";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/result";
import type { LotItemPick, Player, StockItem } from "@/lib/stock";
import {
  formatBRL,
  lotImageUrl,
  lotFormSchema,
  LOT_STATUSES,
  LOT_STATUS_LABELS,
  nextShippingDate,
  todayISO,
  waMessageLink,
  type Lot,
  type LotFormValues,
} from "@/lib/lots";
import { toE164 } from "@/lib/phone";
import { WEEKDAY_LABELS } from "@/lib/settings";

type Props = {
  lot: Lot | null;
  players: Player[];
  stock: StockItem[];
  bidIncrement: number;
  shippingWeekday: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const MAX_IMAGES = 6;

export function LotFormSheet({
  lot,
  players,
  stock,
  bidIncrement,
  shippingWeekday,
  open,
  onOpenChange,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl"
      >
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>
            {lot ? `Editar lote ${lot.code}` : "Novo lote"}
          </SheetTitle>
          <SheetDescription>
            Lance o arremate, as fotos e a data de envio.
          </SheetDescription>
        </SheetHeader>

        <LotForm
          key={lot?.id ?? "new"}
          lot={lot}
          players={players}
          stock={stock}
          bidIncrement={bidIncrement}
          shippingWeekday={shippingWeekday}
          onDone={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}

function LotForm({
  lot,
  players,
  stock,
  bidIncrement,
  shippingWeekday,
  onDone,
}: {
  lot: Lot | null;
  players: Player[];
  stock: StockItem[];
  bidIncrement: number;
  shippingWeekday: number;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [keptImages, setKeptImages] = useState<string[]>(lot?.images ?? []);
  const [uploads, setUploads] = useState<{ file: File; url: string }[]>([]);
  const [compressing, setCompressing] = useState(false);
  const [shippingTouched, setShippingTouched] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<Customer[] | null>(null);
  const [customerSearching, setCustomerSearching] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(
    lot?.customer ? { id: lot.customer_id, name: lot.customer.name, phone_e164: lot.customer.phone_e164 } : null,
  );
  const [items, setItems] = useState<LotItemPick[]>(
    (lot?.items ?? []).map((row) => ({
      stock_item_id: row.stock_item_id,
      qty: row.qty,
    })),
  );

  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<LotFormValues>({
    resolver: zodResolver(lotFormSchema),
    defaultValues: {
      id: lot?.id ?? "",
      customer_id: lot?.customer_id ?? "",
      phone: lot?.customer?.phone_e164 ?? "",
      customer_name: lot?.customer?.name ?? "",
      title: lot?.title ?? "",
      description: lot?.description ?? "",
      arremate_value: lot ? String(lot.arremate_value) : "",
      auction_date: lot?.auction_date ?? todayISO(),
      shipping_date:
        lot?.shipping_date ??
        nextShippingDate(lot?.auction_date ?? todayISO(), shippingWeekday),
      status: lot?.status ?? "pending_payment",
      notes: lot?.notes ?? "",
    },
  });

  const remaining = MAX_IMAGES - keptImages.length - uploads.length;
  const statusValue = useWatch({ control: form.control, name: "status" });

  const addFiles = async (list: FileList | File[] | null) => {
    if (!list || remaining <= 0 || compressing) return;
    const picked = Array.from(list)
      .filter((file) => file.size > 0)
      .slice(0, remaining);

    setCompressing(true);
    try {
      const processed = await Promise.all(
        picked.map(async (file) => {
          const compressed = await compressImage(file);
          return { file: compressed, url: URL.createObjectURL(compressed) };
        }),
      );
      setUploads((current) => [...current, ...processed]);
    } finally {
      setCompressing(false);
    }
  };

  const removeUpload = (url: string) => {
    URL.revokeObjectURL(url);
    setUploads((current) => current.filter((item) => item.url !== url));
  };

  // Ctrl+V com imagem na área de transferência (WhatsApp, screenshot, etc.)
  // entra no mesmo pipeline do seletor de arquivos.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter(
          (file): file is File =>
            file instanceof File && file.type.startsWith("image/"),
        );
      if (files.length === 0) return;
      event.preventDefault();
      void addFiles(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  const searchCustomer = async () => {
    const q = customerQuery.trim();
    if (q.length < 2) return;
    setCustomerSearching(true);
    const result = await searchLotCustomers(q);
    setCustomerSearching(false);
    if (result.ok) setCustomerResults(result.data);
  };

  const pickCustomer = (customer: Customer) => {
    setSelectedCustomer(customer);
    form.setValue("customer_id", customer.id, { shouldValidate: true });
    form.setValue("phone", customer.phone_e164, { shouldValidate: true });
    form.setValue("customer_name", customer.name ?? "", { shouldValidate: true });
    setCustomerResults(null);
    setCustomerQuery("");
  };

  const clearCustomer = () => {
    setSelectedCustomer(null);
    form.setValue("customer_id", "", { shouldValidate: false });
    form.setValue("phone", "", { shouldValidate: false });
    form.setValue("customer_name", "", { shouldValidate: false });
    setServerError(null);
  };

  const submit = form.handleSubmit((values) => {
    setServerError(null);

    // Teto da Vercel para o corpo da requisição: 4,5 MB e não tem como
    // levantar isso. Conferir aqui devolve uma mensagem em vez de um 413.
    const totalBytes = totalUploadBytes(uploads.map((item) => item.file));
    if (totalBytes > 4_000_000) {
      setServerError(
        `As fotos somam ${Math.round(totalBytes / 1_000_000)} MB e o envio aceita até 4 MB. ` +
          "Remova ou troque algumas imagens.",
      );
      return;
    }

    const fd = new FormData();
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === null) continue;
      fd.append(key, String(value));
    }
    fd.append("keep_images", JSON.stringify(keptImages));
    fd.append("items", JSON.stringify(items));
    for (const { file } of uploads) fd.append("images", file);

    startTransition(async () => {
      try {
        const result: ActionResult<{
          id: string;
          code: string;
          inviteUrl?: string;
        }> = await saveLot(fd);

        if (!result.ok) {
          setServerError(result.error);
          return;
        }

        if (result.data.inviteUrl) {
          // Cliente novo: o convite de acesso nasceu junto com o lote.
          const url = result.data.inviteUrl;
          const phone = toE164(values.phone ?? "");
          void navigator.clipboard.writeText(url).catch(() => undefined);
          toast.success(`Lote ${result.data.code} criado.`, {
            description:
              "Cliente novo cadastrado e convite de acesso copiado — mande no WhatsApp dele.",
            action: phone
              ? {
                  label: "WhatsApp",
                  onClick: () => {
                    window.open(
                      waMessageLink(
                        phone,
                         `Oi! Seu acesso ao painel dos Caras das Legends: ${url}`,
                      ),
                      "_blank",
                      "noopener",
                    );
                  },
                }
              : undefined,
          });
        } else {
          toast.success(
            values.id ? "Lote atualizado." : `Lote ${result.data.code} criado.`,
          );
        }

        uploads.forEach(({ url }) => URL.revokeObjectURL(url));
        onDone();
      } catch (error) {
        // Server action rejeitada (rede, body acima do limite, exceção no
        // servidor). Sem este catch a transição falhava em silêncio.
        setServerError(
          error instanceof Error && error.message
            ? error.message
            : "Falha ao salvar o lote. Tente novamente.",
        );
      }
    });
  });

  const {
    formState: { errors },
  } = form;

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5"
    >
      <FieldGroup>
        <Field data-invalid={!selectedCustomer && !!errors.phone}>
          <FieldLabel>Cliente</FieldLabel>
          {selectedCustomer ? (
            <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {selectedCustomer.name ?? "Sem nome"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatPhoneBR(selectedCustomer.phone_e164)}
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={clearCustomer}>
                Trocar
              </Button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <Input
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void searchCustomer();
                    }
                  }}
                  placeholder="Nome ou WhatsApp com DDD"
                  autoComplete="off"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void searchCustomer()}
                  disabled={customerSearching}
                >
                  {customerSearching ? "…" : "Buscar"}
                </Button>
              </div>
              {customerResults && customerResults.length > 0 && (
                <ul className="mt-1 max-h-48 divide-y overflow-y-auto rounded-md border">
                  {customerResults.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => pickCustomer(c)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition hover:bg-muted"
                      >
                        <span className="truncate">{c.name ?? "Sem nome"}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {formatPhoneBR(c.phone_e164)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {customerResults && customerResults.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Nenhum cliente encontrado. Digite o WhatsApp abaixo para cadastrar um novo.
                </p>
              )}
            </>
          )}
        </Field>

        {!selectedCustomer && (
          <Field data-invalid={!!errors.phone}>
            <FieldLabel htmlFor="phone">WhatsApp do cliente</FieldLabel>
            <Input
              id="phone"
              inputMode="tel"
              placeholder="+55 11 99999-8888"
              autoComplete="tel"
              {...form.register("phone")}
            />
            <FieldDescription>
              Se o número ainda não existir, o cliente é cadastrado agora.
            </FieldDescription>
            <FieldError>{errors.phone?.message}</FieldError>
          </Field>
        )}

        {!selectedCustomer && (
          <Field>
            <FieldLabel htmlFor="customer_name">Nome do cliente</FieldLabel>
            <Input
              id="customer_name"
              placeholder="Opcional"
              autoComplete="off"
              {...form.register("customer_name")}
            />
            <FieldError>{errors.customer_name?.message}</FieldError>
          </Field>
        )}

        <Field data-invalid={!!errors.title}>
          <FieldLabel htmlFor="title">Lote</FieldLabel>
          <Input
            id="title"
            placeholder="Ex.: Figura especial — seleção França"
            {...form.register("title")}
          />
          <FieldError>{errors.title?.message}</FieldError>
        </Field>

        <Field data-invalid={!!errors.arremate_value}>
          <FieldLabel htmlFor="arremate_value">Valor do arremate</FieldLabel>
          <Input
            id="arremate_value"
            inputMode="decimal"
            placeholder="45"
            {...form.register("arremate_value")}
          />
          <FieldDescription>
            Valor final arrematado no grupo. O lance do leilão é fixo de{" "}
            {formatBRL(bidIncrement)}.
          </FieldDescription>
          <FieldError>{errors.arremate_value?.message}</FieldError>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.auction_date}>
            <FieldLabel htmlFor="auction_date">Data do leilão</FieldLabel>
            <Input
              id="auction_date"
              type="date"
              {...form.register("auction_date", {
                onChange: (event: ChangeEvent<HTMLInputElement>) => {
                  const next = event.target.value;
                  if (!next || shippingTouched) return;

                  form.setValue(
                    "shipping_date",
                    nextShippingDate(next, shippingWeekday),
                    {
                      shouldValidate: true,
                    },
                  );
                },
              })}
            />
            <FieldError>{errors.auction_date?.message}</FieldError>
          </Field>

          <Field data-invalid={!!errors.shipping_date}>
            <FieldLabel htmlFor="shipping_date">Data de envio</FieldLabel>
            <Input
              id="shipping_date"
              type="date"
              {...form.register("shipping_date", {
                onChange: () => setShippingTouched(true),
              })}
            />
            <FieldDescription>
              Padrão: {WEEKDAY_LABELS[shippingWeekday]} seguinte.
            </FieldDescription>
            <FieldError>{errors.shipping_date?.message}</FieldError>
          </Field>
        </div>

        <Field data-invalid={!!errors.status}>
          <FieldLabel>Status</FieldLabel>
          <Select
            value={statusValue}
            onValueChange={(value) =>
              form.setValue("status", value as LotFormValues["status"], {
                shouldValidate: true,
              })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {LOT_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {LOT_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError>{errors.status?.message}</FieldError>
        </Field>

        <Field data-invalid={!!errors.description}>
          <FieldLabel htmlFor="description">Descrição</FieldLabel>
          <Textarea
            id="description"
            rows={3}
            placeholder="O que tem dentro do lote, estado da figurinha…"
            {...form.register("description")}
          />
          <FieldError>{errors.description?.message}</FieldError>
        </Field>

        <LotAiReview files={uploads.map(photo=>photo.file)} savedPaths={keptImages} lotId={lot?.id} players={players} stock={stock} onApprove={setItems} hasItems={items.length>0} disabled={pending||compressing}/>
        <StockPicker
          players={players}
          stock={stock}
          items={items}
          onChange={setItems}
          disabled={pending}
        />

        <Field data-invalid={!!errors.notes}>
          <FieldLabel htmlFor="notes">Observações internas</FieldLabel>
          <Textarea
            id="notes"
            rows={2}
            placeholder="Só a equipe vê."
            {...form.register("notes")}
          />
          <FieldError>{errors.notes?.message}</FieldError>
        </Field>
      </FieldGroup>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">Fotos do lote</p>
        <div className="flex flex-wrap gap-2">
          {keptImages.map((path) => (
            <ImageThumb
              key={path}
              src={lotImageUrl(path)}
              onRemove={() =>
                setKeptImages((current) => current.filter((p) => p !== path))
              }
            />
          ))}
          {uploads.map((item) => (
            <ImageThumb
              key={item.url}
              src={item.url}
              onRemove={() => removeUpload(item.url)}
            />
          ))}
          {remaining > 0 && (
            <button
              type="button"
              disabled={compressing}
              onClick={() => fileInputRef.current?.click()}
              className="flex size-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-muted-foreground transition hover:border-foreground/40 hover:text-foreground disabled:opacity-50"
            >
              <ImagePlus className="size-4" />
              <span className="text-[11px]">
                {compressing ? "Otimizando…" : "Adicionar"}
              </span>
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          JPG, PNG, WebP ou AVIF até 5 MB. Até {MAX_IMAGES} fotos
          {compressing ? "" : " — reduzimos para caber no envio"}. Dica: copie
          a imagem e cole aqui com Ctrl+V.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          multiple
          className="hidden"
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {serverError && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {serverError}
        </p>
      )}

      <div className="mt-auto flex items-center justify-end gap-2 border-t pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            uploads.forEach(({ url }) => URL.revokeObjectURL(url));
            onDone();
          }}
          disabled={pending || compressing}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || compressing}>
          {pending
            ? "Salvando…"
            : compressing
              ? "Otimizando fotos…"
              : lot
                ? "Salvar alterações"
                : "Criar lote"}
        </Button>
      </div>
    </form>
  );
}

function FieldGroup({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4">{children}</div>;
}

/** Lado maior que isto não aparece no painel nem na galeria. */
const MAX_EDGE = 1600;
/**
 * Orçamento por foto. A Vercel rejeita corpo acima de 4,5 MB (413, sem flag
 * que mude isso) e são até 6 fotos no mesmo FormData — então cada uma precisa
 * ficar bem abaixo de 750 KB.
 */
const MAX_BYTES_PER_PHOTO = 500_000;
/** Abaixo disso não vale o custo de reencodar. */
const MIN_WORTH_COMPRESSING = 250_000;

const COMPRESS_PASSES = [
  { maxEdge: MAX_EDGE, quality: 0.8 },
  { maxEdge: 1400, quality: 0.7 },
  { maxEdge: 1200, quality: 0.6 },
];

/**
 * Reduz a foto no navegador antes de mandar para o servidor.
 *
 * Duas razões: o corpo da requisição tem teto rígido na Vercel e a
 * galeria/listagem carrega bem mais rápido. Qualquer falha devolve o arquivo
 * original — nunca quebra o envio.
 */
async function compressImage(file: File): Promise<File> {
  if (file.size < MIN_WORTH_COMPRESSING) return file;
  if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type)) {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;
    let best: Blob | null = null;
    let bestWidth = sourceWidth;
    let bestHeight = sourceHeight;

    for (const pass of COMPRESS_PASSES) {
      const scale = Math.min(1, pass.maxEdge / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) break;

      ctx.drawImage(bitmap, 0, 0, width, height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", pass.quality),
      );
      if (!blob) break;

      best = blob;
      bestWidth = width;
      bestHeight = height;
      if (blob.size <= MAX_BYTES_PER_PHOTO) break;

      canvas.width = 0;
      canvas.height = 0;
    }
    bitmap.close();

    if (!best) return file;
    // Reduzimos o lado? Então troca mesmo que o peso tenha ficado parecido.
    const downscaled = bestWidth < sourceWidth || bestHeight < sourceHeight;
    if (!downscaled && best.size >= file.size) return file;

    const name = `${file.name.replace(/\.[^.]+$/, "")}.webp`;
    return new File([best], name, { type: "image/webp", lastModified: Date.now() });
  } catch {
    return file;
  }
}

/** Tamanho total das fotos a enviar — teto rígido da Vercel é 4,5 MB. */
function totalUploadBytes(files: File[]): number {
  return files.reduce((sum, file) => sum + file.size, 0);
}

function ImageThumb({
  src,
  onRemove,
}: {
  src: string | null;
  onRemove: () => void;
}) {
  if (!src) return null;

  return (
    <div className="group relative size-20 overflow-hidden rounded-md border bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="size-full object-cover" />
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remover imagem"
        className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center rounded-full bg-background/90 text-muted-foreground opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
