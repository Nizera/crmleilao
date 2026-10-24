"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { adjustStock } from "@/app/actions/stock";
import { Button } from "@/components/ui/button";
import { DateBR } from "@/components/ui/date-br";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import type { MovedLotBoxPage, StockMovementPage } from "@/lib/dal";
import {
  COLOR_DOT,
  COLOR_LABELS,
  STICKER_COLORS,
  STOCK_MOVE_LABELS,
  type StockItem,
} from "@/lib/stock";

type Props = {
  stock: StockItem[];
  movements: StockMovementPage;
  movedLots: MovedLotBoxPage;
  /** Aba inicial, vinda da URL (?t=) para a paginação não voltar ao topo. */
  tab?: string;
};

type MatrixRow = {
  player_id: string;
  name: string;
  country: string;
  cells: Partial<Record<string, StockItem>>;
};

export function StockView({ stock, movements, movedLots, tab = "saldo" }: Props) {
  const [selected, setSelected] = useState<StockItem | null>(null);
  const [pending, startTransition] = useTransition();

  const rows = useMemo<MatrixRow[]>(() => {
    const map = new Map<string, MatrixRow>();
    for (const item of stock) {
      const player = item.player;
      if (!player) continue;
      let row = map.get(item.player_id);
      if (!row) {
        row = {
          player_id: item.player_id,
          name: player.name,
          country: player.country,
          cells: {},
        };
        map.set(item.player_id, row);
      }
      row.cells[item.color] = item;
    }
    return [...map.values()];
  }, [stock]);

  const totals = useMemo(() => {
    let units = 0;
    let negatives = 0;
    for (const item of stock) {
      units += item.qty_on_hand;
      if (item.qty_on_hand < 0) negatives += 1;
    }
    return { units, negatives, skus: stock.length };
  }, [stock]);

  const applyAdjust = (formData: FormData) => {
    startTransition(async () => {
      const result = await adjustStock(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Saldo atualizado: ${result.data.qty_on_hand} unidade(s).`,
      );
      setSelected(null);
    });
  };

  const activeTab = ["movimentos", "caixas"].includes(tab) ? tab : "saldo";

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:gap-8 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Estoque</h2>
          <p className="text-sm text-muted-foreground">
            20 jogadores × 4 cores. A baixa acontece quando o lote é movimentado para a caixa do cliente.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-md border px-2 py-1 tabular-nums">
            {totals.skus} SKUs
          </span>
          <span className="rounded-md border px-2 py-1 tabular-nums">
            {totals.units} un. em estoque
          </span>
          {totals.negatives > 0 && (
            <span className="rounded-md border border-destructive/40 px-2 py-1 tabular-nums text-destructive">
              {totals.negatives} negativo(s)
            </span>
          )}
        </div>
      </div>

      <Tabs key={activeTab} defaultValue={activeTab}>
        <TabsList>
          <TabsTrigger value="saldo">Saldo</TabsTrigger>
          <TabsTrigger value="movimentos">
            Movimentações ({movements.total})
          </TabsTrigger>
          <TabsTrigger value="caixas">Caixas ({movedLots.total})</TabsTrigger>
        </TabsList>

        <TabsContent value="saldo" className="flex flex-col gap-4 pt-4">
          {selected && (
            <form
              action={applyAdjust}
              className="flex flex-col gap-3 rounded-lg border p-4"
            >
              <input
                type="hidden"
                name="stock_item_id"
                value={selected.id}
              />
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">
                  Ajustar {selected.player?.name} ·{" "}
                  {COLOR_LABELS[selected.color]}
                </p>
                <span className="text-xs text-muted-foreground">
                  saldo atual{" "}
                  <span
                    className={
                      selected.qty_on_hand < 0
                        ? "font-semibold text-destructive"
                        : "font-medium text-foreground"
                    }
                  >
                    {selected.qty_on_hand}
                  </span>
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
                <div className="grid gap-1.5">
                  <Label htmlFor="adjust-qty">Quantidade</Label>
                  <Input
                    id="adjust-qty"
                    name="qty"
                    inputMode="numeric"
                    required
                    autoFocus
                    placeholder="+10 ou -3"
                    disabled={pending}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="adjust-note">Nota (opcional)</Label>
                  <Input
                    id="adjust-note"
                    name="note"
                    placeholder="Ex.: entrada da compra de 10/10"
                    disabled={pending}
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={pending}>
                    {pending ? "Aplicando…" : "Aplicar"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setSelected(null)}
                    disabled={pending}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                A quantidade é um <strong>delta</strong>: soma no saldo atual.
                Negativo subtrai. Tudo entra no histórico.
              </p>
            </form>
          )}

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Jogador</TableHead>
                  <TableHead>País</TableHead>
                  {STICKER_COLORS.map((color) => (
                    <TableHead key={color} className="text-right">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className={`size-2 rounded-full ${COLOR_DOT[color]}`}
                          aria-hidden
                        />
                        {COLOR_LABELS[color]}
                      </span>
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const rowTotal = STICKER_COLORS.reduce(
                    (sum, color) => sum + (row.cells[color]?.qty_on_hand ?? 0),
                    0,
                  );
                  return (
                    <TableRow key={row.player_id}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.country}
                      </TableCell>
                      {STICKER_COLORS.map((color) => {
                        const item = row.cells[color];
                        const qty = item?.qty_on_hand ?? 0;
                        return (
                          <TableCell key={color} className="text-right">
                            <button
                              type="button"
                              onClick={() => item && setSelected(item)}
                              disabled={!item}
                              className={`min-w-10 rounded-md px-2 py-1 tabular-nums transition hover:bg-accent ${
                                qty < 0 ? "font-semibold text-destructive" : ""
                              } ${selected?.id === item?.id ? "bg-accent" : ""}`}
                              title={`${row.name} · ${COLOR_LABELS[color]} — saldo ${qty}`}
                            >
                              {qty}
                            </button>
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right font-medium tabular-nums">
                        {rowTotal}
                      </TableCell>
                    </TableRow>
                  );
                })}

                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center">
                      <span className="text-muted-foreground">
                        Catálogo vazio — aplique a migração
                        0003_stock.sql para semear os 80 SKUs.
                      </span>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <p className="text-xs text-muted-foreground">
            Clique em um saldo para ajustar. O estoque pode ficar negativo —
            corrija pelo ajuste quando a contagem real entrar.
          </p>
        </TabsContent>

        <TabsContent value="movimentos" className="pt-4">
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Δ</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Nota</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.rows.map((movement) => (
                  <TableRow key={movement.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      <DateBR time value={movement.created_at} />
                    </TableCell>
                    <TableCell>
                      {movement.stock_item?.player?.name ?? "—"}
                      {movement.stock_item ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · {COLOR_LABELS[movement.stock_item.color]}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell
                      className={`text-right font-medium tabular-nums ${
                        movement.delta < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      {movement.delta > 0 ? `+${movement.delta}` : movement.delta}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {STOCK_MOVE_LABELS[movement.kind] ?? movement.kind}
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-muted-foreground">
                      {movement.note ?? (movement.lot_id ? "lote" : "—")}
                    </TableCell>
                  </TableRow>
                ))}

                {movements.rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-28 text-center">
                      <span className="text-muted-foreground">
                        Nenhuma movimentação ainda.
                      </span>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {movements.total > movements.pageSize && (
            <div className="flex items-center justify-between pt-3 text-sm text-muted-foreground">
              <span>
                Página {movements.page} de{" "}
                {Math.max(
                  1,
                  Math.ceil(movements.total / movements.pageSize),
                )}
              </span>
              <div className="flex gap-2">
                {movements.page > 1 ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`?p=${movements.page - 1}&t=movimentos`}>
                      <ChevronLeft />
                      Anterior
                    </Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    <ChevronLeft />
                    Anterior
                  </Button>
                )}

                {movements.page * movements.pageSize < movements.total ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`?p=${movements.page + 1}&t=movimentos`}>
                      Próxima
                      <ChevronRight />
                    </Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    Próxima
                    <ChevronRight />
                  </Button>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="caixas" className="pt-4">
          <p className="mb-3 text-sm text-muted-foreground">Lotes já separados, com a baixa de estoque concluída, aguardando envio.</p>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>Movimentado</TableHead><TableHead>Cliente</TableHead><TableHead>Lote</TableHead><TableHead>Itens na caixa</TableHead></TableRow></TableHeader>
              <TableBody>
                {movedLots.rows.map((lot) => (
                  <TableRow key={lot.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground"><DateBR time value={lot.moved_at} /></TableCell>
                    <TableCell>{lot.customer?.name ?? "Sem nome"}<span className="block text-xs text-muted-foreground">{lot.customer?.phone_e164}</span></TableCell>
                    <TableCell><span className="font-mono font-semibold">{lot.code}</span><span className="block text-xs text-muted-foreground">{lot.title}</span></TableCell>
                    <TableCell>{lot.items.filter((item) => item.applied).length ? lot.items.filter((item) => item.applied).map((item, i) => <span key={`${lot.id}-${i}`} className="mr-1 inline-block rounded border px-2 py-1 text-xs">{item.qty} × {item.player?.name ?? "Item"} · {item.color}</span>) : <span className="text-muted-foreground">Sem itens de estoque</span>}</TableCell>
                  </TableRow>
                ))}
                {movedLots.rows.length === 0 && <TableRow><TableCell colSpan={4} className="h-28 text-center text-muted-foreground">Nenhum lote movimentado aguardando envio.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
          {movedLots.total > movedLots.pageSize && (
            <div className="flex items-center justify-between pt-3 text-sm text-muted-foreground">
              <span>
                Página {movedLots.page} de {Math.ceil(movedLots.total / movedLots.pageSize)}
              </span>
              <div className="flex gap-2">
                {movedLots.page > 1 ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`?t=caixas&bp=${movedLots.page - 1}`}><ChevronLeft />Anterior</Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled><ChevronLeft />Anterior</Button>
                )}
                {movedLots.page * movedLots.pageSize < movedLots.total ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`?t=caixas&bp=${movedLots.page + 1}`}>Próxima<ChevronRight /></Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>Próxima<ChevronRight /></Button>
                )}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
