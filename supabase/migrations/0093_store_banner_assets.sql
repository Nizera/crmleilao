begin;
alter table public.store_banner drop constraint store_banner_desktop_path_check;
alter table public.store_banner add constraint store_banner_desktop_path_check check (
 desktop_path ~ '^store-banners/[a-f0-9-]+[.](webp|png|jpg)$'
 or desktop_path ~ '^/store-banners/[a-z0-9-]+[.](webp|png|jpg)$'
);
alter table public.store_banner drop constraint store_banner_mobile_path_check;
alter table public.store_banner add constraint store_banner_mobile_path_check check (
 mobile_path ~ '^store-banners/[a-f0-9-]+[.](webp|png|jpg)$'
 or mobile_path ~ '^/store-banners/[a-z0-9-]+[.](webp|png|jpg)$'
);
alter table public.store_banner drop constraint store_banner_button_href_check;
alter table public.store_banner add constraint store_banner_button_href_check check (
 button_href = '#catalogo-loja' or button_href ~ '^/painel/loja([?][a-zA-Z0-9%&=+_.~-]*)?$'
);
commit;
