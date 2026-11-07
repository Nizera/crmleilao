-- Conferência SOMENTE LEITURA da agenda; não mostra segredos nem comandos HTTP.
select jobid,jobname,schedule,active
from cron.job where jobname='ocdl-raffle-expiration';

select d.status,d.start_time,d.end_time,d.return_message
from cron.job_run_details d join cron.job j on j.jobid=d.jobid
where j.jobname='ocdl-raffle-expiration'
order by d.start_time desc limit 10;

-- Um job SQL bem-sucedido pode apenas enfileirar HTTP; verificar também o retorno.
select r.id,r.status_code,r.timed_out,r.created
from net._http_response r
order by r.created desc limit 10;
