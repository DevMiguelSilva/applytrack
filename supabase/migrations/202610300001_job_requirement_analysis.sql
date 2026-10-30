-- Store the source-backed, versioned extraction without rewriting legacy jobs.
-- NULL is intentional: existing records remain visibly legacy until reanalyzed.
alter table public.job_applications
  add column if not exists requirement_analysis jsonb;

-- Include the exact analysis in the database-side tailoring staleness check.
create or replace function public.save_tailored_document_v2(p_document jsonb,p_expected_library jsonb,p_expected_job jsonb,p_owner_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id uuid:=auth.uid(); library jsonb; job public.job_applications; key text;
begin
  if owner_id is null or owner_id is distinct from p_owner_id then raise exception 'Account changed'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
  select document into library from public.master_cvs where user_id=owner_id for update;
  if library is distinct from p_expected_library then raise exception 'CV library changed. Restart tailoring'; end if;
  select * into job from public.job_applications where id=(p_document->>'job_application_id')::uuid and user_id=owner_id for update;
  if job.id is null or job.status<>'saved' or job.deleted_at is not null or job.needs_cv_selection then raise exception 'Application changed. Restart tailoring'; end if;
  foreach key in array array['company','role','location','salary','job_url','job_description','jd_summary','extracted_skills','extracted_requirements','requirement_analysis','claimed_skills','cv_track'] loop
    if to_jsonb(job)->key is distinct from p_expected_job->key then raise exception 'Tailoring inputs changed'; end if;
  end loop;
  insert into public.tailored_documents(id,user_id,job_application_id,master_cv_snapshot,tailored_cv,cover_letter,gap_report,match_score,created_at,updated_at)
  values ((p_document->>'id')::uuid,owner_id,job.id,p_document->'master_cv_snapshot',p_document->'tailored_cv',coalesce(p_document->>'cover_letter',''),coalesce(p_document->'gap_report','{}'::jsonb),(p_document->>'match_score')::integer,coalesce((p_document->>'created_at')::timestamptz,now()),clock_timestamp())
  on conflict(user_id,job_application_id) do update set master_cv_snapshot=excluded.master_cv_snapshot,tailored_cv=excluded.tailored_cv,cover_letter=excluded.cover_letter,gap_report=excluded.gap_report,match_score=excluded.match_score,updated_at=excluded.updated_at;
end; $$;
revoke all on function public.save_tailored_document_v2(jsonb,jsonb,jsonb,uuid) from public, anon;
grant execute on function public.save_tailored_document_v2(jsonb,jsonb,jsonb,uuid) to authenticated;
