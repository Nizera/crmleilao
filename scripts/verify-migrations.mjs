import fs from "fs";

const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const secret = env.SUPABASE_SECRET_KEY;
const anon = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const results = [];
const log = (name, ok, detail) => results.push({ name, ok, detail });

async function q(key, path) {
  const r = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const body = await r.text();
  return { status: r.status, body };
}

async function rpc(key, fn, args = {}) {
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const body = await r.text();
  return { status: r.status, body };
}

(async () => {
  // 1. customer_invites.token (0011)
  {
    const r = await q(secret, "customer_invites?select=id,token,token_hash&limit=1");
    log("0011 customer_invites.token existe", r.status === 200, `HTTP ${r.status} ${r.body.slice(0, 120)}`);
  }

  // 2. rate_limits + RLS fechada (0010)
  {
    const r1 = await q(secret, "rate_limits?select=key&limit=1");
    log("0010 tabela rate_limits (service role)", r1.status === 200, `HTTP ${r1.status}`);
    const r2 = await q(anon, "rate_limits?select=key&limit=1");
    // revoke total → 401/403 (42501). Se um dia virar 200 com [], também vale.
    const hidden =
      r2.status === 401 || r2.status === 403 || (r2.status === 200 && r2.body.trim() === "[]");
    log("0010 rate_limits inacessível p/ anon", hidden, `HTTP ${r2.status} ${r2.body.slice(0, 140)}`);
  }

  // 3. bump_rate_limit: service_role executa; anon não pode
  {
    const r1 = await rpc(secret, "bump_rate_limit", { p_key: "verify", p_limit: 999, p_window_seconds: 60 });
    log("0010 bump_rate_limit (service_role)", r1.status === 200 && r1.body === "true", `HTTP ${r1.status} ${r1.body.slice(0, 120)}`);
    const r2 = await rpc(anon, "bump_rate_limit", { p_key: "verify", p_limit: 999, p_window_seconds: 60 });
    const denied = r2.status >= 400 && /permission|denied|does not exist/i.test(r2.body);
    log("0010 bump_rate_limit negado p/ anon", denied, `HTTP ${r2.status} ${r2.body.slice(0, 140)}`);
  }

  // 4. add_admin revogado de anon/authenticated (CRITICAL 0009)
  // Usa um e-mail inventado: se por acaso a revogação não pegasse, a função
  // cairia em "usuário não encontrado" (FK em auth.users) — não cria admin.
  {
    const r = await rpc(anon, "add_admin", {
      p_email: "__migration_probe__@invalid.example",
      p_role: "owner",
      p_name: "probe",
    });
    const denied = /permission denied for function/i.test(r.body);
    log(
      "0009 add_admin negado p/ anon",
      denied,
      denied ? "OK (permission denied)" : `ATENÇÃO HTTP ${r.status} ${r.body.slice(0, 180)}`,
    );
  }

  // 5. has_staff_write existe (0009)
  {
    const r = await rpc(secret, "has_staff_write");
    log("0009 has_staff_write existe", r.status === 200, `HTTP ${r.status} ${r.body.slice(0, 120)}`);
  }

  // 6. app_secrets invisível p/ anon (0009)
  {
    const r1 = await q(secret, "app_secrets?select=key&limit=1");
    log("0009 tabela app_secrets (service role)", r1.status === 200, `HTTP ${r1.status} ${r1.body.slice(0, 140)}`);
    const r2 = await q(anon, "app_secrets?select=key&limit=1");
    log("0009 app_secrets invisível p/ anon", r2.status === 200 && r2.body.trim() === "[]", `HTTP ${r2.status} ${r2.body.slice(0, 140)}`);
  }

  // 7. internal_notes existe e é invisível para anon (0012)
  {
    const r1 = await q(secret, "internal_notes?select=id,entity_type,entity_id&limit=1");
    log("0012 tabela internal_notes (service role)", r1.status === 200, `HTTP ${r1.status} ${r1.body.slice(0, 140)}`);
    const r2 = await q(anon, "internal_notes?select=id&limit=1");
    const hidden =
      r2.status === 401 || r2.status === 403 || (r2.status === 200 && r2.body.trim() === "[]");
    log("0012 internal_notes inacessível p/ anon", hidden, `HTTP ${r2.status} ${r2.body.slice(0, 140)}`);
  }

  // 8. coluna `notes` saiu das tabelas dos clientes (0012).
  // Se a migração ainda não rodou, PostgREST responde 200 e denuncia o vazamento.
  for (const table of ["customers", "lots"]) {
    const r = await q(secret, `${table}?select=notes&limit=1`);
    const dropped = r.status >= 400 && /notes/i.test(r.body);
    log(`0012 ${table}.notes removida`, dropped, `HTTP ${r.status} ${r.body.slice(0, 160)}`);
  }

  let fail = 0;
  for (const r of results) {
    if (!r.ok) fail++;
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : "  -> " + r.detail}`);
  }
  console.log(`\n${results.length - fail}/${results.length} ok`);
  process.exit(fail ? 1 : 0);
})();
