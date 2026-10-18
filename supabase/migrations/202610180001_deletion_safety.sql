-- Apply before the deletion-safety frontend. Idempotent; no live data deletion/backfill.
begin;
alter table public.job_applications add column if not exists needs_cv_selection boolean not null default false;
alter table public.saved_searches add column if not exists needs_cv_selection boolean not null default false;
-- Preserve missing-source provenance for new orphaned Inbox candidates; history is untouched.
alter table public.job_inbox add column if not exists needs_cv_selection boolean not null default false;

create or replace function public.purge_trashed_jobs(p_targets jsonb) returns uuid[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare owner_id uuid := auth.uid(); result uuid[];
begin
  if owner_id is null then raise exception 'Sign in before deleting applications'; end if;
  if p_targets is null or jsonb_typeof(p_targets) <> 'array' then raise exception 'Invalid confirmed targets'; end if;
  if jsonb_array_length(p_targets) > 50000 then raise exception 'Too many confirmed targets'; end if;
  if exists(select 1 from jsonb_array_elements(p_targets) t where jsonb_typeof(t) <> 'object' or nullif(t->>'id','') is null or nullif(t->>'deleted_at','') is null) then raise exception 'Invalid confirmed targets'; end if;
  if (select count(*) from jsonb_array_elements(p_targets)) <> (select count(distinct t->>'id') from jsonb_array_elements(p_targets) t) then raise exception 'Duplicate confirmed targets'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
  with removed as (
    delete from public.job_applications j using jsonb_to_recordset(p_targets) as t(id uuid, deleted_at timestamptz)
    where j.user_id=owner_id and j.id=t.id and j.deleted_at is not null and j.deleted_at=t.deleted_at
    returning j.id
  ) select coalesce(array_agg(id),'{}'::uuid[]) into result from removed;
  return result;
end; $$;
revoke all on function public.purge_trashed_jobs(jsonb) from public, anon;
grant execute on function public.purge_trashed_jobs(jsonb) to authenticated;

create or replace function public.validate_cv_template_reference() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare library jsonb; template_id text; marked boolean; available boolean;
begin
  marked:=new.needs_cv_selection;
  if tg_table_name='saved_searches' then template_id:=new.track;
  else
    if new.status<>'saved' then return new; end if;
    template_id:=new.cv_track;
    if tg_op='UPDATE' then
      if old.needs_cv_selection and not marked and template_id is null then raise exception 'Explicitly choose an existing CV'; end if;
      if marked and (new.match_score is distinct from old.match_score or new.claimed_skills is distinct from old.claimed_skills) then raise exception 'Choose a CV before rescoring'; end if;
    end if;
  end if;
  select document into library from public.master_cvs where user_id=new.user_id for share;
  if template_id is null then
    if marked then raise exception 'Missing archived CV reference'; end if;
    return new;
  end if;
  available:= (tg_table_name='saved_searches' and template_id='auto') or coalesce((library->'cvs') ? template_id,false);
  if library is null and template_id in ('frontend','powerPlatform') then available:=true; end if;
  if available and not marked then return new; end if;
  if not available and marked then
    if tg_table_name='saved_searches' then
      if new.active then raise exception 'Choose a CV before activating this search'; end if;
    end if;
    return new;
  end if;
  raise exception 'The selected CV no longer exists. Explicitly choose another CV';
end; $$;
revoke all on function public.validate_cv_template_reference() from public, anon, authenticated;
drop trigger if exists saved_search_cv_reference on public.saved_searches;
create trigger saved_search_cv_reference before insert or update on public.saved_searches for each row execute function public.validate_cv_template_reference();
drop trigger if exists saved_job_cv_reference on public.job_applications;
create trigger saved_job_cv_reference before insert or update on public.job_applications for each row execute function public.validate_cv_template_reference();

-- Old delete_cv_template(text,text,jsonb) remains available to existing clients.
create or replace function public.delete_cv_template_v2(p_template_id text, p_expected_document jsonb, p_owner_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare owner_id uuid:=auth.uid(); current_doc jsonb; next_doc jsonb; next_id text; revision timestamptz;
begin
  if owner_id is null or owner_id is distinct from p_owner_id then raise exception 'Account changed'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
  select document into current_doc from public.master_cvs where user_id=owner_id for update;
  if current_doc is null or p_template_id is null or not ((current_doc->'cvs') ? p_template_id) then raise exception 'The template no longer exists'; end if;
  if current_doc is distinct from p_expected_document then raise exception 'Your CV library changed. Reload before deleting'; end if;
  if (select count(*) from jsonb_object_keys(current_doc->'cvs'))<=1 then raise exception 'Keep at least one CV template'; end if;
  select key into next_id from jsonb_object_keys(current_doc->'cvs') ids(key) where key<>p_template_id order by key collate "C" limit 1;
  next_doc:=jsonb_set(current_doc,'{cvs}',(current_doc->'cvs')-p_template_id);
  next_doc:=jsonb_set(next_doc,'{names}',coalesce(current_doc->'names','{}'::jsonb)-p_template_id);
  next_doc:=jsonb_set(next_doc,'{attachments}',coalesce(current_doc->'attachments','{}'::jsonb)-p_template_id);
  if current_doc->>'activeTrack'=p_template_id then next_doc:=jsonb_set(next_doc,'{activeTrack}',to_jsonb(next_id)); end if;
  revision:=clock_timestamp();next_doc:=jsonb_set(next_doc,'{updatedAt}',to_jsonb(revision));
  update public.master_cvs set document=next_doc,updated_at=revision where user_id=owner_id;
  update public.job_applications set cv_track=p_template_id,needs_cv_selection=true,updated_at=revision
    where user_id=owner_id and status='saved' and (cv_track=p_template_id or (cv_track is null and current_doc->>'activeTrack'=p_template_id));
  update public.saved_searches set active=false,needs_cv_selection=true,updated_at=revision where user_id=owner_id and track=p_template_id;
  update public.job_inbox i set matched_track=null,match_score=0,match_reasons='[]'::jsonb,
    needs_cv_selection= exists(select 1 from public.saved_searches s where s.id=i.saved_search_id and s.user_id=owner_id and s.needs_cv_selection)
      or not exists(select 1 from public.saved_searches s where s.id=i.saved_search_id and s.user_id=owner_id), updated_at=revision
    where i.user_id=owner_id and i.status='new' and (i.matched_track=p_template_id or exists(select 1 from public.saved_searches s where s.id=i.saved_search_id and s.user_id=owner_id and s.track=p_template_id));
  -- No tailored_documents writes: generated files and snapshots remain byte-identical.
  return next_doc;
end; $$;
revoke all on function public.delete_cv_template_v2(text,jsonb,uuid) from public, anon;
grant execute on function public.delete_cv_template_v2(text,jsonb,uuid) to authenticated;

create or replace function public.validate_tailored_document_source() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare job public.job_applications; library jsonb;
begin
  select * into job from public.job_applications where id=new.job_application_id and user_id=new.user_id for share;
  if job.id is null or job.status<>'saved' or job.deleted_at is not null or job.needs_cv_selection then raise exception 'Application or live source unavailable'; end if;
  select document into library from public.master_cvs where user_id=new.user_id for share;
  if not coalesce((library->'cvs') ? coalesce(job.cv_track,library->>'activeTrack'),false) then raise exception 'Source CV unavailable'; end if;
  return new;
end; $$;
revoke all on function public.validate_tailored_document_source() from public, anon, authenticated;
drop trigger if exists tailored_document_live_source on public.tailored_documents;
create trigger tailored_document_live_source before insert or update on public.tailored_documents for each row execute function public.validate_tailored_document_source();

-- Fingerprinted save is serialized with deletion and refuses stale generation after reselection.
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
  foreach key in array array['company','role','location','salary','job_url','job_description','jd_summary','extracted_skills','extracted_requirements','claimed_skills','cv_track'] loop
    if to_jsonb(job)->key is distinct from p_expected_job->key then raise exception 'Tailoring inputs changed'; end if;
  end loop;
  insert into public.tailored_documents(id,user_id,job_application_id,master_cv_snapshot,tailored_cv,cover_letter,gap_report,match_score,created_at,updated_at)
  values ((p_document->>'id')::uuid,owner_id,job.id,p_document->'master_cv_snapshot',p_document->'tailored_cv',coalesce(p_document->>'cover_letter',''),coalesce(p_document->'gap_report','{}'::jsonb),(p_document->>'match_score')::integer,coalesce((p_document->>'created_at')::timestamptz,now()),clock_timestamp())
  on conflict(user_id,job_application_id) do update set master_cv_snapshot=excluded.master_cv_snapshot,tailored_cv=excluded.tailored_cv,cover_letter=excluded.cover_letter,gap_report=excluded.gap_report,match_score=excluded.match_score,updated_at=excluded.updated_at;
end; $$;
revoke all on function public.save_tailored_document_v2(jsonb,jsonb,jsonb,uuid) from public, anon;
grant execute on function public.save_tailored_document_v2(jsonb,jsonb,jsonb,uuid) to authenticated;
-- A refresh dispatched by another tab must not restore a removed source cache.
create or replace function public.validate_inbox_cv_source() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare library jsonb;
begin
  if new.status<>'new' then return new; end if;
  if new.matched_track is not null then
    select document into library from public.master_cvs where user_id=new.user_id for share;
    if not coalesce((library->'cvs') ? new.matched_track,false) then raise exception 'Inbox source changed. Refresh again'; end if;
    if exists(select 1 from public.saved_searches where id=new.saved_search_id and user_id=new.user_id and needs_cv_selection) then raise exception 'Choose a CV for this search'; end if;
  end if;
  return new;
end; $$;
revoke all on function public.validate_inbox_cv_source() from public,anon,authenticated;
drop trigger if exists inbox_live_cv_source on public.job_inbox;
create trigger inbox_live_cv_source before insert or update on public.job_inbox for each row execute function public.validate_inbox_cv_source();
notify pgrst,'reload schema';
commit;
