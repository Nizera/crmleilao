create table public.auction_preregistrations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  phone_e164 text not null unique check (phone_e164 ~ '^\+55[1-9][0-9][0-9]{8,9}$'),
  email text check (char_length(email) <= 254),
  attribution jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.auction_preregistrations enable row level security;
revoke all on public.auction_preregistrations from public, anon, authenticated;
grant select, insert on public.auction_preregistrations to service_role;
