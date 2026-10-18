import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Lot } from "@/lib/lots";
import type { ShippingProfile } from "@/lib/customers";
import type { AdminRole } from "@/lib/roles";
import { DEFAULT_SETTINGS, type AppSettings } from "@/lib/settings";
import { STICKER_COLORS } from "@/lib/stock";
import type { LotItemRow, Player, StockItem, StockMovement } from "@/lib/stock";
import { isChargeActive, type Charge, type ChargeStatus } from "@/lib/charges";
import { CHARGE_COLUMNS } from "@/lib/charges-server";
import { hashInviteToken } from "@/lib/invites";
import { loadNotes } from "@/lib/notes";
import type { Shipment, ShipmentStatus } from "@/lib/shipments";
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

const LOT_COLUMNS = [
  "id, code, customer_id, title, description, images, arremate_value, status,",
  "charge_id,",
  "auction_date, shipping_date, paid_at, shipped_at, created_at, updated_at,",
  "customer:customers(id, name, phone_e164, auth_user_id),",
  "items:lot_items(stock_item_id, player_id, color, qty, applied,",
  "player:players(id, name, country))",
].join(" ");

/**
 * Todos os lotes. Só a equipe enxerga — o cliente é filtrado pelo RLS.
 * `notes: true` (tela administrativa) anexa as observações internas, que
 * moram em `internal_notes` e são invisíveis para o cliente (migração 0012).
 */
export const listLots = cache(
  async (opts: { notes?: boolean } = {}): Promise<Lot[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("lots")
      .select(LOT_COLUMNS)
      .order("auction_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Falha ao listar lotes: ${error.message}`);

    const lots = (data ?? []) as unknown as Lot[];
    if (!opts.notes) return lots;

    const notes = await loadNotes(
      "lot",
      lots.map((lot) => lot.id),
    );
    return lots.map((lot) => ({ ...lot, notes: notes.get(lot.id) ?? null }));
  },
);

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
    .select(CUSTOMER_COLUMNS, { count: "exact" })
    .order("name", { ascending: true, nullsFirst: false })
    .range(from, from + pageSize - 1);

  if (filters.length > 0) query = query.or(filters.join(","));

  const { data, count, error } = await query;
  if (error) throw new Error(`Falha ao listar clientes: ${error.message}`);

  const rows = (data ?? []) as CustomerDetail[];
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

/** Histórico de lotes de um cliente. */
export const listCustomerLots = cache(async (customerId: string): Promise<Lot[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lots")
    .select(LOT_COLUMNS)
    .eq("customer_id", customerId)
    .order("auction_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Falha ao listar lotes do cliente: ${error.message}`);
  return (data ?? []) as unknown as Lot[];
});

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

/** Os 80 SKUs com o saldo atual. Só a equipe (RLS). */
export const listStock = cache(async (): Promise<StockItem[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_items")
    .select(STOCK_ITEM_COLUMNS)
    .order("color", { ascending: true });

  if (error) throw new Error(`Falha ao carregar estoque: ${error.message}`);

  // Ordena pelo catálogo: sort_order do jogador, depois ordem das cores.
  const colorOrder = STICKER_COLORS;
  return ((data ?? []) as unknown as StockItem[]).sort((a, b) => {
    const playerDiff =
      (a.player?.sort_order ?? 0) - (b.player?.sort_order ?? 0);
    if (playerDiff !== 0) return playerDiff;
    return colorOrder.indexOf(a.color) - colorOrder.indexOf(b.color);
  });
});

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

/** Mesmas colunas de CHARGE_COLUMNS, com o cliente `!inner` p/ busca por nome. */
const CHARGE_LIST_COLUMNS = [
  "id, code, customer_id, amount, status, mp_payment_id, external_reference,",
  "description, qr_code, qr_code_base64, ticket_url, expires_at, paid_at,",
  "created_by, created_at, updated_at,",
  "customer:customers!inner(id, name, phone_e164),",
  "lots:lots(id, code, title, arremate_value, status)",
].join(" ");

export type ChargePage = {
  rows: Charge[];
  total: number;
  page: number;
  pageSize: number;
};

export async function listCharges(params: {
  q?: string;
  status?: ChargeStatus | "all";
  page?: number;
  pageSize?: number;
}): Promise<ChargePage> {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(50, Math.max(5, params.pageSize ?? 10));
  const from = (page - 1) * pageSize;

  let query = supabase
    .from("charges")
    .select(CHARGE_LIST_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (params.status && params.status !== "all") {
    query = query.eq("status", params.status);
  }

  // Mesma sanitização do `name`: o valor entra dentro de `.or()` do PostgREST
  // (delimitadores `,` `()`, escape `\` e aspas de citação). Sem isso uma
  // busca com apóstrofo quebrava o parse e devolvia erro na listagem.
  const raw = params.q?.trim().replace(/[,'"%()\\]/g, " ").trim() ?? "";
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
        .limit(50);

      const ids = (customers ?? []).map((row) => row.id);
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
        .limit(50);

      const ids = (customers ?? []).map((row) => row.id);
      if (ids.length > 0) filters.push(`customer_id.in.(${ids.join(",")})`);
    }

    query = query.or(filters.join(","));
  }

  const { data, count, error } = await query;
  if (error) throw new Error(`Falha ao listar envios: ${error.message}`);

  const rows = (data ?? []) as unknown as Shipment[];
  const withLots = await attachLots(rows);

  return { rows: withLots, total: count ?? 0, page, pageSize };
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


