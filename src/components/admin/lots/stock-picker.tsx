"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  COLOR_DOT,
  COLOR_LABELS,
  STICKER_COLORS,
  type LotItemPick,
  type Player,
  type StickerColor,
  type StockItem,
} from "@/lib/stock";

type Props = {
  players: Player[];
  stock: StockItem[];
  items: LotItemPick[];
  onChange: (items: LotItemPick[]) => void;
  disabled?: boolean;
};

/** "Messi" / "MESSÍ" viram "messi" / "messi" para a busca do jogador. */
const normalize = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export function StockPicker({
  players,
  stock,
  items,
  onChange,
  disabled,
}: Props) {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [color, setColor] = useState<StickerColor | null>(null);
  const [qty, setQty] = useState(1);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const listRef = useRef<HTMLUListElement>(null);

  const byId = useMemo(
    () => new Map(stock.map((item) => [item.id, item])),
    [stock],
  );

  const filtered = useMemo(() => {
    const tokens = normalize(query)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length === 0) return players;
    return players.filter((player) => {
      const haystack = normalize(`${player.name} ${player.country}`);
      return tokens.every((token) => haystack.includes(token));
    });
  }, [players, query]);

  useEffect(() => {
    if (!open) return;
    const option = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${highlight}"]`,
    );
    option?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  const selected = useMemo(() => {
    if (!playerId || !color) return null;
    return stock.find((s) => s.player_id === playerId && s.color === color) ?? null;
  }, [stock, playerId, color]);

  const available = selected ? selected.qty_on_hand : null;

  const negatives = useMemo(
    () =>
      items
        .map((pick) => ({ pick, item: byId.get(pick.stock_item_id) }))
        .filter(
          (row) => row.item && row.pick.qty > (row.item.qty_on_hand ?? 0),
        ),
    [items, byId],
  );

  const add = () => {
    if (!selected || qty < 1) return;

    const existing = items.find((p) => p.stock_item_id === selected.id);
    const nextQty = (existing?.qty ?? 0) + qty;

    const next = existing
      ? items.map((p) =>
          p.stock_item_id === selected.id ? { ...p, qty: nextQty } : p,
        )
      : [...items, { stock_item_id: selected.id, qty: nextQty }];

    onChange(next);
    setQty(1);
  };

  const remove = (stockItemId: string) =>
    onChange(items.filter((p) => p.stock_item_id !== stockItemId));

  const choose = (player: Player) => {
    setPlayerId(player.id);
    setQuery(player.name);
    setHighlight(0);
    setOpen(false);
  };

  const onQueryChange = (value: string) => {
    setQuery(value);
    setOpen(true);
    setHighlight(0);

    // Texto editado: a seleção anterior não vale mais.
    if (playerId) {
      const current = players.find((player) => player.id === playerId);
      if (!current || value !== current.name) setPlayerId(null);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlight((index) =>
        Math.min(index + 1, Math.max(filtered.length - 1, 0)),
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlight((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      const player = open ? filtered[highlight] : undefined;
      if (player) {
        event.preventDefault();
        choose(player);
      }
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  const total = items.reduce((sum, pick) => sum + pick.qty, 0);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">Baixa estoque (opcional)</p>
        <span className="text-xs text-muted-foreground">
          {items.length === 0
            ? "nenhum item selecionado"
            : `${items.length} ${items.length === 1 ? "item" : "itens"} · ${total} un.`}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="stock-player">Jogador</Label>
          <div className="relative">
            <Input
              id="stock-player"
              role="combobox"
              aria-expanded={open}
              aria-controls="stock-player-list"
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck={false}
              placeholder="Buscar jogador… nome ou país"
              value={query}
              disabled={disabled}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={onKeyDown}
              onBlur={() => setOpen(false)}
              onFocus={() => {
                const index = filtered.findIndex(
                  (player) => player.id === playerId,
                );
                setHighlight(index >= 0 ? index : 0);
                setOpen(true);
              }}
              className="pr-8"
            />
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

            {open &&
              (filtered.length > 0 ? (
                <ul
                  id="stock-player-list"
                  ref={listRef}
                  role="listbox"
                  className="absolute top-full left-0 z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                >
                  {filtered.map((player, index) => (
                    <li
                      key={player.id}
                      role="option"
                      aria-selected={index === highlight}
                      data-index={index}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(player)}
                      className={`flex cursor-default items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm outline-none ${
                        index === highlight
                          ? "bg-accent text-accent-foreground"
                          : ""
                      }`}
                    >
                      <span className="truncate">{player.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {player.country}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div
                  id="stock-player-list"
                  className="absolute top-full left-0 z-50 mt-1 w-full rounded-md border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-md"
                >
                  Nenhum jogador com “{query}”.
                </div>
              ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_6rem_auto] sm:items-end">
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor="stock-color">Cor</Label>
            <Select
              value={color ?? undefined}
              onValueChange={(value) => setColor(value as StickerColor)}
              disabled={disabled}
            >
              <SelectTrigger id="stock-color" className="w-full min-w-0">
                <SelectValue placeholder="Cor" />
              </SelectTrigger>
              <SelectContent>
                {STICKER_COLORS.map((item) => (
                  <SelectItem key={item} value={item}>
                    <span
                      className={`size-2 rounded-full ${COLOR_DOT[item]}`}
                      aria-hidden
                    />
                    {COLOR_LABELS[item]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor="stock-qty">Quantidade</Label>
            <Input
              id="stock-qty"
              type="number"
              min={1}
              max={999}
              value={qty}
              disabled={disabled}
              onChange={(event) =>
                setQty(Math.max(1, Number(event.target.value) || 1))
              }
              className="w-full tabular-nums"
            />
          </div>

          <Button
            type="button"
            variant="secondary"
            onClick={add}
            disabled={disabled || !selected || qty < 1}
            className="col-span-2 w-full sm:col-span-1 sm:w-auto"
          >
            <Plus />
            Adicionar
          </Button>
        </div>
      </div>

      {selected && available !== null && (
        <p className="text-xs text-muted-foreground">
          Saldo atual de{" "}
          <span className="font-medium text-foreground">
            {selected.player?.name} · {COLOR_LABELS[selected.color]}
          </span>
          : <span className={available < 0 ? "font-semibold text-destructive" : ""}>{available}</span>
        </p>
      )}

      {items.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {items.map((pick) => {
            const item = byId.get(pick.stock_item_id);
            const player = item?.player;
            const low = item && pick.qty > item.qty_on_hand;
            return (
              <li
                key={pick.stock_item_id}
                className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm"
              >
                <span
                  className={`size-2 shrink-0 rounded-full ${item ? COLOR_DOT[item.color] : "bg-muted-foreground"}`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">
                  {player?.name ?? "Item removido do catálogo"}
                  {item ? ` · ${COLOR_LABELS[item.color]}` : ""}
                </span>
                {low && (
                  <span className="text-xs font-medium text-destructive">
                    saldo {item?.qty_on_hand}
                  </span>
                )}
                <span className="tabular-nums text-muted-foreground">
                  {pick.qty} un.
                </span>
                <button
                  type="button"
                  onClick={() => remove(pick.stock_item_id)}
                  disabled={disabled}
                  aria-label="Remover figurinha"
                  className="text-muted-foreground transition hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {negatives.length > 0 && (
        <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Saldo insuficiente em {negatives.length}{" "}
            {negatives.length === 1 ? "item" : "itens"} — o estoque vai ficar
            negativo. Dá para corrigir depois na tela de Estoque.
          </span>
        </p>
      )}
    </div>
  );
}
