-- Let an authenticated customer change only their own ranking opt-in flag.
-- Row ownership remains enforced by customers_update_self_or_admin (0009).
grant update (loyalty_rank_visible) on public.customers to authenticated;
