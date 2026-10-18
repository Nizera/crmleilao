import Link from "next/link";
import { notFound } from "next/navigation";

import { LotStatusBadge } from "@/components/admin/lots/lot-status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LotGallery } from "@/components/client/lot-gallery";
import { getLotByCode, listLotItems, requireCustomer } from "@/lib/dal";
import { getChargeById } from "@/lib/charges-server";
import { isChargeActive } from "@/lib/charges";
import {
  formatBRL,
  formatDateBR,
  lotImageUrl,
} from "@/lib/lots";
import { COLOR_DOT, colorLabel } from "@/lib/stock";

export const metadata = { title: "Detalhe do lote" };

export default async function CustomerLotPage({
  params,
}: PageProps<"/painel/lotes/[code]">) {
  const { code } = await params;
  const { customer } = await requireCustomer();

  const lot = await getLotByCode(code);
  if (!lot || lot.customer_id !== customer.id) notFound();

  const images = lot.images
    .map((path) => lotImageUrl(path))
    .filter((url): url is string => Boolean(url));

  const items = await listLotItems(lot.id);
  const itemsTotal = items.reduce((sum, row) => sum + row.qty, 0);

  // Lote dentro de um Pix: diz qual cobrança o pagou (ou está pendente).
  const charge = lot.charge_id ? await getChargeById(lot.charge_id) : null;
  const ownedCharge = charge && charge.customer_id === customer.id ? charge : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{lot.code}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{lot.title}</h1>
        </div>
        <LotStatusBadge status={lot.status} />
      </div>

      {ownedCharge && (
        <p className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
          {ownedCharge.status === "approved" ? (
            <>
              Pago pelo Pix {ownedCharge.code}
              {ownedCharge.paid_at ? ` em ${formatDateBR(ownedCharge.paid_at.slice(0, 10))}` : ""} ·{" "}
              <Link
                href="/painel/historico"
                className="underline underline-offset-2 transition hover:text-foreground"
              >
                ver histórico
              </Link>
            </>
          ) : isChargeActive(ownedCharge) ? (
            <>
              Lote dentro do Pix {ownedCharge.code}, aguardando pagamento ·{" "}
              <Link
                href="/painel"
                className="underline underline-offset-2 transition hover:text-foreground"
              >
                ir para pagamentos
              </Link>
            </>
          ) : (
            <>
              Pix {ownedCharge.code} não foi concluído ·{" "}
              <Link
                href="/painel"
                className="underline underline-offset-2 transition hover:text-foreground"
              >
                gere outro
              </Link>
            </>
          )}
        </p>
      )}

      {images.length > 0 && <LotGallery images={images} title={lot.title} />}

      <Card>
        <CardHeader>
          <CardTitle>Arremate</CardTitle>
          <CardDescription>
            Valor arrematado e previsão de envio.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Detail label="Valor" value={formatBRL(lot.arremate_value)} />
          <Detail label="Data do leilão" value={formatDateBR(lot.auction_date)} />
          <Detail label="Envio previsto" value={formatDateBR(lot.shipping_date)} />
        </CardContent>
      </Card>

      {items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Figurinhas do lote</CardTitle>
            <CardDescription>
              {itemsTotal} {itemsTotal === 1 ? "figurinha" : "figurinhas"}{" "}
              incluídas no arremate.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 sm:grid-cols-2">
              {items.map((row) => (
                <li
                  key={row.stock_item_id}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={`size-2.5 shrink-0 rounded-full ${COLOR_DOT[row.color]}`}
                      aria-hidden
                    />
                    <span className="truncate">{row.player?.name ?? "—"}</span>
                    <span className="shrink-0 text-muted-foreground">
                      · {colorLabel(row.color)}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">
                    ×{row.qty}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {lot.description && (
        <Card>
          <CardHeader>
            <CardTitle>Sobre o lote</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-relaxed text-muted-foreground">
            {lot.description}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-lg font-medium tabular-nums">{value}</span>
    </div>
  );
}
