-- Run once in a dedicated Supabase project. No emails, keys or passwords in source.
begin;
create table public.vp_team_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null unique check (name in ('Si','Mitch','Ken')),
  role text not null check (role in ('admin','editor')),
  check ((name = 'Si' and role = 'admin') or (name <> 'Si' and role = 'editor'))
);
create table public.vp_workspaces (
  id uuid primary key,
  name text not null check (length(btrim(name)) between 1 and 80),
  data jsonb not null,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id)
);
create table public.vp_activity (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.vp_workspaces(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  actor text not null,
  at timestamptz not null default now(),
  message text not null,
  targets jsonb not null default '[]'::jsonb
);
create index vp_activity_workspace_at on public.vp_activity(workspace_id, at desc);
alter table public.vp_team_members enable row level security;
alter table public.vp_workspaces enable row level security;
alter table public.vp_activity enable row level security;
revoke all on public.vp_team_members, public.vp_workspaces, public.vp_activity from anon, authenticated;
grant select on public.vp_team_members, public.vp_workspaces to authenticated;
create policy own_membership on public.vp_team_members for select to authenticated using (user_id = (select auth.uid()));
create policy approved_workspace_read on public.vp_workspaces for select to authenticated
  using (exists (select 1 from public.vp_team_members m where m.user_id = (select auth.uid())));
-- Clients cannot directly write workspaces, change membership, or forge history.

create function public.vp_validate_data(p_data jsonb) returns void
language plpgsql set search_path = '' as $$
declare t jsonb; item jsonb; seen text[]; dep text; ids text[]; stamp text;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' or p_data->>'version' <> '1'
     or jsonb_typeof(p_data->'tasks') is distinct from 'array'
     or jsonb_typeof(p_data->'meeting') is distinct from 'object'
     or octet_length(p_data::text) > 5000000 then raise exception 'Invalid workspace data'; end if;
  if jsonb_array_length(p_data->'tasks') > 2000 then raise exception 'Too many tasks'; end if;
  select array_agg(x->>'id') into ids from jsonb_array_elements(p_data->'tasks') x;
  if cardinality(ids) <> (select count(distinct x) from unnest(ids) x) then raise exception 'Duplicate task IDs'; end if;
  for t in select value from jsonb_array_elements(p_data->'tasks') loop
    if jsonb_typeof(t) <> 'object' or coalesce(t->>'id','') !~ '^[a-zA-Z0-9_-]{1,100}$'
       or coalesce(t->>'owner','') not in ('Si','Mitch','Ken','Unassigned')
       or coalesce(t->>'status','') not in ('To do','In progress','Waiting','Done')
       or coalesce(t->>'priority','') not in ('1','2','3')
       or jsonb_typeof(t->'priority') is distinct from 'number'
       or coalesce(t->>'dateKind','') not in ('Proposed','Confirmed')
       or jsonb_typeof(t->'review') is distinct from 'boolean'
       or coalesce(length(btrim(t->>'title')),0) not between 1 and 180
       or coalesce(length(btrim(t->>'project')),0) not between 1 and 100
       or jsonb_typeof(t->'checklist') is distinct from 'array' then raise exception 'Invalid task properties'; end if;
    foreach stamp in array array['title','project','next','notes','source','start','end','dependency'] loop
      if jsonb_typeof(t->stamp) is distinct from 'string' or length(t->>stamp) > 20000 then raise exception 'Invalid task field'; end if;
    end loop;
    foreach stamp in array array['start','end'] loop
      if t->>stamp <> '' then
        if t->>stamp !~ '^\d{4}-\d{2}-\d{2}$' or (t->>stamp)::date < date '2020-01-01' or (t->>stamp)::date > date '2100-12-31' then raise exception 'Invalid task date'; end if;
      end if;
    end loop;
    if (t->>'start' = '') <> (t->>'end' = '') or (t->>'start' <> '' and t->>'end' < t->>'start') then raise exception 'Invalid date range'; end if;
    if jsonb_array_length(t->'checklist') > 200 then raise exception 'Checklist too long'; end if;
    for item in select value from jsonb_array_elements(t->'checklist') loop
      if jsonb_typeof(item->'text') is distinct from 'string' or length(item->>'text') > 20000 or jsonb_typeof(item->'done') is distinct from 'boolean' then raise exception 'Invalid checklist'; end if;
    end loop;
    seen := array[t->>'id']; dep := t->>'dependency';
    while dep <> '' loop
      if dep = any(seen) then raise exception 'Dependency cycle'; end if;
      if not coalesce(dep = any(ids),false) then raise exception 'Missing dependency'; end if;
      seen := array_append(seen,dep);
      select x->>'dependency' into dep from jsonb_array_elements(p_data->'tasks') x where x->>'id' = dep;
    end loop;
  end loop;
  t := p_data->'meeting';
  if jsonb_typeof(t->'label') is distinct from 'string' or length(btrim(t->>'label')) not between 1 and 120
     or jsonb_typeof(t->'title') is distinct from 'string' or length(btrim(t->>'title')) not between 1 and 180
     or jsonb_typeof(t->'body') is distinct from 'string' or length(t->>'body') > 30000 then raise exception 'Invalid meeting notes'; end if;
end $$;

create function public.vp_read_workspace(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w public.vp_workspaces; history jsonb;
begin
  if not exists (select 1 from public.vp_team_members where user_id = auth.uid()) then raise exception 'Team access required' using errcode='42501'; end if;
  select * into w from public.vp_workspaces where id=p_id;
  if not found then raise exception 'Workspace not found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'actor',actor,'at',to_char(at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'message',message,'targets',targets) order by at,id),'[]'::jsonb) into history
  from (select * from public.vp_activity where workspace_id=p_id order by at desc,id desc limit 500) a;
  return jsonb_build_object('id',w.id,'name',w.name,'data',w.data,'revision',w.revision,'activity',history);
end $$;

create function public.vp_save_workspace(p_id uuid,p_revision bigint,p_name text,p_data jsonb,p_message text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare who public.vp_team_members; w public.vp_workspaces; t jsonb; old jsonb; stamped jsonb := '[]'::jsonb;
  note jsonb; targets jsonb := '[]'::jsonb; stamp text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select * into who from public.vp_team_members where user_id=auth.uid();
  if not found then raise exception 'Team access required' using errcode='42501'; end if;
  select * into w from public.vp_workspaces where id=p_id for update;
  if not found then raise exception 'Workspace not found'; end if;
  if p_revision is null or w.revision <> p_revision then raise exception 'Workspace changed; reload before saving' using errcode='40001'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 80 or p_message is null or length(p_message) > 1000 then raise exception 'Invalid workspace name or message'; end if;
  if p_name <> w.name and who.role <> 'admin' then raise exception 'Admin required to rename' using errcode='42501'; end if;
  perform public.vp_validate_data(p_data);
  for t in select value from jsonb_array_elements(p_data->'tasks') loop
    select x into old from jsonb_array_elements(w.data->'tasks') x where x->>'id'=t->>'id';
    t := t - 'editedBy' - 'editedAt';
    if old is null or t is distinct from (old - 'editedBy' - 'editedAt') then
      t := t || jsonb_build_object('editedBy',who.name,'editedAt',stamp);
      targets := targets || jsonb_build_array(jsonb_build_object('id',t->>'id','title',t->>'title'));
    else t := old; end if;
    stamped := stamped || jsonb_build_array(t);
  end loop;
  for old in select value from jsonb_array_elements(w.data->'tasks') loop
    if not exists (select 1 from jsonb_array_elements(p_data->'tasks') x where x->>'id'=old->>'id') then
      targets := targets || jsonb_build_array(jsonb_build_object('id',old->>'id','title',old->>'title'));
    end if;
  end loop;
  note := (p_data->'meeting') - 'editedBy' - 'editedAt';
  if note is distinct from ((w.data->'meeting') - 'editedBy' - 'editedAt') then
    note := note || jsonb_build_object('editedBy',who.name,'editedAt',stamp);
    targets := targets || jsonb_build_array(jsonb_build_object('id','meeting','title',note->>'title'));
  else note := w.data->'meeting'; end if;
  update public.vp_workspaces set name=btrim(p_name),data=jsonb_build_object('version',1,'tasks',stamped,'meeting',note),revision=revision+1,updated_at=now(),updated_by=who.user_id where id=p_id;
  insert into public.vp_activity(workspace_id,actor_id,actor,message,targets) values(p_id,who.user_id,who.name,p_message,targets);
  return public.vp_read_workspace(p_id);
end $$;

create function public.vp_create_workspace(p_id uuid,p_name text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare who public.vp_team_members; clean jsonb; t jsonb; stamp text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select * into who from public.vp_team_members where user_id=auth.uid() and role='admin';
  if not found then raise exception 'Admin required' using errcode='42501'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 80 then raise exception 'Invalid workspace name'; end if;
  perform public.vp_validate_data(p_data);
  select coalesce(jsonb_agg((x - 'editedBy' - 'editedAt') || jsonb_build_object('editedBy',who.name,'editedAt',stamp)),'[]'::jsonb) into clean from jsonb_array_elements(p_data->'tasks') x;
  t := (p_data->'meeting') - 'editedBy' - 'editedAt';
  t := t || jsonb_build_object('editedBy',who.name,'editedAt',stamp);
  insert into public.vp_workspaces(id,name,data,updated_by) values(p_id,btrim(p_name),jsonb_build_object('version',1,'tasks',clean,'meeting',t),who.user_id);
  insert into public.vp_activity(workspace_id,actor_id,actor,message,targets) values(p_id,who.user_id,who.name,'Shared workspace created','[]'::jsonb);
  return public.vp_read_workspace(p_id);
end $$;

revoke all on function public.vp_validate_data(jsonb) from public, anon, authenticated;
revoke all on function public.vp_read_workspace(uuid), public.vp_save_workspace(uuid,bigint,text,jsonb,text), public.vp_create_workspace(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.vp_read_workspace(uuid), public.vp_save_workspace(uuid,bigint,text,jsonb,text), public.vp_create_workspace(uuid,text,jsonb) to authenticated;
-- Enable the table for live revision notifications. Database permissions still apply.
alter publication supabase_realtime add table public.vp_workspaces;
commit;
