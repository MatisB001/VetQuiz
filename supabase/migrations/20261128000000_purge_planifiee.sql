-- Purge nocturne des sessions anonymes sans partie depuis 90 jours (purge_anonymous_sessions, 20261126010000_quiz.sql),
-- promise par la politique de confidentialité (limitation de la conservation, art. 5.1.e RGPD). Demande du 27/11/2026.
-- Rejouable : cron.schedule avec un nom de tâche existant remplace la tâche (« in the manner of an upsert »,
-- supabase.com/docs/guides/database/extensions/pgcron). Heures en GMT (réglage par défaut de pg_cron) :
-- 02 h 30 GMT = 03 h 30 à Paris en hiver, 04 h 30 en été.
-- Si l'extension ne s'active pas ici, l'activer dans le tableau de bord (Database > Extensions > pg_cron) et relancer.
-- Hors Supabase (PostgreSQL local des tests, sans pg_cron) : rien n'est fait.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron absent : purge non planifiée (normal hors Supabase)';
    return;
  end if;
  create extension if not exists pg_cron;
  perform cron.schedule('vq-purge-sessions-anonymes', '30 2 * * *', 'select public.purge_anonymous_sessions()');
  -- L'historique des exécutions (cron.job_run_details) n'est pas nettoyé automatiquement : on garde 30 jours.
  perform cron.schedule('vq-purge-historique-cron', '45 2 * * *',
    $q$delete from cron.job_run_details where end_time < now() - interval '30 days'$q$);
end $$;

-- Vérification (SQL Editor) : les deux tâches, actives.
-- select jobname, schedule, command, active from cron.job where jobname like 'vq-%';
-- Dernières exécutions :
-- select j.jobname, d.status, d.return_message, d.start_time from cron.job_run_details d join cron.job j using (jobid)
--  where j.jobname like 'vq-%' order by d.start_time desc limit 10;
