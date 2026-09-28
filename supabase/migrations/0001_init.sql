-- ===========================================================================
-- 0001_init.sql — clinic queue platform: schema, integrity, RPCs, RLS, Realtime
--
-- Target: Supabase Postgres.
-- This migration is intentionally IDEMPOTENT: it can be re-applied safely
-- (useful mid-hackathon when a demo database needs to be reset).
--
-- The queue state machine encoded here MUST stay identical to
-- lib/queue/status.ts. `is_queue_transition_allowed()` below is the mirror of
-- the TS `ALLOWED_TRANSITIONS` table; a unit test guards the TS side.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
-- Values are exactly the canonical statuses used by the application. Do not
-- introduce alternative spellings: lib/queue/status.ts and the Realtime
-- payloads all speak these five names.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'queue_status') then
    create type public.queue_status as enum (
      'WAITING',
      'CALLED',
      'IN_CONSULTATION',
      'COMPLETED',
      'NO_SHOW'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'staff_role') then
    create type public.staff_role as enum (
      'ADMIN',
      'RECEPTIONIST',
      'NURSE',
      'DOCTOR'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- organizations -> clinics -> departments -> queue_entries
-- ---------------------------------------------------------------------------

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  -- Short human/QR-friendly code, unique within a clinic, e.g. 'GOPD'.
  code text not null check (length(btrim(code)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint departments_clinic_code_key unique (clinic_id, code)
);

comment on table public.departments is
  'A queue-owning unit of a clinic (General OPD, Cardiology, ...). Multiple
   departments per clinic; each has its own independent queue.';

-- ---------------------------------------------------------------------------
-- patients
-- ---------------------------------------------------------------------------
-- Minimal identity only. Deliberately holds NO clinical information: no
-- symptoms, no diagnosis, no medical history, no records.
create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(btrim(display_name)) > 0),
  phone text,
  preferred_language text not null default 'en'
    check (preferred_language in ('en', 'hi', 'kn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.patients is
  'Queue identity only — never clinical data. Kept separate from
   queue_entries so the anonymous patient experience never needs to read it
   directly (see RLS section: anon has no access to this table at all).';

-- ---------------------------------------------------------------------------
-- staff_users
-- ---------------------------------------------------------------------------
-- `department_id` is nullable on purpose: a receptionist or administrator may
-- be clinic-wide, while a doctor is tied to one department's queue. This is the
-- minimal way to express "staff users belong to a clinic and may be associated
-- with departments" without adding a join table.
create table if not exists public.staff_users (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  department_id uuid references public.departments (id) on delete set null,
  display_name text not null check (length(btrim(display_name)) > 0),
  role public.staff_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.staff_users is
  'Internal staff directory. NEVER exposed to the anonymous patient role
   (see RLS section). There is no auth in the MVP: staff mutations are performed
   server-side with the secret key.';

-- ---------------------------------------------------------------------------
-- queue_entries
-- ---------------------------------------------------------------------------
-- One row = one patient's presence in one department queue on one day.
--
-- NOTE: queue position / "people ahead" are deliberately NOT stored. They are
-- derived from (priority desc, joined_at asc) at read time, so they can never
-- drift out of sync with the data.
create table if not exists public.queue_entries (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete restrict,
  -- Per department, per day, human-readable token. Resets to 1 each day.
  token_number integer not null check (token_number > 0),
  token_date date not null default current_date,
  status public.queue_status not null default 'WAITING',
  -- Set ONLY by an explicit staff action. Never inferred, never automated.
  priority boolean not null default false,
  -- Free-text workflow note explaining a manual priority flag (never medical).
  priority_reason text,
  room_label text,
  assigned_staff_id uuid references public.staff_users (id) on delete set null,
  joined_at timestamptz not null default now(),
  called_at timestamptz,
  consultation_started_at timestamptz,
  completed_at timestamptz,
  -- Informational cache of the app-side ETA engine (lib/queue/eta.ts).
  -- The TS engine remains authoritative; SQL never computes this.
  estimated_wait_minutes integer
    check (estimated_wait_minutes is null or estimated_wait_minutes >= 0),
  updated_at timestamptz not null default now(),

  -- A department must never issue the same token twice on the same day.
  constraint queue_entries_token_unique
    unique (department_id, token_date, token_number),

  -- A priority reason only makes sense on a priority entry.
  constraint queue_entries_priority_reason_check
    check (priority or priority_reason is null),

  -- Status/timestamp coherence: no "in consultation" without a start time.
  constraint queue_entries_consultation_requires_start
    check (status <> 'IN_CONSULTATION' or consultation_started_at is not null),
  constraint queue_entries_completed_requires_completed_at
    check (status <> 'COMPLETED' or completed_at is not null),

  -- No time travel.
  constraint queue_entries_called_after_join
    check (called_at is null or called_at >= joined_at),
  constraint queue_entries_time_order
    check (
      consultation_started_at is null
      or completed_at is null
      or completed_at >= consultation_started_at
    )
);

comment on table public.queue_entries is
  'Live queue state. Carries no direct PII: patient names live in `patients`.
   Status changes are validated by the enforce_queue_transition trigger, so
   even a privileged SQL session cannot create an impossible state.';

comment on column public.queue_entries.priority is
  'HUMAN-CONTROLLED ONLY. Never set by an algorithm or inferred from data.';

-- ---------------------------------------------------------------------------
-- consultations
-- ---------------------------------------------------------------------------
create table if not exists public.consultations (
  id uuid primary key default gen_random_uuid(),
  queue_entry_id uuid not null references public.queue_entries (id) on delete cascade,
  -- Nullable: the MVP tracks queue flow, not staff identity guarantees.
  staff_user_id uuid references public.staff_users (id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint consultations_time_order
    check (ended_at is null or ended_at >= started_at)
);

comment on table public.consultations is
  'Audit rows for consultation duration. This is also the data source for the
   ETA engine: recent (ended_at - started_at) values per department. Never
   exposed to the anonymous patient role.';

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations', 'clinics', 'departments', 'patients',
    'staff_users', 'queue_entries', 'consultations'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Foreign-key support (Postgres does not create these automatically).
create index if not exists clinics_organization_id_idx
  on public.clinics (organization_id);
create index if not exists departments_clinic_id_idx
  on public.departments (clinic_id);
create index if not exists staff_users_clinic_id_idx
  on public.staff_users (clinic_id);
create index if not exists staff_users_department_id_idx
  on public.staff_users (department_id);
create index if not exists queue_entries_patient_id_idx
  on public.queue_entries (patient_id);
create index if not exists queue_entries_assigned_staff_id_idx
  on public.queue_entries (assigned_staff_id);
create index if not exists consultations_queue_entry_id_idx
  on public.consultations (queue_entry_id);
create index if not exists consultations_staff_user_id_idx
  on public.consultations (staff_user_id);

-- Required singles on queue_entries.
create index if not exists queue_entries_clinic_id_idx
  on public.queue_entries (clinic_id);
create index if not exists queue_entries_department_id_idx
  on public.queue_entries (department_id);
create index if not exists queue_entries_token_date_idx
  on public.queue_entries (token_date);
create index if not exists queue_entries_status_idx
  on public.queue_entries (status);
create index if not exists queue_entries_joined_at_idx
  on public.queue_entries (joined_at);
create index if not exists queue_entries_updated_at_idx
  on public.queue_entries (updated_at);

-- Composite index for active queue ordering. This makes "who is next?"
-- (priority first, then arrival) cheap, and it backs the FOR UPDATE SKIP LOCKED
-- scan in call_next_queue_entry().
create index if not exists queue_entries_waiting_order_idx
  on public.queue_entries (
    department_id, token_date, priority desc, joined_at asc, token_number asc
  )
  where status = 'WAITING';

-- Composite index for the staff/admin board: one department, one day, in
-- display order, across all active statuses.
create index if not exists queue_entries_department_board_idx
  on public.queue_entries (
    department_id, token_date, status, priority desc, joined_at asc
  );

-- Backs the ETA window ("most recent completed consultations in a department").
create index if not exists consultations_started_at_idx
  on public.consultations (started_at desc);

-- ---------------------------------------------------------------------------
-- Queue state machine (database mirror of lib/queue/status.ts)
-- ---------------------------------------------------------------------------
-- Legal transitions, and ONLY these:
--   WAITING         -> CALLED, NO_SHOW
--   CALLED          -> WAITING, IN_CONSULTATION, NO_SHOW   (WAITING = requeue)
--   IN_CONSULTATION -> COMPLETED
--   COMPLETED       -> (terminal)
--   NO_SHOW         -> (terminal)
create or replace function public.is_queue_transition_allowed(
  p_from public.queue_status,
  p_to public.queue_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1
    from (values
      ('WAITING'::public.queue_status,         'CALLED'::public.queue_status),
      ('WAITING'::public.queue_status,         'NO_SHOW'::public.queue_status),
      ('CALLED'::public.queue_status,          'WAITING'::public.queue_status),
      ('CALLED'::public.queue_status,          'IN_CONSULTATION'::public.queue_status),
      ('CALLED'::public.queue_status,          'NO_SHOW'::public.queue_status),
      ('IN_CONSULTATION'::public.queue_status, 'COMPLETED'::public.queue_status)
    ) as allowed (from_status, to_status)
    where allowed.from_status = p_from
      and allowed.to_status = p_to
  );
$$;

comment on function public.is_queue_transition_allowed(
  public.queue_status, public.queue_status
) is
  'Single source of truth for legal queue transitions in the database. Must
   always agree with ALLOWED_TRANSITIONS in lib/queue/status.ts.
   CALLED -> WAITING is the only requeue operation.';

-- Hard block on impossible states. This fires for EVERY writer — including the
-- secret key and raw SQL sessions — so the database cannot be talked into
-- COMPLETED -> WAITING or WAITING -> IN_CONSULTATION.
create or replace function public.enforce_queue_transition()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status
     and not public.is_queue_transition_allowed(old.status, new.status)
  then
    raise exception
      'invalid_queue_transition: % -> % (queue_entry_id=%)',
      old.status, new.status, new.id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_queue_transition on public.queue_entries;
create trigger enforce_queue_transition
  before update on public.queue_entries
  for each row
  execute function public.enforce_queue_transition();

-- ---------------------------------------------------------------------------
-- RPC: join_queue
-- ---------------------------------------------------------------------------
-- Issues a token atomically. Two simultaneous joins to the same department must
-- never receive the same token number, so token allocation is serialised per
-- department with a transaction-scoped advisory lock, and the
-- (department_id, token_date, token_number) unique constraint is the backstop.
create or replace function public.join_queue(
  p_department_id uuid,
  p_display_name text,
  p_phone text default null,
  p_preferred_language text default 'en'
)
returns public.queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_department public.departments;
  v_token_number integer;
  v_patient_id uuid;
  v_entry public.queue_entries;
begin
  if p_display_name is null or length(btrim(p_display_name)) = 0 then
    raise exception 'display_name_required' using errcode = 'not_null_violation';
  end if;

  select * into v_department from public.departments where id = p_department_id;
  if not found then
    raise exception 'department_not_found: %', p_department_id
      using errcode = 'no_data_found';
  end if;
  if not v_department.is_active then
    raise exception 'department_inactive: %', p_department_id
      using errcode = 'check_violation';
  end if;

  -- Serialise token allocation for this department until the transaction ends.
  perform pg_advisory_xact_lock(hashtext(p_department_id::text));

  select coalesce(max(token_number), 0) + 1
    into v_token_number
    from public.queue_entries
   where department_id = p_department_id
     and token_date = current_date;

  -- A fresh patient row per join: `phone` is optional and not unique, so
  -- matching returning patients by phone would risk merging different people.
  insert into public.patients (display_name, phone, preferred_language)
  values (
    btrim(p_display_name),
    nullif(btrim(coalesce(p_phone, '')), ''),
    coalesce(nullif(btrim(coalesce(p_preferred_language, '')), ''), 'en')
  )
  returning id into v_patient_id;

  insert into public.queue_entries (
    clinic_id, department_id, patient_id, token_number, token_date, status
  )
  values (
    v_department.clinic_id, p_department_id, v_patient_id, v_token_number, current_date, 'WAITING'
  )
  returning * into v_entry;

  return v_entry;
end;
$$;

comment on function public.join_queue(uuid, text, text, text) is
  'Atomically issues the next token for a department (per day) and enqueues the
   patient as WAITING. Staff/patient UIs must call this instead of inserting
   into queue_entries directly.';

-- ---------------------------------------------------------------------------
-- RPC: call_next_queue_entry
-- ---------------------------------------------------------------------------
-- The ONLY correct way to advance a queue.
--
-- Naive "SELECT the first waiting row, then UPDATE it" is race-prone: two staff
-- members clicking Call Next at the same moment can read the same candidate and
-- both call the same patient. Here the candidate is locked with
-- FOR UPDATE SKIP LOCKED, so a concurrent caller silently skips the row that is
-- already being taken and picks the next one. Two simultaneous calls therefore
-- always return two different queue entries (or null once the queue is empty).
--
-- Ordering: staff-controlled priority first, then arrival order.
create or replace function public.call_next_queue_entry(
  p_department_id uuid,
  p_token_date date default null,
  p_staff_user_id uuid default null,
  p_room_label text default null
)
returns public.queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.queue_entries;
  v_token_date date := coalesce(p_token_date, current_date);
begin
  select *
    into v_entry
    from public.queue_entries
   where department_id = p_department_id
     and token_date = v_token_date
     and status = 'WAITING'
   order by priority desc, joined_at asc, token_number asc
   for update skip locked
   limit 1;

  if not found then
    return null;  -- queue is empty (or every candidate is locked elsewhere)
  end if;

  update public.queue_entries
     set status = 'CALLED',
         called_at = now(),
         assigned_staff_id = coalesce(p_staff_user_id, assigned_staff_id),
         room_label = coalesce(p_room_label, room_label)
   where id = v_entry.id
  returning * into v_entry;

  return v_entry;
end;
$$;

comment on function public.call_next_queue_entry(uuid, date, uuid, text) is
  'Atomically moves the next eligible WAITING entry (priority first, then
   joined_at) to CALLED. Uses FOR UPDATE SKIP LOCKED so concurrent callers can
   never receive the same patient. Returns NULL when nobody is waiting.';

-- ---------------------------------------------------------------------------
-- RPC: transition_queue_entry
-- ---------------------------------------------------------------------------
-- The single entry point for every staff queue action. It:
--   1. maps an action name to exactly one target status (mirrors
--      QUEUE_ACTION_TARGET in lib/queue/status.ts);
--   2. locks the row;
--   3. validates the move against is_queue_transition_allowed();
--   4. maintains the status timestamps and the consultations audit row.
--
-- The enforce_queue_transition trigger is a second, independent guard, so even a
-- caller that bypasses this RPC cannot create an illegal state.
create or replace function public.transition_queue_entry(
  p_queue_entry_id uuid,
  p_action text,
  p_staff_user_id uuid default null,
  p_room_label text default null
)
returns public.queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.queue_entries;
  v_target public.queue_status;
begin
  v_target := case upper(btrim(coalesce(p_action, '')))
    when 'CALL'               then 'CALLED'::public.queue_status
    when 'START_CONSULTATION' then 'IN_CONSULTATION'::public.queue_status
    when 'COMPLETE'           then 'COMPLETED'::public.queue_status
    when 'NO_SHOW'            then 'NO_SHOW'::public.queue_status
    when 'REQUEUE'            then 'WAITING'::public.queue_status
    else null
  end;

  if v_target is null then
    raise exception 'unknown_queue_action: %', p_action
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_entry
    from public.queue_entries
   where id = p_queue_entry_id
   for update;

  if not found then
    raise exception 'queue_entry_not_found: %', p_queue_entry_id
      using errcode = 'no_data_found';
  end if;

  if not public.is_queue_transition_allowed(v_entry.status, v_target) then
    raise exception
      'invalid_queue_transition: % -> % (queue_entry_id=%)',
      v_entry.status, v_target, v_entry.id
      using errcode = 'check_violation';
  end if;

  if v_target = 'CALLED' then
    update public.queue_entries
       set status = 'CALLED',
           called_at = now(),
           consultation_started_at = null,
           completed_at = null,
           assigned_staff_id = coalesce(p_staff_user_id, assigned_staff_id),
           room_label = coalesce(p_room_label, room_label)
     where id = v_entry.id
    returning * into v_entry;

  elsif v_target = 'IN_CONSULTATION' then
    update public.queue_entries
       set status = 'IN_CONSULTATION',
           consultation_started_at = now(),
           assigned_staff_id = coalesce(p_staff_user_id, assigned_staff_id)
     where id = v_entry.id
    returning * into v_entry;

    insert into public.consultations (queue_entry_id, staff_user_id, started_at)
    values (v_entry.id, p_staff_user_id, v_entry.consultation_started_at);

  elsif v_target = 'COMPLETED' then
    update public.queue_entries
       set status = 'COMPLETED',
           completed_at = now()
     where id = v_entry.id
    returning * into v_entry;

    -- Close the open consultation so the ETA engine can use its duration.
    update public.consultations
       set ended_at = v_entry.completed_at
     where queue_entry_id = v_entry.id
       and ended_at is null;

  elsif v_target = 'NO_SHOW' then
    update public.queue_entries
       set status = 'NO_SHOW'
     where id = v_entry.id
    returning * into v_entry;

  else  -- 'WAITING': the single requeue edge (CALLED -> WAITING)
    -- joined_at is intentionally preserved so the requeued patient keeps their
    -- original place in arrival order rather than being sent to the back.
    update public.queue_entries
       set status = 'WAITING',
           called_at = null
     where id = v_entry.id
    returning * into v_entry;
  end if;

  return v_entry;
end;
$$;

comment on function public.transition_queue_entry(uuid, text, uuid, text) is
  'Applies one staff queue action (CALL, START_CONSULTATION, COMPLETE, NO_SHOW,
   REQUEUE) after validating it against the queue state machine. Raises on any
   illegal move instead of silently writing bad state.';

-- ===========================================================================
-- Security: roles, RLS, grants
-- ===========================================================================
-- The roles involved, and what they actually are:
--
--   anon           the Postgres role PostgREST and Realtime use when a request
--                  arrives with the PUBLISHABLE key and no user session. This is
--                  the patient's browser. Must be treated as untrusted.
--   authenticated  the role for signed-in users. The MVP has no auth, so this
--                  role is given NOTHING.
--   service_role   the role behind the SECRET key. BYPASSRLS, server-only.
--                  Every staff/admin mutation runs as this role, from Server
--                  Actions — never from the browser.
--
-- The explicit REVOKEs below are deliberate: a Supabase project may or may not
-- have default privileges granting anon access to new tables (this depends on
-- how the project was created). Instead of assuming, we revoke first and then
-- grant back the strictly minimum surface. The result is independent of the
-- project's defaults.
-- ===========================================================================

alter table public.organizations enable row level security;
alter table public.clinics enable row level security;
alter table public.departments enable row level security;
alter table public.patients enable row level security;
alter table public.staff_users enable row level security;
alter table public.queue_entries enable row level security;
alter table public.consultations enable row level security;

-- Baseline: no anonymous or signed-in access to anything ...
revoke all on table
  public.organizations,
  public.clinics,
  public.departments,
  public.patients,
  public.staff_users,
  public.queue_entries,
  public.consultations
from anon, authenticated;

-- ... then grant back exactly one read surface: the queue board itself.
--
-- queue_entries holds no direct PII (no names, no phone numbers — those live in
-- `patients`, which anon still cannot touch). It is the minimum data a patient
-- browser needs, and it is required for Realtime postgres_changes authorisation.
grant usage on schema public to anon, authenticated, service_role;
grant select on table public.queue_entries to anon;

-- Row visibility for the anonymous role.
--
-- NOTE / deliberate trade-off: with no authentication there is no claim to scope
-- this by, so an anonymous subscriber can receive change events for other
-- clinics' queues too. That is acceptable here because (a) the rows contain only
-- opaque UUIDs, a token number, a status and timestamps — never patient
-- identity, notes or clinical data, and (b) all writes are server-side. A
-- production deployment would scope this policy to the clinic the session
-- belongs to (e.g. a JWT claim) instead of `true`.
drop policy if exists "anon can read queue entries" on public.queue_entries;
create policy "anon can read queue entries"
  on public.queue_entries
  for select
  to anon
  using (true);

-- No INSERT/UPDATE/DELETE policy exists for anon or authenticated on ANY table,
-- so RLS denies all writes by default. Patients therefore cannot mutate the
-- queue even with a valid publishable key.

-- Functions: Postgres grants EXECUTE to PUBLIC by default, which would let an
-- anonymous caller invoke the mutating RPCs through PostgREST (e.g. call
-- /rest/v1/rpc/call_next_queue_entry and drive the queue). Revoke that, then
-- grant only to the server-side role.
revoke all on function public.join_queue(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.call_next_queue_entry(uuid, date, uuid, text)
  from public, anon, authenticated;
revoke all on function public.transition_queue_entry(uuid, text, uuid, text)
  from public, anon, authenticated;

grant execute on function public.join_queue(uuid, text, text, text)
  to service_role;
grant execute on function public.call_next_queue_entry(uuid, date, uuid, text)
  to service_role;
grant execute on function public.transition_queue_entry(uuid, text, uuid, text)
  to service_role;

-- ===========================================================================
-- Realtime
-- ===========================================================================
-- Goal: staff changes queue state -> Postgres change -> Realtime event ->
-- patient browser updates without a refresh.
--
-- Three things must ALL be true, or the subscription connects successfully and
-- then silently delivers zero events:
--   1. the table is in the `supabase_realtime` publication (below);
--   2. the subscribing role has a table-level SELECT grant (done above) —
--      a row-level policy alone is NOT sufficient;
--   3. the role is allowed to see the rows, via the RLS policy above.
-- scripts/verify-database.ts proves this end to end rather than assuming it.
--
-- REPLICA IDENTITY FULL makes UPDATE/DELETE payloads carry the full old row, and
-- is required for Realtime to filter change events reliably.
alter table public.queue_entries replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'queue_entries'
  ) then
    alter publication supabase_realtime add table public.queue_entries;
  end if;
end $$;






