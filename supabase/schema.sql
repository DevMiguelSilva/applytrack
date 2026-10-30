-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql
-- ApplyTrack v2 schema (safe to re-run)

create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  name text not null default '',
  headline text not null default '',
  skills text not null default '',
  experience_summary text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists job_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  company text not null default '',
  role text not null default '',
  location text not null default '',
  job_url text not null default '',
  salary text not null default '',
  status text not null default 'saved' check (status in ('saved', 'applied', 'interview', 'offer', 'rejected')),
  applied_date text not null default '',
  notes text not null default '',
  job_description text not null default '',
  jd_summary text not null default '',
  extracted_skills jsonb not null default '[]'::jsonb,
  extracted_requirements jsonb not null default '[]'::jsonb,
  requirement_analysis jsonb,
  claimed_skills jsonb not null default '[]'::jsonb,
  source text not null default 'manual',
  external_id text not null default '',
  match_score integer,
  jd_complete boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- v2 columns for existing installs
alter table job_applications add column if not exists source text not null default 'manual';
alter table job_applications add column if not exists external_id text not null default '';
alter table job_applications add column if not exists match_score integer;
alter table job_applications add column if not exists requirement_analysis jsonb;
alter table job_applications add column if not exists jd_summary text not null default '';
alter table job_applications add column if not exists jd_complete boolean;
update job_applications
set jd_complete = (coalesce(source, 'manual') = 'manual')
where jd_complete is null;
alter table job_applications alter column jd_complete set default true;
update job_applications set jd_complete = true where jd_complete is null;
alter table job_applications alter column jd_complete set not null;
alter table job_applications add column if not exists deleted_at timestamptz;
alter table job_applications add column if not exists claimed_skills jsonb;
update job_applications set claimed_skills = '[]'::jsonb where claimed_skills is null;
alter table job_applications alter column claimed_skills set default '[]'::jsonb;
update job_applications set claimed_skills = '[]'::jsonb where claimed_skills is null;
alter table job_applications alter column claimed_skills set not null;

create table if not exists saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  label text not null default '',
  query text not null default '',
  location text not null default '',
  country text not null default 'ca',
  max_days_old integer not null default 7,
  exclude_terms text not null default '',
  query_mode text not null default 'any',
  what_or text not null default '',
  what_and text not null default '',
  what_phrase text not null default '',
  track text not null default 'auto' ,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table saved_searches add column if not exists track text not null default 'auto';
alter table saved_searches add column if not exists sort_order integer not null default 0;
alter table saved_searches add column if not exists query_mode text not null default 'any';
alter table saved_searches add column if not exists what_or text not null default '';
alter table saved_searches add column if not exists what_and text not null default '';
alter table saved_searches add column if not exists what_phrase text not null default '';
alter table job_applications add column if not exists saved_search_id uuid references saved_searches on delete set null;
alter table job_applications add column if not exists cv_track text;
alter table job_applications add column if not exists interview_stage text;
alter table job_applications add column if not exists interview_date text not null default '';
alter table job_applications drop constraint if exists job_applications_interview_stage_check;
alter table job_applications add constraint job_applications_interview_stage_check
  check (interview_stage is null or interview_stage in ('preparing', 'waiting'));
alter table job_applications add column if not exists interviews jsonb not null default '[]'::jsonb;
alter table job_applications add column if not exists not_selected boolean not null default false;
alter table job_applications add column if not exists needs_rescore boolean not null default false;

create table if not exists job_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  external_id text not null,
  source text not null default 'adzuna',
  company text not null default '',
  role text not null default '',
  location text not null default '',
  job_url text not null default '',
  salary text not null default '',
  description text not null default '',
  match_score integer not null default 0,
  match_reasons jsonb not null default '[]'::jsonb,
  status text not null default 'new' check (status in ('new', 'approved', 'dismissed')),
  saved_search_id uuid references saved_searches on delete set null,
  seen_count integer not null default 1,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, external_id)
);

alter table job_inbox add column if not exists matched_track text;
alter table job_inbox add column if not exists seen_count integer;
update job_inbox set seen_count = 1 where seen_count is null;
alter table job_inbox alter column seen_count set default 1;
update job_inbox set seen_count = 1 where seen_count is null;
alter table job_inbox alter column seen_count set not null;

create table if not exists master_cvs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null unique,
  document jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists tailored_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  job_application_id uuid references job_applications on delete cascade not null,
  master_cv_snapshot jsonb not null default '{}'::jsonb,
  tailored_cv jsonb not null default '{}'::jsonb,
  cover_letter text not null default '',
  gap_report jsonb not null default '{}'::jsonb,
  match_score integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, job_application_id)
);

alter table profiles enable row level security;
alter table job_applications enable row level security;
alter table saved_searches enable row level security;
alter table job_inbox enable row level security;
alter table master_cvs enable row level security;
alter table tailored_documents enable row level security;

-- Profiles policies
drop policy if exists "Users read own profile" on profiles;
drop policy if exists "Users insert own profile" on profiles;
drop policy if exists "Users update own profile" on profiles;
create policy "Users read own profile" on profiles for select using (auth.uid() = id);
create policy "Users insert own profile" on profiles for insert with check (auth.uid() = id);
create policy "Users update own profile" on profiles for update using (auth.uid() = id);

-- Job applications policies
drop policy if exists "Users read own jobs" on job_applications;
drop policy if exists "Users insert own jobs" on job_applications;
drop policy if exists "Users update own jobs" on job_applications;
drop policy if exists "Users delete own jobs" on job_applications;
create policy "Users read own jobs" on job_applications for select using (auth.uid() = user_id);
create policy "Users insert own jobs" on job_applications for insert with check (auth.uid() = user_id);
create policy "Users update own jobs" on job_applications for update using (auth.uid() = user_id);
create policy "Users delete own jobs" on job_applications for delete using (auth.uid() = user_id);

-- Saved searches policies
drop policy if exists "Users read own searches" on saved_searches;
drop policy if exists "Users insert own searches" on saved_searches;
drop policy if exists "Users update own searches" on saved_searches;
drop policy if exists "Users delete own searches" on saved_searches;
create policy "Users read own searches" on saved_searches for select using (auth.uid() = user_id);
create policy "Users insert own searches" on saved_searches for insert with check (auth.uid() = user_id);
create policy "Users update own searches" on saved_searches for update using (auth.uid() = user_id);
create policy "Users delete own searches" on saved_searches for delete using (auth.uid() = user_id);

-- Inbox policies
drop policy if exists "Users read own inbox" on job_inbox;
drop policy if exists "Users insert own inbox" on job_inbox;
drop policy if exists "Users update own inbox" on job_inbox;
drop policy if exists "Users delete own inbox" on job_inbox;
create policy "Users read own inbox" on job_inbox for select using (auth.uid() = user_id);
create policy "Users insert own inbox" on job_inbox for insert with check (auth.uid() = user_id);
create policy "Users update own inbox" on job_inbox for update using (auth.uid() = user_id);
create policy "Users delete own inbox" on job_inbox for delete using (auth.uid() = user_id);

-- Master CV policies
drop policy if exists "Users read own master cv" on master_cvs;
drop policy if exists "Users insert own master cv" on master_cvs;
drop policy if exists "Users update own master cv" on master_cvs;
create policy "Users read own master cv" on master_cvs for select using (auth.uid() = user_id);
create policy "Users insert own master cv" on master_cvs for insert with check (auth.uid() = user_id);
create policy "Users update own master cv" on master_cvs for update using (auth.uid() = user_id);

-- Tailored documents policies
drop policy if exists "Users read own tailored docs" on tailored_documents;
drop policy if exists "Users insert own tailored docs" on tailored_documents;
drop policy if exists "Users update own tailored docs" on tailored_documents;
drop policy if exists "Users delete own tailored docs" on tailored_documents;
create policy "Users read own tailored docs" on tailored_documents for select using (auth.uid() = user_id);
create policy "Users insert own tailored docs" on tailored_documents for insert with check (auth.uid() = user_id);
create policy "Users update own tailored docs" on tailored_documents for update using (auth.uid() = user_id);
create policy "Users delete own tailored docs" on tailored_documents for delete using (auth.uid() = user_id);

create table if not exists portal_feeds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  name text not null default '',
  url text not null default '',
  source text not null default 'other' check (source in ('indeed', 'ziprecruiter', 'linkedin', 'other')),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists hunt_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  day date not null,
  checked_feed_ids jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);

alter table portal_feeds enable row level security;
alter table hunt_days enable row level security;

drop policy if exists "Users read own portal feeds" on portal_feeds;
drop policy if exists "Users insert own portal feeds" on portal_feeds;
drop policy if exists "Users update own portal feeds" on portal_feeds;
drop policy if exists "Users delete own portal feeds" on portal_feeds;
create policy "Users read own portal feeds" on portal_feeds for select using (auth.uid() = user_id);
create policy "Users insert own portal feeds" on portal_feeds for insert with check (auth.uid() = user_id);
create policy "Users update own portal feeds" on portal_feeds for update using (auth.uid() = user_id);
create policy "Users delete own portal feeds" on portal_feeds for delete using (auth.uid() = user_id);

drop policy if exists "Users read own hunt days" on hunt_days;
drop policy if exists "Users insert own hunt days" on hunt_days;
drop policy if exists "Users update own hunt days" on hunt_days;
drop policy if exists "Users delete own hunt days" on hunt_days;
create policy "Users read own hunt days" on hunt_days for select using (auth.uid() = user_id);
create policy "Users insert own hunt days" on hunt_days for insert with check (auth.uid() = user_id);
create policy "Users update own hunt days" on hunt_days for update using (auth.uid() = user_id);
create policy "Users delete own hunt days" on hunt_days for delete using (auth.uid() = user_id);

create index if not exists job_applications_user_id_idx on job_applications (user_id);
create index if not exists saved_searches_user_id_idx on saved_searches (user_id);
create index if not exists job_inbox_user_id_status_idx on job_inbox (user_id, status);
create index if not exists tailored_documents_job_idx on tailored_documents (job_application_id);
create index if not exists portal_feeds_user_id_idx on portal_feeds (user_id);
create index if not exists hunt_days_user_day_idx on hunt_days (user_id, day);

-- Dynamic CV library and atomic, owner-scoped deletion.
-- Apply before releasing the dynamic CV-library frontend. Safe to re-run.
begin;
alter table public.saved_searches drop constraint if exists saved_searches_track_check;

create or replace function public.delete_cv_template(
  p_template_id text, p_replacement_id text, p_expected_document jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  owner_id uuid := auth.uid();
  current_doc jsonb;
  next_doc jsonb;
  replacement text;
  cv_count integer;
  affected integer;
begin
  if owner_id is null then raise exception 'Sign in to manage CV templates'; end if;
  select document into current_doc from public.master_cvs where user_id = owner_id for update;
  if current_doc is null or not ((current_doc->'cvs') ? p_template_id) then
    raise exception 'The template no longer exists';
  end if;
  if current_doc is distinct from p_expected_document then
    raise exception 'Your CV library changed in another session. Reload before deleting';
  end if;
  select count(*) into cv_count from jsonb_object_keys(current_doc->'cvs');
  if cv_count <= 1 then raise exception 'Keep at least one CV template'; end if;
  select count(*) into affected from (
    select id from public.job_applications where user_id = owner_id and status = 'saved'
      and (cv_track = p_template_id or (cv_track is null and current_doc->>'activeTrack' = p_template_id))
    union all
    select id from public.saved_searches where user_id = owner_id and track = p_template_id
  ) refs;
  if affected > 0 and nullif(p_replacement_id, '') is null then
    raise exception 'Choose a replacement for affected Saved jobs and searches';
  end if;
  replacement := nullif(p_replacement_id, '');
  if replacement is null then
    select key into replacement from jsonb_object_keys(current_doc->'cvs') as ids(key)
    where key <> p_template_id order by key limit 1;
  end if;
  if replacement = p_template_id or not ((current_doc->'cvs') ? replacement) then
    raise exception 'Choose an existing replacement template';
  end if;
  next_doc := jsonb_set(current_doc, '{cvs}', (current_doc->'cvs') - p_template_id);
  next_doc := jsonb_set(next_doc, '{names}', coalesce(next_doc->'names', '{}'::jsonb) - p_template_id);
  next_doc := jsonb_set(next_doc, '{attachments}', coalesce(next_doc->'attachments', '{}'::jsonb) - p_template_id);
  if current_doc->>'activeTrack' = p_template_id then
    next_doc := jsonb_set(next_doc, '{activeTrack}', to_jsonb(replacement));
  end if;
  next_doc := jsonb_set(next_doc, '{updatedAt}', to_jsonb(now()));

  update public.job_applications set cv_track = replacement, needs_rescore = true,
    match_score = null, updated_at = now()
  where user_id = owner_id and status = 'saved'
    and (cv_track = p_template_id or (cv_track is null and current_doc->>'activeTrack' = p_template_id));
  update public.saved_searches set track = replacement, updated_at = now()
  where user_id = owner_id and track = p_template_id;
  update public.job_inbox set matched_track = replacement, match_score = 0,
    match_reasons = '[]'::jsonb, updated_at = now()
  where user_id = owner_id and matched_track = p_template_id;
  update public.master_cvs set document = next_doc, updated_at = now() where user_id = owner_id;
  return next_doc;
end;
$$;
revoke all on function public.delete_cv_template(text, text, jsonb) from public, anon;
grant execute on function public.delete_cv_template(text, text, jsonb) to authenticated;

-- Reject stale clients that try to restore references to deleted templates.
create or replace function public.validate_cv_template_reference()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare library jsonb; template_id text;
begin
  if tg_table_name = 'saved_searches' then
    template_id := new.track;
    if template_id = 'auto' then return new; end if;
  else
    if new.status <> 'saved' or new.cv_track is null then return new; end if;
    template_id := new.cv_track;
  end if;
  select document into library from public.master_cvs where user_id = new.user_id for share;
  -- Existing clients can create the legacy choices before their library is initialized.
  if library is null or not (library ? 'cvs') then
    if template_id in ('frontend', 'powerPlatform') then return new; end if;
  elsif (library->'cvs') ? template_id then
    return new;
  end if;
  raise exception 'The selected CV template no longer exists. Choose another CV';
end;
$$;
revoke all on function public.validate_cv_template_reference() from public, anon, authenticated;
drop trigger if exists saved_search_cv_reference on public.saved_searches;
create trigger saved_search_cv_reference before insert or update of track on public.saved_searches
for each row execute function public.validate_cv_template_reference();
drop trigger if exists saved_job_cv_reference on public.job_applications;
create trigger saved_job_cv_reference before insert or update of cv_track, status on public.job_applications
for each row execute function public.validate_cv_template_reference();

notify pgrst, 'reload schema';
commit;

-- Deletion safety v2 (202610180001)
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
  foreach key in array array['company','role','location','salary','job_url','job_description','jd_summary','extracted_skills','extracted_requirements','requirement_analysis','claimed_skills','cv_track'] loop
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
