alter table public.auction_preregistrations
  add column status text not null default 'new'
    check (status in ('new', 'contacted', 'joined', 'converted', 'closed')),
  add column status_updated_at timestamptz,
  add column status_updated_by uuid references public.admin_profiles(id) on delete set null,
  add column email_status text not null default 'pending'
    check (email_status in ('pending', 'sending', 'accepted', 'failed', 'unconfigured')),
  add column email_attempted_at timestamptz;

create index auction_preregistrations_recent_idx
  on public.auction_preregistrations (created_at desc, id desc);
create index auction_preregistrations_status_idx
  on public.auction_preregistrations (status, created_at desc, id desc);
grant update on public.auction_preregistrations to service_role;
