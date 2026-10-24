-- Optional product image for the loyalty rewards catalog.
alter table public.loyalty_rewards
  add column if not exists image_path text;

comment on column public.loyalty_rewards.image_path is
  'Optional path in the public lot-images bucket under loyalty-rewards/.';
