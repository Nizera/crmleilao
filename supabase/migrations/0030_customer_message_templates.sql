-- Padronização solicitada: mensagens por cliente, sem depender do código do lote.
begin;
update public.app_settings set
 wa_notice_template=E'Olá {name}! Acompanhe seus arremates, pagamentos e envios no nosso painel: {link}\nOs novos lotes aparecem automaticamente por lá.',
 wa_payment_template=E'Olá {name}! Seu valor total pendente é {value} (lotes e fretes devidos).\nConfira os detalhes e pague pelo painel: {link}\nO total é atualizado conforme seus arremates e pagamentos.',
 wa_shipping_template=E'Olá {name}! A etiqueta dos seus arremates do período de {period_start} a {period_end} foi emitida.\nRastreio: {tracking}\n{tracking_link}\nAcompanhe pelo painel: {link}'
 where id=true;
commit;
