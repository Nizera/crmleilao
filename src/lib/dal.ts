import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Lot, LotStatus } from "@/lib/lots";
import type { ShippingProfile } from "@/lib/customers";
import type { AdminRole } from "@/lib/roles";
import { DEFAULT_SETTINGS, type AppSettings } from "@/lib/settings";
import { STICKER_COLORS } from "@/lib/stock";
import type { LotItemRow, Player, StockItem, StockMovement } from "@/lib/stock";
import { isChargeActive, type Charge, type ChargeStatus } from "@/lib/charges";
import { CHARGE_COLUMNS } from "@/lib/charges-server";
import {
  type CustomerFreightState,
} from "@/lib/freight";
import { hashInviteToken } from "@/lib/invites";
import { loadNotes } from "@/lib/notes";
import { customerIssueExpression, type CustomerIssue } from "@/lib/admin-list-filters";
import type { Shipment, ShipmentStatus } from "@/lib/shipments";
import type { CustomerNotification } from "@/lib/notifications";
import {
  attachLots,
  SHIPMENT_COLUMNS,
} from "@/lib/shipments-server";

export type { AdminRole };

export type AdminProfile = {
  id: string;
  name: string | null;
  role: AdminRole;
};

export type Customer = {
  id: string;
  name: string | null;
  phone_e164: string;
};

/**
 * Usuário autenticado (qualquer um dos dois fluxos).
 * Retorna null quando não há sessão válida.
 *
 * Usa `getUser()` (valida o token no servidor) e não `getSession()`
 * (que apenas decodifica o cookie).
 */
export const getAuthUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * Guarda do painel interno (/admin). Exige sessão E perfil em admin_profiles.
 * A query é protegida por RLS, então um cliente comum não encontra perfil.
 */
export const requireAdmin = cache(async () => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("admin_profiles")
    .select("id, name, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) redirect("/sem-acesso?motivo=equipe");

  return { user, profile: profile as AdminProfile };
});

/**
 * Guarda do painel do cliente (/painel). Exige sessão E cliente vinculado.
 * O vínculo auth_user_id <-> customers é feito no link de convite.
 */
export const requireCustomer = cache(async () => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/painel/login");

  const { data: customer } = await supabase
    .from("customers")
    .select("id, name, phone_e164")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!customer) redirect("/sem-acesso?motivo=cliente");

  return { user, customer: customer as Customer };
});

export const isAdminRole = (role: AdminRole, required: AdminRole[]) =>
  required.includes(role);

/** Colunas sempre presentes de um lote (listagens e detalhe). */
const LOT_BASE_COLUMNS = [
  "id, code, customer_id, title, arremate_value, status,",
  "charge_id,",
  "auction_date, shipping_date, paid_at, shipped_at, created_at, updated_at,",
  "customer:customers(id, name, phone_e164, auth_user_id)",
].join(" ");

/**
 * `description` (4000 chars), `images` e o embed `items` (até 200 linhas com
 * join de players) vêm **só quando quem chama pede**: em listagem eles eram
 * payload morto — 500 lotes viravam ~3-5 MB e uma URL de `.in()` que o
 * PostgREST nem aceita. Detalhe pede tudo; listagem pede o mínimo.
 */
function lotColumns(opts: {
  description?: boolean;
  images?: boolean;
  items?: boolean;
} = {}): string {
  const extra: string[] = [];
  if (opts.description) extra.push("description");
  if (opts.images) extra.push("images");
  if (opts.items) {
    extra.push(
      "items:lot_items(stock_item_id, player_id, color, qty, applied, " +
        "player:players(id, name, country))",
    );
  }
  return extra.length > 0
    ? `${LOT_BASE_COLUMNS}, ${extra.join(", ")}`
    : LOT_BASE_COLUMNS;
}

/** Detalhe do lote (admin e cliente): tudo que as telas chegam a usar. */
const LOT_COLUMNS = lotColumns({ description: true, images: true, items: true });

/**
 * Todos os lotes. Só a equipe enxerga — o cliente é filtrado pelo RLS.
 * `notes: true` (tela administrativa) anexa as observações internas, que
 * moram em `internal_notes` e são invisíveis para o cliente (migração 0012).
 * `images/items/description` são pedidos por quem chama (ver `lotColumns`).
 */
export const listLots = cache(
  async (
    opts: {
      notes?: boolean;
      images?: boolean;
      items?: boolean;
      description?: boolean;
    } = {},
  ): Promise<Lot[]> => {
    const supabase = await createClient();
    const lots: Lot[] = [];
    for (let from = 0; ; from += 500) {
      const { data, error } = await supabase
      .from("lots")
      .select(
        lotColumns({
          images: opts.images,
          items: opts.items,
          description: opts.description,
        }),
      )
      .order("auction_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + 499);

    if (error) throw new Error(`Falha ao listar lotes: ${error.message}`);

      const page = (data ?? []) as unknown as Lot[];
      lots.push(...page);
      if (page.length < 500) break;
    }
    if (!opts.notes) return lots;

    const notes = await loadNotes(
      "lot",
      lots.map((lot) => lot.id),
    );
    return lots.map((lot) => ({ ...lot, notes: notes.get(lot.id) ?? null }));
  },
);

export type LotPage = {
  rows: Lot[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * Página da listagem admin de lotes. A busca cobre código/título (OR de
 * colunas do próprio lote) e cliente (lookup separado, mesmo teto da busca
 * de cobranças) — tudo coluna top-level de `lots`, então cabe num único OR.
 * A home e o histórico continuam em `listLots`.
 */
export async function listLotsPage(params: {
  q?: string;
  status?: LotStatus | "all";
  page?: number;
  pageSize?: number;
  notes?: boolean;
  startUtc?: string;
  endUtc?: string;
  shippingDate?: string;
}): Promise<LotPage> {
  const supabase = await createClient();
  const pageSize = Math.min(Math.max(params.pageSize ?? 25, 1), 100);
  const page = Math.max(1, params.page ?? 1);

  let query = supabase.from("lots").select(lotColumns(), { count: "exact" });
  if (params.startUtc) query = query.gte("created_at", params.startUtc);
  if (params.endUtc) query = query.lt("created_at", params.endUtc);
  if (params.shippingDate) query = query.eq("shipping_date", params.shippingDate);

  const status = params.status && params.status !== "all" ? params.status : null;
  if (status) query = query.eq("status", status);

  const raw = params.q?.trim().replace(/[,'"%()\\]/g, " ").trim() ?? "";
  if (raw.length >= 2) {
    const digits = raw.replace(/\D/g, "").slice(0, 20);
    const name = raw.replace(/[,'"%()\\]/g, " ").trim().slice(0, 64);

    const filters = [`code.ilike.%${raw}%`, `title.ilike.%${raw}%`];

    const customerFilters: string[] = [];
    if (digits.length >= 4) customerFilters.push(`phone_e164.ilike.%${digits}%`);
    if (name.length >= 2) customerFilters.push(`name.ilike.%${name}%`);
    if (customerFilters.length > 0) {
      const { data: customers } = await supabase
        .from("customers")
        .select("id")
        .or(customerFilters.join(","))
        .limit(CUSTOMER_MATCH_CAP + 1);
      const ids = (customers ?? [])
        .slice(0, CUSTOMER_MATCH_CAP)
        .map((row) => row.id as string);
      if (ids.length > 0) filters.push(`customer_id.in.(${ids.join(",")})`);
    }

    query = query.or(filters.join(","));
  }

  const from = (page - 1) * pageSize;
  const { data, count, error } = await query
    .order("auction_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) throw new Error(`Falha ao listar lotes: ${error.message}`);

  const rows = (data ?? []) as unknown as Lot[];
  if (!params.notes) return { rows, total: count ?? 0, page, pageSize };

  const notes = await loadNotes("lot", rows.map((lot) => lot.id));
  return {
    rows: rows.map((lot) => ({ ...lot, notes: notes.get(lot.id) ?? null })),
    total: count ?? 0,
    page,
    pageSize,
  };
}

export const getLotById = cache(
  async (id: string): Promise<Lot | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("lots")
      .select(LOT_COLUMNS)
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`Falha ao carregar lote: ${error.message}`);
    return (data as unknown as Lot) ?? null;
  },
);

/** Lookup público pelo código curto do lote. RLS decide se o visitante vê. */
export const getLotByCode = cache(async (code: string): Promise<Lot | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lots")
    .select(LOT_COLUMNS)
    .eq("code", code.toUpperCase().trim())
    .maybeSingle();

  if (error) throw new Error(`Falha ao carregar lote: ${error.message}`);
  return (data as unknown as Lot) ?? null;
});

export const listCustomers = cache(async (): Promise<Customer[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("id, name, phone_e164")
    .order("name", { ascending: true, nullsFirst: false });

  if (error) throw new Error(`Falha ao listar clientes: ${error.message}`);
  return (data ?? []) as Customer[];
});

/** Autocomplete por telefone ou nome. Usado no formulário de lote. */
export const searchCustomers = cache(
  async (query: string): Promise<Customer[]> => {
    const raw = query.trim();
    const digits = raw.replace(/\D/g, "").slice(0, 20);
    const name = raw.replace(/[,'"%()\\]/g, " ").trim().slice(0, 64);

    const filters: string[] = [];
    if (digits.length >= 4) filters.push(`phone_e164.ilike.%${digits}%`);
    if (name.length >= 2) filters.push(`name.ilike.%${name}%`);
    if (filters.length === 0) return [];

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("customers")
      .select("id, name, phone_e164")
      .or(filters.join(","))
      .limit(8);

    if (error) throw new Error(`Falha na busca: ${error.message}`);
    return (data ?? []) as Customer[];
  },
);

/* -------------------------------------------------------------------------- */
/*  Clientes (F2) — lista paginada e ficha com histórico                      */
/* -------------------------------------------------------------------------- */

export type CustomerDetail = Customer & {
  email: string | null;
  cpf_cnpj: string | null;
  notes: string | null;
  auth_user_id: string | null;
  created_at: string;
  updated_at: string;
};

const CUSTOMER_COLUMNS =
  "id, name, phone_e164, email, cpf_cnpj, auth_user_id, created_at, updated_at";

export type CustomerPage = {
  rows: CustomerDetail[];
  total: number;
  page: number;
  pageSize: number;
};

export async function listCustomersPage(params: {
  q?: string;
  page?: number;
  pageSize?: number;
  issue?: CustomerIssue;
  lotStartUtc?: string;
  lotEndUtc?: string;
}): Promise<CustomerPage> {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(50, Math.max(5, params.pageSize ?? 10));
  const from = (page - 1) * pageSize;

  const raw = params.q?.trim() ?? "";
  const digits = raw.replace(/\D/g, "").slice(0, 20);
  const name = raw.replace(/[,'"%()\\]/g, " ").trim().slice(0, 64);

  const filters: string[] = [];
  if (digits.length >= 3) filters.push(`phone_e164.ilike.%${digits}%`);
  if (name.length >= 2) filters.push(`name.ilike.%${name}%`);

  let query = supabase
    .from("customers")
    .select(CUSTOMER_COLUMNS + (params.lotStartUtc && params.lotEndUtc ? ",scope_lots:lots!inner()" : ""), { count: "exact" })
    .order("name", { ascending: true, nullsFirst: false })
    .range(from, from + pageSize - 1);

  if (filters.length > 0) query = query.or(filters.join(","));

  const issueExpression = customerIssueExpression(params.issue ?? "all");
  if (issueExpression) query = query.or(issueExpression);
  if (params.issue === "without_access") query = query.is("auth_user_id", null);
  if (params.lotStartUtc && params.lotEndUtc) query = query.gte("scope_lots.created_at", params.lotStartUtc)
    .lt("scope_lots.created_at", params.lotEndUtc).neq("scope_lots.status", "cancelled");

  const { data, count, error } = await query;
  if (error) throw new Error(`Falha ao listar clientes: ${error.message}`);

  const rows = (data ?? []) as unknown as CustomerDetail[];
  const notes = await loadNotes(
    "customer",
    rows.map((row) => row.id),
  );

  return {
    rows: rows.map((row) => ({ ...row, notes: notes.get(row.id) ?? null })),
    total: count ?? 0,
    page,
    pageSize,
  };
}

export const getCustomer = cache(
  async (id: string): Promise<CustomerDetail | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("customers")
      .select(CUSTOMER_COLUMNS)
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`Falha ao carregar cliente: ${error.message}`);
    if (!data) return null;

    const notes = await loadNotes("customer", [id]);
    return { ...(data as CustomerDetail), notes: notes.get(id) ?? null };
  },
);

/**
 * Histórico de lotes de um cliente (painel do cliente e detalhe no admin).
 * Sem `description/images/items`: nenhuma das duas telas renderiza isso numa
 * listagem — só o detalhe do lote carrega (ver `lotColumns`).
 */
export const listCustomerLots = cache(async (customerId: string): Promise<Lot[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lots")
    .select(LOT_BASE_COLUMNS)
    .eq("customer_id", customerId)
    .order("auction_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Falha ao listar lotes do cliente: ${error.message}`);
  return (data ?? []) as unknown as Lot[];
});

export type CustomerLotPage = {
  rows: Lot[];
  total: number;
  page: number;
  pageSize: number;
};

/** Página do histórico de lotes no detalhe do cliente (admin). */
export const listCustomerLotsPage = cache(
  async (customerId: string, page = 1): Promise<CustomerLotPage> => {
    const supabase = await createClient();
    const pageSize = 25;
    const current = Math.max(1, page);
    const from = (current - 1) * pageSize;

    const { data, count, error } = await supabase
      .from("lots")
      .select(LOT_BASE_COLUMNS, { count: "exact" })
      .eq("customer_id", customerId)
      .order("auction_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`Falha ao listar lotes do cliente: ${error.message}`);
    return {
      rows: (data ?? []) as unknown as Lot[],
      total: count ?? 0,
      page: current,
      pageSize,
    };
  },
);

export type CustomerLotStats = {
  total: number;
  active: number;
  totalValue: number;
  paid: number;
  shipped: number;
};

/**
 * Resumo do cliente para os cartões de estatística: só `status` e
 * `arremate_value` (duas colunas leves, sem embed), somado em memória — a
 * lista paginada não enxerga o histórico inteiro e o PostgREST do projeto
 * não tem agregados ligados.
 */
export const getCustomerLotStats = cache(
  async (customerId: string): Promise<CustomerLotStats> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("lots")
      .select("status, arremate_value")
      .eq("customer_id", customerId);

    if (error) throw new Error(`Falha ao resumir lotes do cliente: ${error.message}`);

    const stats: CustomerLotStats = {
      total: 0,
      active: 0,
      totalValue: 0,
      paid: 0,
      shipped: 0,
    };
    for (const row of (data ?? []) as {
      status: LotStatus;
      arremate_value: number | string;
    }[]) {
      stats.total += 1;
      if (row.status !== "cancelled") {
        stats.active += 1;
        stats.totalValue += Number(row.arremate_value);
      }
      if (row.status === "paid") stats.paid += 1;
      if (row.status === "shipped" || row.status === "delivered") stats.shipped += 1;
    }
    return stats;
  },
);

/**
 * Total de unidades por lote, para a coluna "Figurinhas" da listagem admin.
 * Vem `lot_id, qty` (uma linha por item, ~60 B) em vez do embed inteiro com
 * join de players — e só dos lotes pedidos: a paginação manda a página da
 * vez, em pedaços de 200 para a URL do `.in()` não estourar.
 */
export const listLotItemQty = cache(
  async (lotIds: string[]): Promise<Map<string, number>> => {
    const qty = new Map<string, number>();
    const unique = [...new Set(lotIds.filter(Boolean))];
    if (unique.length === 0) return qty;

    const supabase = await createClient();
    for (let i = 0; i < unique.length; i += 200) {
      const { data, error } = await supabase
        .from("lot_items")
        .select("lot_id, qty")
        .in("lot_id", unique.slice(i, i + 200));

      if (error) throw new Error(`Falha ao totalizar itens dos lotes: ${error.message}`);

      for (const row of (data ?? []) as { lot_id: string; qty: number | null }[]) {
        qty.set(row.lot_id, (qty.get(row.lot_id) ?? 0) + Number(row.qty ?? 0));
      }
    }
    return qty;
  },
);

/* -------------------------------------------------------------------------- */
/*  Estoque (F2)                                                              */
/* -------------------------------------------------------------------------- */

const PLAYER_COLUMNS = "id, name, country, sort_order";

export const listPlayers = cache(async (): Promise<Player[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("players")
    .select(PLAYER_COLUMNS)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(`Falha ao listar jogadores: ${error.message}`);
  return (data ?? []) as Player[];
});

const STOCK_ITEM_COLUMNS =
  "id, player_id, color, qty_on_hand, updated_at, player:players(id, name, country, sort_order)";

async function loadStock(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<StockItem[]> {
  const { data, error } = await supabase
    .from("stock_items")
    .select(STOCK_ITEM_COLUMNS)
    .order("color", { ascending: true });

  if (error) throw new Error(`Falha ao carregar estoque: ${error.message}`);

  // Ordena pelo catálogo: sort_order do jogador, depois ordem das cores.
  const colorOrder = STICKER_COLORS;
  return ((data ?? []) as unknown as StockItem[]).sort((a, b) => {
    const playerDiff = (a.player?.sort_order ?? 0) - (b.player?.sort_order ?? 0);
    if (playerDiff !== 0) return playerDiff;
    return colorOrder.indexOf(a.color) - colorOrder.indexOf(b.color);
  });
}

/** Os 80 SKUs com o saldo atual. Só a equipe (RLS). */
export const listStock = cache(async (): Promise<StockItem[]> =>
  loadStock(await createClient()),
);

/**
 * Mesmo estoque com service role: a agregação cacheada do dashboard roda
 * fora do escopo da requisição (sem cookies), então não pode usar sessão.
 */
export async function listStockAdmin(): Promise<StockItem[]> {
  return loadStock(createAdminClient());
}

/** Itens de um lote. O cliente do painel só enxerga os próprios (RLS). */
export const listLotItems = cache(
  async (lotId: string): Promise<LotItemRow[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("lot_items")
      .select(
        "lot_id, stock_item_id, player_id, color, qty, applied, player:players(id, name, country)",
      )
      .eq("lot_id", lotId)
      .order("qty", { ascending: false });

    if (error) throw new Error(`Falha ao carregar itens do lote: ${error.message}`);
    return (data ?? []) as unknown as LotItemRow[];
  },
);

export type StockMovementPage = {
  rows: StockMovement[];
  total: number;
  page: number;
  pageSize: number;
};

export type MovedLotBoxRow = {
  id: string;
  code: string;
  title: string;
  moved_at: string;
  customer: { name: string | null; phone_e164: string } | null;
  items: { qty: number; color: string; applied: boolean; player: { name: string } | null }[];
};

export type MovedLotBoxPage = {
  rows: MovedLotBoxRow[];
  total: number;
  page: number;
  pageSize: number;
};

/** Lotes já separados e ainda guardados na caixa do cliente. */
export async function listLotsInCustomerBoxes(page = 1): Promise<MovedLotBoxPage> {
  const supabase = await createClient();
  const pageSize = 25;
  const currentPage = Math.max(1, Math.floor(page));
  const from = (currentPage - 1) * pageSize;
  const { data, count, error } = await supabase.from("lots")
    .select("id, code, title, moved_at, customer:customers(name, phone_e164), items:lot_items(qty, color, applied, player:players(name))", { count: "exact" })
    .eq("status", "paid").not("moved_at", "is", null)
    .order("moved_at", { ascending: false }).order("id", { ascending: true })
    .range(from, from + pageSize - 1);
  if (error) throw new Error(`Falha ao listar lotes nas caixas dos clientes: ${error.message}`);
  return {
    rows: (data ?? []) as unknown as MovedLotBoxRow[],
    total: count ?? 0,
    page: currentPage,
    pageSize,
  };
}

export async function listMovements(params: {
  page?: number;
  pageSize?: number;
  player_id?: string;
  kind?: string;
}): Promise<StockMovementPage> {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(50, Math.max(5, params.pageSize ?? 15));
  const from = (page - 1) * pageSize;

  let query = supabase
    .from("stock_movements")
    .select(
      "id, stock_item_id, delta, kind, lot_id, note, created_at, created_by, stock_item:stock_items(color, player:players(name))",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (params.player_id) query = query.eq("stock_item_id", params.player_id);
  if (params.kind) query = query.eq("kind", params.kind);

  const { data, count, error } = await query;
  if (error) throw new Error(`Falha ao listar movimentações: ${error.message}`);

  return {
    rows: (data ?? []) as unknown as StockMovement[],
    total: count ?? 0,
    page,
    pageSize,
  };
}

/* -------------------------------------------------------------------------- */
/*  Configuração (F5)                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Parâmetros globais (app_settings).
 * `ready: false` = migração 0004 ainda não aplicada (ou linha ausente);
 * nesse caso volta os defaults do app para a interface não quebrar.
 */
export const getAppSettings = cache(
  async (): Promise<{ settings: AppSettings; ready: boolean }> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("app_settings")
      .select(
        "bid_increment, shipping_weekday, wa_notice_template, wa_payment_template, wa_shipping_template",
      )
      .eq("id", true)
      .maybeSingle();

    if (error || !data) return { settings: DEFAULT_SETTINGS, ready: false };

    // Colunas de origem vêm da migração 0006: ainda não aplicada, viram "".
    const { data: origin } = await supabase
      .from("app_settings")
      .select(
        "origin_name, origin_address, origin_number, origin_district, origin_city, origin_state, origin_cep",
      )
      .eq("id", true)
      .maybeSingle();

    return {
      settings: {
        bid_increment: Number(data.bid_increment) || DEFAULT_SETTINGS.bid_increment,
        shipping_weekday: Number(data.shipping_weekday) || DEFAULT_SETTINGS.shipping_weekday,
        wa_notice_template: data.wa_notice_template,
        wa_payment_template: data.wa_payment_template,
        wa_shipping_template: data.wa_shipping_template,
        origin_name: origin?.origin_name ?? "",
        origin_address: origin?.origin_address ?? "",
        origin_number: origin?.origin_number ?? "",
        origin_district: origin?.origin_district ?? "",
        origin_city: origin?.origin_city ?? "",
        origin_state: origin?.origin_state ?? "",
        origin_cep: origin?.origin_cep ?? "",
      },
      ready: true,
    };
  },
);

export type TeamMember = {
  id: string;
  name: string | null;
  role: AdminRole;
  email: string | null;
  created_at: string;
};

/**
 * Equipe com e-mails: perfis de `admin_profiles` + usuários do Auth.
 * Service role porque admin_profiles não tem policy de escrita e o e-mail
 * mora em auth.users. Usada só na tela de Configuração (dono).
 */
export const listTeam = cache(async (): Promise<TeamMember[]> => {
  const admin = createAdminClient();

  const { data: profiles, error } = await admin
    .from("admin_profiles")
    .select("id, name, role, created_at")
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Falha ao listar equipe: ${error.message}`);

  const usersResult = await admin.auth.admin.listUsers({ perPage: 1000 });
  const users: { id: string; email?: string | null }[] =
    usersResult.error ? [] : usersResult.data.users;
  const emails = new Map(users.map((user) => [user.id, user.email ?? null]));

  return (profiles ?? []).map((profile) => ({
    id: profile.id,
    name: profile.name,
    role: profile.role,
    email: emails.get(profile.id) ?? null,
    created_at: profile.created_at,
  }));
});

/**
 * Endereço do cliente para o envio. `available: false` quando a migração
 * 0004 ainda não aplicou as colunas de endereço.
 */
export const getCustomerShipping = cache(
  async (customerId: string): Promise<ShippingProfile | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("customers")
      .select(
        "name, email, cpf_cnpj, address_cep, address_street, address_number, address_complement, address_district, address_city, address_state",
      )
      .eq("id", customerId)
      .maybeSingle();

    if (error) return null;
    return (data as ShippingProfile) ?? null;
  },
);

/* -------------------------------------------------------------------------- */
/*  Convite de acesso ao painel do cliente (link + senha)                      */
/* -------------------------------------------------------------------------- */

export type InviteStatus = {
  status: "active" | "used" | "expired" | "none";
  expires_at: string | null;
};

/** Convite mais recente do cliente (status para a ficha do admin). */
export const getCustomerInvite = cache(
  async (customerId: string): Promise<InviteStatus> => {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("customer_invites")
      .select("expires_at, used_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return { status: "none", expires_at: null };
    if (data.used_at) return { status: "used", expires_at: data.expires_at };
    if (new Date(data.expires_at) < new Date()) {
      return { status: "expired", expires_at: data.expires_at };
    }
    return { status: "active", expires_at: data.expires_at };
  },
);

export type InvitePreview =
  | { state: "ok"; name: string | null; phone_e164: string }
  | { state: "invalid" | "used" | "expired" };

/** Convites ainda não usados (pendentes) — exibidos em Configuração. */
export type PendingInvite = {
  id: string;
  token: string;
  created_at: string;
  expires_at: string;
  /**
   * Calculado no servidor, junto com os dados. Se o componente de UI calculasse
   * `new Date() < new Date()` no render, o valor divergiria entre o SSR e o
   * browser (e a badge trocaria depois da hidratação).
   */
  expired: boolean;
  customer_id: string;
  name: string | null;
  phone_e164: string;
};

export const listPendingInvites = cache(async (): Promise<PendingInvite[]> => {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("customer_invites")
    .select(
      "id, token, created_at, expires_at, customer:customers(id, name, phone_e164)",
    )
    .is("used_at", null)
    // Convites anteriores à migração 0011 só têm `token_hash` — sem o token
    // cru não dá para remontar o link, e listar geraria `?token=null`.
    .not("token", "is", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error || !data) return [];

  return data.flatMap((row) => {
    if (!row.token) return [];
    const customer = Array.isArray(row.customer)
      ? row.customer[0]
      : row.customer;
    if (!customer) return [];
    return [
      {
        id: row.id,
        token: row.token,
        created_at: row.created_at,
        expires_at: row.expires_at,
        expired: new Date(row.expires_at).getTime() < Date.now(),
        customer_id: customer.id,
        name: customer.name,
        phone_e164: customer.phone_e164,
      },
    ];
  });
});

/**
 * Lê o convite pelo token cru (hash na consulta) para a tela pública
 * /painel/convite. Não expõe dados além do primeiro nome e do número.
 */
export const getInvitePreview = cache(
  async (token: string): Promise<InvitePreview> => {
    if (!token || token.length > 128) return { state: "invalid" };

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("customer_invites")
      .select("expires_at, used_at, customer:customers(name, phone_e164)")
      .eq("token_hash", hashInviteToken(token))
      .maybeSingle();

    if (error || !data) return { state: "invalid" };

    const customer = Array.isArray(data.customer)
      ? data.customer[0]
      : data.customer;
    if (!customer) return { state: "invalid" };
    if (data.used_at) return { state: "used" };
    if (new Date(data.expires_at) < new Date()) return { state: "expired" };

    return {
      state: "ok",
      name: customer.name,
      phone_e164: customer.phone_e164,
    };
  },
);

/* -------------------------------------------------------------------------- */
/*  Cobranças (F3)                                                             */
/* -------------------------------------------------------------------------- */

/** Mesmas colunas magras de CHARGE_COLUMNS (sem QR), cliente `!inner` p/ busca. */
const CHARGE_LIST_COLUMNS = [
  "id, code, customer_id, amount, status, mp_payment_id, external_reference,",
  "description, ticket_url, expires_at, paid_at,",
  "created_by, created_at, updated_at,",
  "customer:customers!inner(id, name, phone_e164),",
  "lots:lots(id, code, title, arremate_value, status)",
].join(" ");

/**
 * Teto de ids de cliente dentro de `customer_id.in.(...)` na busca.
 * Medido contra o PostgREST do projeto: 300 ids (11 KB) responde 200, 500
 * (18,5 KB) já estoura o limite de URL. Acima disso `qTruncated` avisa o
 * admin em vez de sumir com resultado em silêncio.
 */
const CUSTOMER_MATCH_CAP = 300;

export type ChargePage = {
  rows: Charge[];
  total: number;
  page: number;
  pageSize: number;
  /** Busca por cliente atingiu o teto — parte dos resultados ficou de fora. */
  qTruncated?: boolean;
};

export async function listCharges(params: {
  q?: string;
  status?: ChargeStatus | "all";
  page?: number;
  pageSize?: number;
  lotStartUtc?: string;
  lotEndUtc?: string;
  expiring24h?: boolean;
}): Promise<ChargePage> {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(50, Math.max(5, params.pageSize ?? 10));
  const from = (page - 1) * pageSize;

  let query = supabase
    .from("charges")
    .select(CHARGE_LIST_COLUMNS + (params.lotStartUtc && params.lotEndUtc ? ",scope_lots:lots!inner()" : ""), { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (params.status && params.status !== "all") {
    query = query.eq("status", params.status);
  }
  if (params.lotStartUtc && params.lotEndUtc) query = query.gte("scope_lots.created_at", params.lotStartUtc)
    .lt("scope_lots.created_at", params.lotEndUtc).neq("scope_lots.status", "cancelled");
  if (params.expiring24h) {
    const now = Date.now();
    query = query.in("status", ["pending", "in_process"]).gte("expires_at", new Date(now).toISOString())
      .lt("expires_at", new Date(now + 86_400_000).toISOString());
  }

  // Mesma sanitização do `name`: o valor entra dentro de `.or()` do PostgREST
  // (delimitadores `,` `()`, escape `\` e aspas de citação). Sem isso uma
  // busca com apóstrofo quebrava o parse e devolvia erro na listagem.
  const raw = params.q?.trim().replace(/[,'"%()\\]/g, " ").trim() ?? "";
  let qTruncated = false;
  if (raw.length >= 2) {
    const digits = raw.replace(/\D/g, "").slice(0, 20);
    const name = raw.replace(/[,'"%()\\]/g, " ").trim().slice(0, 64);

    const filters = [`code.ilike.%${raw}%`];

    const customerFilters: string[] = [];
    if (digits.length >= 4) customerFilters.push(`phone_e164.ilike.%${digits}%`);
    if (name.length >= 2) customerFilters.push(`name.ilike.%${name}%`);

    if (customerFilters.length > 0) {
      const { data: customers } = await supabase
        .from("customers")
        .select("id")
        .or(customerFilters.join(","))
        .limit(CUSTOMER_MATCH_CAP + 1);

      const matched = customers ?? [];
      qTruncated = matched.length > CUSTOMER_MATCH_CAP;
      const ids = matched
        .slice(0, CUSTOMER_MATCH_CAP)
        .map((row) => row.id as string);
      if (ids.length > 0) filters.push(`customer_id.in.(${ids.join(",")})`);
    }

    query = query.or(filters.join(","));
  }

  const { data, count, error } = await query;
  if (error) throw new Error(`Falha ao listar cobranças: ${error.message}`);

  return {
    rows: (data ?? []) as unknown as Charge[],
    total: count ?? 0,
    page,
    pageSize,
    qTruncated,
  };
}

/** Cobranças de um cliente (painel). RLS já garante que é o próprio. */
export const listCustomerCharges = cache(
  async (customerId: string, limit = 20): Promise<Charge[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("charges")
      .select(CHARGE_COLUMNS)
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      // Migração 0005 ainda não aplicada: painel continua funcionando.
      if (error.code === "42P01" || /relation .*charges/i.test(error.message)) return [];
      // Estouro cai no error boundary do painel: detalhe no log, texto limpo no cliente.
      console.error(`[dal] listar cobranças do cliente: ${error.message}`);
      throw new Error("Não foi possível carregar seus pagamentos. Atualize a página.");
    }
    return (data ?? []) as unknown as Charge[];
  },
);

export type CustomerSpendingSummary = {
  /** Soma dos valores dos lotes pagos; o frete fica fora. */
  paidTotal: number;
  /** Frete das cobranças já pagas, apresentado separadamente dos lotes. */
  paidFreightTotal: number;
  /** Valor total de Pix aprovado (lotes + frete). */
  paidPixTotal: number;
  /** Cobranças pending/in_process ainda dentro do prazo. */
  openAmount: number;
};

/**
 * Resumo financeiro completo do cliente. Busca em páginas para não limitar o
 * total pago aos 20 itens usados na lista recente de cobranças.
 */
export const getCustomerSpendingSummary = cache(
  async (customerId: string): Promise<CustomerSpendingSummary> => {
    const supabase = await createClient();
    const pageSize = 1000;
    let paidCents = 0;
    let paidFreightCents = 0;
    let paidPixCents = 0;
    let openCents = 0;

    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from("charges")
        .select("amount, freight_amount, status, expires_at")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        if (error.code === "42P01" || /relation .*charges/i.test(error.message)) {
          return { paidTotal: 0, paidFreightTotal: 0, paidPixTotal: 0, openAmount: 0 };
        }
        console.error(`[dal] resumo financeiro do cliente: ${error.message}`);
        throw new Error("Não foi possível carregar o resumo financeiro do cliente.");
      }

      const rows = (data ?? []) as {
        amount: number | string;
        freight_amount: number | string | null;
        status: ChargeStatus;
        expires_at: string | null;
      }[];

      for (const row of rows) {
        const amountCents = Math.round(Number(row.amount) * 100);
        const freightCents = Math.round(Number(row.freight_amount ?? 0) * 100);
        if (row.status === "approved") {
          paidCents += Math.max(0, amountCents - freightCents);
          paidFreightCents += freightCents;
          paidPixCents += amountCents;
        } else if (isChargeActive(row)) {
          openCents += amountCents;
        }
      }

      if (rows.length < pageSize) break;
    }

    return {
      paidTotal: paidCents / 100,
      paidFreightTotal: paidFreightCents / 100,
      paidPixTotal: paidPixCents / 100,
      openAmount: openCents / 100,
    };
  },
);

/**
 * Estado do frete semanal do cliente (painel): pago, em aberto (Pix criado),
 * por pagar (tem lote no período) ou sem lote no período.
 */
export const getCustomerFreightState = cache(
  async (customerId: string): Promise<CustomerFreightState> => {
    const {customer}=await requireCustomer();
    if(customer.id!==customerId)throw new Error("Cliente inválido.");
    const supabase = await createClient();
    const {data,error}=await supabase.rpc('get_customer_freight_summary');
    if(error||!data)throw new Error('Não foi possível carregar o frete do período.');
    return data as CustomerFreightState;
  },
);

/**
 * Total de cobranças do cliente: a home lista no máximo 20, mas o badge do
 * histórico precisa mostrar o número real (head-count, sem trazer linhas).
 */
export const countCustomerCharges = cache(
  async (customerId: string): Promise<number> => {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("charges")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId);

    if (error) {
      if (error.code === "42P01" || /relation .*charges/i.test(error.message)) return 0;
      console.error(`[dal] contar cobranças do cliente: ${error.message}`);
      throw new Error("Não foi possível carregar seus pagamentos. Atualize a página.");
    }
    return count ?? 0;
  },
);

export type PaymentKpis = {
  /** Soma dos lotes pagos no mês corrente. */
  monthRevenue: number;
  /** Cobranças abertas (pendentes de pagamento). */
  pendingCharges: number;
  pendingAmount: number;
};

/**
 * KPIs de pagamento do dashboard. Não lança: sem migração 0005, os números
 * de cobrança vêm zerados e o card mostra "—".
 */
export const getPaymentKpis = cache(
  async (): Promise<PaymentKpis & { chargesReady: boolean }> => {
    const supabase = await createClient();
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getFullYear(), now.getMonth(), 1),
    ).toISOString();

    const [lotsResult, chargesResult] = await Promise.all([
      supabase.from("lots").select("arremate_value").gte("paid_at", monthStart),
      supabase
        .from("charges")
        .select("amount, status, expires_at")
        .in("status", ["pending", "in_process"]),
    ]);

    const monthRevenue = (lotsResult.data ?? []).reduce(
      (sum, row) => sum + Number(row.arremate_value ?? 0),
      0,
    );

    const chargesReady = chargesResult.error === null;
    const open = ((chargesResult.data ?? []) as {
      amount: number;
      status: ChargeStatus;
      expires_at: string | null;
    }[]).filter((charge) => isChargeActive(charge));

    return {
      monthRevenue,
      pendingCharges: open.length,
      pendingAmount: open.reduce((sum, charge) => sum + Number(charge.amount), 0),
      chargesReady,
    };
  },
);

/* -------------------------------------------------------------------------- */
/*  Envios (F4)                                                                */
/* -------------------------------------------------------------------------- */

export type ShipmentPage = {
  rows: Shipment[];
  total: number;
  page: number;
  pageSize: number;
  /** Busca por cliente atingiu o teto — parte dos resultados ficou de fora. */
  qTruncated?: boolean;
};

export async function listShipments(params: {
  q?: string;
  status?: ShipmentStatus | "all";
  page?: number;
  pageSize?: number;
}): Promise<ShipmentPage> {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(50, Math.max(5, params.pageSize ?? 10));
  const from = (page - 1) * pageSize;

  let query = supabase
    .from("shipments")
    .select(SHIPMENT_COLUMNS, { count: "exact" })
    .order("batch_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (params.status && params.status !== "all") {
    query = query.eq("status", params.status);
  }

  // Mesma sanitização do `name`: o valor entra dentro de `.or()` do PostgREST
  // (delimitadores `,` `()`, escape `\` e aspas de citação). Sem isso uma
  // busca com apóstrofo quebrava o parse e devolvia erro na listagem.
  const raw = params.q?.trim().replace(/[,'"%()\\]/g, " ").trim() ?? "";
  let qTruncated = false;
  if (raw.length >= 2) {
    const digits = raw.replace(/\D/g, "").slice(0, 20);
    const name = raw.replace(/[,'"%()\\]/g, " ").trim().slice(0, 64);

    const filters = [
      `code.ilike.%${raw}%`,
      `sf_order_id.ilike.%${raw}%`,
      `tracking_code.ilike.%${raw}%`,
    ];

    const customerFilters: string[] = [];
    if (digits.length >= 4) customerFilters.push(`phone_e164.ilike.%${digits}%`);
    if (name.length >= 2) customerFilters.push(`name.ilike.%${name}%`);

    if (customerFilters.length > 0) {
      const { data: customers } = await supabase
        .from("customers")
        .select("id")
        .or(customerFilters.join(","))
        .limit(CUSTOMER_MATCH_CAP + 1);

      const matched = customers ?? [];
      qTruncated = matched.length > CUSTOMER_MATCH_CAP;
      const ids = matched
        .slice(0, CUSTOMER_MATCH_CAP)
        .map((row) => row.id as string);
      if (ids.length > 0) filters.push(`customer_id.in.(${ids.join(",")})`);
    }

    query = query.or(filters.join(","));
  }

  const { data, count, error } = await query;
  if (error) throw new Error(`Falha ao listar envios: ${error.message}`);

  const rows = (data ?? []) as unknown as Shipment[];
  const withLots = await attachLots(rows);

  return { rows: withLots, total: count ?? 0, page, pageSize, qTruncated };
}

/**
 * Envios de um cliente (painel). RLS já garante que é o próprio; a migração
 * 0006 ausente vira lista vazia para o painel não quebrar.
 */
export const listCustomerShipments = cache(
  async (customerId: string, limit = 20): Promise<Shipment[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("shipments")
      .select(SHIPMENT_COLUMNS)
      .eq("customer_id", customerId)
      .order("batch_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      if (error.code === "42P01" || /shipments/i.test(error.message)) return [];
      console.error(`[dal] listar envios do cliente: ${error.message}`);
      throw new Error("Não foi possível carregar seus envios. Atualize a página.");
    }

    return attachLots((data ?? []) as unknown as Shipment[]);
  },
);

/** Total de envios do cliente — mesmo motivo do countCustomerCharges. */
export const countCustomerShipments = cache(
  async (customerId: string): Promise<number> => {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("shipments")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId);

    if (error) {
      if (error.code === "42P01" || /shipments/i.test(error.message)) return 0;
      console.error(`[dal] contar envios do cliente: ${error.message}`);
      throw new Error("Não foi possível carregar seus envios. Atualize a página.");
    }
    return count ?? 0;
  },
);

/* -------------------------------------------------------------------------- */
/*  Notificações do sino (0017)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Defensivo de propósito: a migration pode ainda não ter sido aplicada e as
 * notificações não podem derrubar o painel.
 * Tabela ausente → lista vazia / contagem zero.
 */
const isMissingTable = (error: { code: string; message: string }, table: string) =>
  error.code === "42P01" || new RegExp(table, "i").test(error.message);

/** Últimas notificações do cliente (mais recentes primeiro). */
export const listCustomerNotifications = cache(
  async (customerId: string, limit = 15): Promise<CustomerNotification[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("customer_notifications")
      .select("id, kind, title, body, href, read_at, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      if (isMissingTable(error, "customer_notifications")) return [];
      console.error(`[dal] listar notificações: ${error.message}`);
      return [];
    }
    return (data ?? []) as CustomerNotification[];
  },
);

/** Contagem de não lidas (badge do sino). */
export const countCustomerUnreadNotifications = cache(
  async (customerId: string): Promise<number> => {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("customer_notifications")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId)
      .is("read_at", null);

    if (error) {
      if (isMissingTable(error, "customer_notifications")) return 0;
      console.error(`[dal] contar não lidas: ${error.message}`);
      return 0;
    }
    return count ?? 0;
  },
);

export type CustomerNextShipment = {
  code: string;
  batch_date: string;
  status: Extract<ShipmentStatus, "pending" | "released">;
};

/** Primeiro envio ainda não postado/cancelado/entregue do cliente. */
export const getCustomerNextShipment = cache(
  async (customerId: string): Promise<CustomerNextShipment | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("shipments")
      .select("code, batch_date, status")
      .eq("customer_id", customerId)
      .in("status", ["pending", "released"])
      .order("batch_date", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (isMissingTable(error, "shipments")) return null;
      console.error(`[dal] próximo envio do cliente: ${error.message}`);
      throw new Error("Não foi possível carregar o próximo envio do cliente.");
    }
    return (data as CustomerNextShipment | null) ?? null;
  },
);


