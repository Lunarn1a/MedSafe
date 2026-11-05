-- MedSafe database setup, version 1.
-- Run this entire file ONCE in your new Supabase project's SQL Editor.
-- Supabase Auth stores accounts/passwords; these tables hold application data.
-- This transaction creates tables and access rules. It does not delete data.
-- If any statement fails, run ROLLBACK; before fixing and retrying.

begin;

-- Helper functions are kept outside the public Data API schema.
create schema if not exists medsafe_private;
revoke all on schema medsafe_private from public, anon;
grant usage on schema medsafe_private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  role text not null check (role in ('patient', 'caregiver')),
  date_of_birth date check (date_of_birth between date '1900-01-01' and current_date),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, role)
);

create table public.caregiver_links (
  patient_id uuid not null,
  caregiver_id uuid not null,
  -- Composite foreign keys enforce the two account types in the database.
  patient_role text not null default 'patient' check (patient_role = 'patient'),
  caregiver_role text not null default 'caregiver' check (caregiver_role = 'caregiver'),
  can_edit boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (patient_id, caregiver_id),
  check (patient_id <> caregiver_id),
  foreign key (patient_id, patient_role) references public.profiles(id, role) on delete cascade,
  foreign key (caregiver_id, caregiver_role) references public.profiles(id, role) on delete cascade
);
create index caregiver_links_caregiver_idx on public.caregiver_links(caregiver_id);

create table public.medicines (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null,
  patient_role text not null default 'patient' check (patient_role = 'patient'),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  dosage text not null default '' check (char_length(dosage) <= 200),
  frequency text not null default '' check (char_length(frequency) <= 100),
  stock integer not null default 0 check (stock >= 0),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (patient_id, patient_role) references public.profiles(id, role) on delete cascade
);
create index medicines_patient_idx on public.medicines(patient_id);

-- Explicitly enable RLS even when automatic RLS was selected in the dashboard.
alter table public.profiles enable row level security;
alter table public.caregiver_links enable row level security;
alter table public.medicines enable row level security;

-- Remove automatic broad grants and grant only the app operations below.
revoke all on public.profiles, public.caregiver_links, public.medicines
  from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.profiles, public.caregiver_links, public.medicines to authenticated;
grant insert (id, display_name, role, date_of_birth) on public.profiles to authenticated;
grant update (display_name, date_of_birth) on public.profiles to authenticated;
grant insert (patient_id, caregiver_id, can_edit) on public.caregiver_links to authenticated;
grant update (can_edit) on public.caregiver_links to authenticated;
grant delete on public.caregiver_links to authenticated;
grant insert (patient_id, name, dosage, frequency, stock) on public.medicines to authenticated;
grant update (name, dosage, frequency, stock) on public.medicines to authenticated;
grant delete on public.medicines to authenticated;

-- These narrow helpers avoid recursive RLS queries. Fully qualified names and
-- an empty search_path prevent callers from substituting database objects.
-- They always use the signed-in user's ID, never a caller-supplied actor ID.
create function medsafe_private.can_read_patient(target_patient uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and (
    target_patient = auth.uid() or exists (
      select 1 from public.caregiver_links l
      where l.patient_id = target_patient and l.caregiver_id = auth.uid()
    )
  );
$$;

create function medsafe_private.can_edit_patient(target_patient uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and (
    target_patient = auth.uid() or exists (
      select 1 from public.caregiver_links l
      where l.patient_id = target_patient and l.caregiver_id = auth.uid() and l.can_edit
    )
  );
$$;

create function medsafe_private.can_read_profile(target_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and (
    target_user = auth.uid() or exists (
      select 1 from public.caregiver_links l
      where (l.patient_id = target_user and l.caregiver_id = auth.uid())
         or (l.caregiver_id = target_user and l.patient_id = auth.uid())
    )
  );
$$;

revoke all on function medsafe_private.can_read_patient(uuid) from public, anon;
revoke all on function medsafe_private.can_edit_patient(uuid) from public, anon;
revoke all on function medsafe_private.can_read_profile(uuid) from public, anon;
grant execute on function medsafe_private.can_read_patient(uuid) to authenticated;
grant execute on function medsafe_private.can_edit_patient(uuid) to authenticated;
grant execute on function medsafe_private.can_read_profile(uuid) to authenticated;

create policy profiles_read on public.profiles for select to authenticated
  using (medsafe_private.can_read_profile(id));
create policy profiles_create_self on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- Account IDs and roles cannot be changed via the app's UPDATE grants.

create policy links_read_participants on public.caregiver_links for select to authenticated
  using (patient_id = (select auth.uid()) or caregiver_id = (select auth.uid()));
create policy links_patient_grants_access on public.caregiver_links for insert to authenticated
  with check (patient_id = (select auth.uid()));
create policy links_patient_changes_permission on public.caregiver_links for update to authenticated
  using (patient_id = (select auth.uid())) with check (patient_id = (select auth.uid()));
create policy links_either_party_revokes on public.caregiver_links for delete to authenticated
  using (patient_id = (select auth.uid()) or caregiver_id = (select auth.uid()));
-- A caregiver cannot create a link, approve themselves, or enable editing.

create policy medicines_read on public.medicines for select to authenticated
  using (medsafe_private.can_read_patient(patient_id));
create policy medicines_create on public.medicines for insert to authenticated
  with check (medsafe_private.can_edit_patient(patient_id));
create policy medicines_update on public.medicines for update to authenticated
  using (medsafe_private.can_edit_patient(patient_id))
  with check (medsafe_private.can_edit_patient(patient_id));
create policy medicines_delete on public.medicines for delete to authenticated
  using (medsafe_private.can_edit_patient(patient_id));

create function medsafe_private.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function medsafe_private.set_updated_at() from public, anon, authenticated;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function medsafe_private.set_updated_at();
create trigger medicines_updated_at before update on public.medicines
  for each row execute function medsafe_private.set_updated_at();
create trigger caregiver_links_updated_at before update on public.caregiver_links
  for each row execute function medsafe_private.set_updated_at();

-- Inform the Data API that the schema has changed.
notify pgrst, 'reload schema';
commit;

select 'MedSafe database setup complete' as result;
