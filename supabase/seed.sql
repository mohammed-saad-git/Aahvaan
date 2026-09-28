-- ===========================================================================
-- seed.sql — synthetic demo data for the hackathon
--
-- Everything here is DELIBERATELY FAKE: no real patient, no real clinical data.
-- Safe to re-run: fixed UUIDs + upserts mean repeated runs give the same demo
-- state on any day (today's queue is rebuilt with fresh token_date).
--
-- Apply after 0001_init.sql. Direct inserts are used for speed; the app itself
-- must always go through join_queue() / call_next_queue_entry() /
-- transition_queue_entry() instead.
--
-- Fixed IDs (used by the verification script and by the UI later):
--   organization        11111111-1111-4111-8111-111111111111
--   clinic              22222222-2222-4222-8222-222222222222
--   department GOPD     33333333-3333-4333-8333-000000000001
--   department CARD     33333333-3333-4333-8333-000000000002
--   department PED      33333333-3333-4333-8333-000000000003
--   department DENT     33333333-3333-4333-8333-000000000004
--   department DIAG     33333333-3333-4333-8333-000000000005
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Organization + clinic
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name) values
  ('11111111-1111-4111-8111-111111111111', 'CityCare Health Network')
on conflict (id) do update set name = excluded.name;

insert into public.clinics (id, organization_id, name, address) values
  (
    '22222222-2222-4222-8222-222222222222',
    '11111111-1111-4111-8111-111111111111',
    'CityCare Hospital',
    '12 Demo Road, Bengaluru 560001 (synthetic address)'
  )
on conflict (id) do update
  set name = excluded.name,
      address = excluded.address,
      organization_id = excluded.organization_id;

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------
insert into public.departments (id, clinic_id, name, code, is_active) values
  ('33333333-3333-4333-8333-000000000001', '22222222-2222-4222-8222-222222222222', 'General OPD', 'GOPD', true),
  ('33333333-3333-4333-8333-000000000002', '22222222-2222-4222-8222-222222222222', 'Cardiology',  'CARD', true),
  ('33333333-3333-4333-8333-000000000003', '22222222-2222-4222-8222-222222222222', 'Pediatrics',  'PED',  true),
  ('33333333-3333-4333-8333-000000000004', '22222222-2222-4222-8222-222222222222', 'Dental',      'DENT', true),
  ('33333333-3333-4333-8333-000000000005', '22222222-2222-4222-8222-222222222222', 'Diagnostics', 'DIAG', true)
on conflict (id) do update
  set name = excluded.name,
      code = excluded.code,
      is_active = excluded.is_active,
      clinic_id = excluded.clinic_id;

-- ---------------------------------------------------------------------------
-- Staff users (synthetic)
-- ---------------------------------------------------------------------------
insert into public.staff_users (id, clinic_id, department_id, display_name, role, is_active) values
  ('44444444-4444-4444-8444-000000000001', '22222222-2222-4222-8222-222222222222',
   '33333333-3333-4333-8333-000000000001', 'Dr. Demo Rao (General OPD)', 'DOCTOR', true),
  ('44444444-4444-4444-8444-000000000002', '22222222-2222-4222-8222-222222222222',
   '33333333-3333-4333-8333-000000000002', 'Dr. Demo Nair (Cardiology)', 'DOCTOR', true),
  ('44444444-4444-4444-8444-000000000003', '22222222-2222-4222-8222-222222222222',
   '33333333-3333-4333-8333-000000000001', 'Nurse Demo Iyer', 'NURSE', true),
  -- Clinic-wide reception: intentionally null department_id.
  ('44444444-4444-4444-8444-000000000004', '22222222-2222-4222-8222-222222222222',
   null, 'Reception Demo Desk', 'RECEPTIONIST', true),
  ('44444444-4444-4444-8444-000000000005', '22222222-2222-4222-8222-222222222222',
   null, 'Demo Administrator', 'ADMIN', true)
on conflict (id) do update
  set display_name = excluded.display_name,
      role = excluded.role,
      is_active = excluded.is_active,
      department_id = excluded.department_id,
      clinic_id = excluded.clinic_id;

-- ---------------------------------------------------------------------------
-- Reset ONLY the demo queue rows (deterministic re-runs, any day)
-- ---------------------------------------------------------------------------
-- Scoped to the fixed IDs above so this never touches data created by a real
-- demo run in another department. Deleting queue_entries cascades to
-- consultations.
delete from public.queue_entries where id in (
  '55555555-5555-4555-8555-000000000001',
  '55555555-5555-4555-8555-000000000002',
  '55555555-5555-4555-8555-000000000003',
  '55555555-5555-4555-8555-000000000004',
  '55555555-5555-4555-8555-000000000005',
  '55555555-5555-4555-8555-000000000006',
  '55555555-5555-4555-8555-000000000007',
  '55555555-5555-4555-8555-000000000008',
  '55555555-5555-4555-8555-000000000009',
  '55555555-5555-4555-8555-000000000010',
  '55555555-5555-4555-8555-000000000011',
  '55555555-5555-4555-8555-000000000012',
  '55555555-5555-4555-8555-000000000013',
  '55555555-5555-4555-8555-000000000014'
);

delete from public.patients where id in (
  '66666666-6666-4666-8666-000000000001',
  '66666666-6666-4666-8666-000000000002',
  '66666666-6666-4666-8666-000000000003',
  '66666666-6666-4666-8666-000000000004',
  '66666666-6666-4666-8666-000000000005',
  '66666666-6666-4666-8666-000000000006',
  '66666666-6666-4666-8666-000000000007',
  '66666666-6666-4666-8666-000000000008',
  '66666666-6666-4666-8666-000000000009',
  '66666666-6666-4666-8666-000000000010',
  '66666666-6666-4666-8666-000000000011'
);

-- ---------------------------------------------------------------------------
-- Patients (obviously synthetic)
-- ---------------------------------------------------------------------------
insert into public.patients (id, display_name, phone, preferred_language) values
  ('66666666-6666-4666-8666-000000000001', 'Demo Patient 001', '+91-90000-00001', 'en'),
  ('66666666-6666-4666-8666-000000000002', 'Demo Patient 002', '+91-90000-00002', 'en'),
  ('66666666-6666-4666-8666-000000000003', 'Demo Patient 003', '+91-90000-00003', 'hi'),
  ('66666666-6666-4666-8666-000000000004', 'Demo Patient 004', '+91-90000-00004', 'en'),
  ('66666666-6666-4666-8666-000000000005', 'Demo Patient 005', '+91-90000-00005', 'kn'),
  ('66666666-6666-4666-8666-000000000006', 'Demo Patient 006', '+91-90000-00006', 'en'),
  ('66666666-6666-4666-8666-000000000007', 'Demo Patient 007', null,              'en'),
  ('66666666-6666-4666-8666-000000000008', 'Demo Patient 008', '+91-90000-00008', 'en'),
  ('66666666-6666-4666-8666-000000000009', 'Demo Patient 009', '+91-90000-00009', 'hi'),
  ('66666666-6666-4666-8666-000000000010', 'Demo Patient 010', '+91-90000-00010', 'en'),
  ('66666666-6666-4666-8666-000000000011', 'Demo Patient 011', '+91-90000-00011', 'en')
on conflict (id) do update
  set display_name = excluded.display_name,
      phone = excluded.phone,
      preferred_language = excluded.preferred_language;

-- ---------------------------------------------------------------------------
-- General OPD — TODAY (tokens 001-008, mixed statuses as specified)
-- ---------------------------------------------------------------------------
-- joined_at increases with token number (realistic arrival order). Token 006 is
-- marked priority by staff, which is why it sits ahead of everyone still waiting.
insert into public.queue_entries (
  id, clinic_id, department_id, patient_id, token_number, token_date, status,
  priority, priority_reason, room_label,
  joined_at, called_at, consultation_started_at, completed_at
) values
  -- 001 COMPLETED (12 minute consultation -> feeds the ETA engine)
  ('55555555-5555-4555-8555-000000000001', '22222222-2222-4222-8222-222222222222',
   '33333333-3333-4333-8333-000000000001', '66666666-6666-4666-8666-000000000001',
   1, current_date, 'COMPLETED', false, null, 'Room 1',
   now() - interval '170 minutes', now() - interval '166 minutes',
   now() - interval '162 minutes', now() - interval '150 minutes'),

  -- 002 COMPLETED (10 minute consultation)
  ('55555555-5555-4555-8555-000000000002', '22222222-2222-4222-8222-222222222222',
   '33333333-3333-4333-8333-000000000001', '66666666-6666-4666-8666-000000000002',
   2, current_date, 'COMPLETED', false, null, 'Room 1',
   now() - interval '158 minutes', now() - interval '154 minutes',
   now() - interval '150 minutes', now() - interval '140 minutes'),

  -- 003 WAITING
  ('55555555-5555-4555-8555-000000000003', '22222222-2222-4222-8222-222222222222',
   '33333333-3333-4333-8333-000000000001', '66666666-6666-4666-8666-000000000003',
   3, current_date, 'WAITING', false, null, null,
   now() - interval '140 minutes', null, null, null),

  -- 004 WAITING
  ('55555555-5555-4555-8555-000000000004', '22222222-2222-4222-8222-222222222222',
   '33333333-3333-4333-8333-000000000001', '66666666-6666-4666-8666-000000000004',
   4, current_date, 'WAITING', false, null, null,
   now() - interval '125 minutes', null, null, null),

  -- 005 WAITING
  ('55555555-5555-4555-8555-000000000005', '22222222-2222-4222-8222-222222222222',
   '33333333-3333-4333-8333-000000000001', '66666666-6666-4666-8666-000000000005',
   5, current_date, 'WAITING', false, null, null,
   now() - interval '110 minutes', null, null, null),

  -- 006 WAITING + PRIORITY (an explicit human decision, with a workflow reason)
  ('55555555-5555-4555-8555-000000000006', '22222222-2222-4222-8222-222222222222',
   '33333333-3333-4333-8333-000000000001', '66666666-6666-4666-8666-000000000006',
   6, current_date, 'WAITING', true,
   'Marked by reception staff (demo: elderly patient, mobility difficulty)', null,
   now() - interval '95 minutes', null, null, null),

  -- 007 WAITING
  ('55555555-5555-4555-8555-000000000007', '22222222-2222-4222-8222-222222222222',
   '33333333-3333-4333-8333-000000000001', '66666666-6666-4666-8666-000000000007',
   7, current_date, 'WAITING', false, null, null,
   now() - interval '80 minutes', null, null, null),

  -- 008 CALLED (called 5 minutes ago, room announced)
  ('55555555-5555-4555-8555-000000000008', '22222222-2222-4222-8222-222222222222',
   '33333333-3333-4333-8333-000000000001', '66666666-6666-4666-8666-000000000008',
   8, current_date, 'CALLED', false, null, 'Room 2',
   now() - interval '65 minutes', now() - interval '5 minutes', null, null);

-- ---------------------------------------------------------------------------
-- General OPD — YESTERDAY (history for the ETA engine)
-- ---------------------------------------------------------------------------
-- These three completed consultations plus today's two give the ETA engine a
-- 5-sample window of 12, 10, 15, 11 and 13 minutes -> average 12.2 minutes,
-- which reproduces the documented example exactly.
-- Patients 001-003 are reused deliberately: a patient may have many queue
-- entries over time.
insert into public.queue_entries (
  id, clinic_id, department_id, patient_id, token_number, token_date, status,
  priority, room_label,
  joined_at, called_at, consultation_started_at, completed_at
) values
  ('55555555-5555-4555-8555-000000000009', '22222222-2222-4222-8222-222222222222',
   '33333333-3333-4333-8333-000000000001', '66666666-6666-4666-8666-000000000001',
   1, current_date - 1, 'COMPLETED', false, 'Room 1',
   ((current_date - 1) + time '08:50')::timestamptz,
   ((current_date - 1) + time '08:52')::timestamptz,
   ((current_date - 1) + time '09:00')::timestamptz,
   ((current_date - 1) + time '09:15')::timestamptz),

  ('55555555-5555-4555-8555-000000000010', '22222222-2222-4222-8222-222222222222',
   '33333333-3333-4333-8333-000000000001', '66666666-6666-4666-8666-000000000002',
   2, current_date - 1, 'COMPLETED', false, 'Room 1',
   ((current_date - 1) + time '09:10')::timestamptz,
   ((current_date - 1) + time '09:12')::timestamptz,
   ((current_date - 1) + time '09:20')::timestamptz,
   ((current_date - 1) + time '09:31')::timestamptz),

  ('55555555-5555-4555-8555-000000000011', '22222222-2222-4222-8222-222222222222',
   '33333333-3333-4333-8333-000000000001', '66666666-6666-4666-8666-000000000003',
   3, current_date - 1, 'COMPLETED', false, 'Room 1',
   ((current_date - 1) + time '09:30')::timestamptz,
   ((current_date - 1) + time '09:33')::timestamptz,
   ((current_date - 1) + time '09:40')::timestamptz,
   ((current_date - 1) + time '09:53')::timestamptz);

-- Consultation audit rows for the completed entries above — these are the
-- durations the ETA engine reads. Inserted directly only because this is seed
-- data; the application always creates them through transition_queue_entry().
insert into public.consultations (queue_entry_id, staff_user_id, started_at, ended_at)
values
  ('55555555-5555-4555-8555-000000000001', '44444444-4444-4444-8444-000000000001',
   now() - interval '162 minutes', now() - interval '150 minutes'),
  ('55555555-5555-4555-8555-000000000002', '44444444-4444-4444-8444-000000000001',
   now() - interval '150 minutes', now() - interval '140 minutes'),
  ('55555555-5555-4555-8555-000000000009', '44444444-4444-4444-8444-000000000001',
   ((current_date - 1) + time '09:00')::timestamptz,
   ((current_date - 1) + time '09:15')::timestamptz),
  ('55555555-5555-4555-8555-000000000010', '44444444-4444-4444-8444-000000000001',
   ((current_date - 1) + time '09:20')::timestamptz,
   ((current_date - 1) + time '09:31')::timestamptz),
  ('55555555-5555-4555-8555-000000000011', '44444444-4444-4444-8444-000000000001',
   ((current_date - 1) + time '09:40')::timestamptz,
   ((current_date - 1) + time '09:53')::timestamptz);

-- ---------------------------------------------------------------------------
-- Other departments (so the multi-department story is visible immediately)
-- ---------------------------------------------------------------------------
insert into public.queue_entries (
  id, clinic_id, department_id, patient_id, token_number, token_date, status,
  priority, room_label, joined_at, called_at, consultation_started_at, completed_at
) values
  -- Cardiology: one waiting, one mid-consultation
  ('55555555-5555-4555-8555-000000000012', '22222222-2222-4222-8222-222222222222',
   '33333333-3333-4333-8333-000000000002', '66666666-6666-4666-8666-000000000009',
   1, current_date, 'WAITING', false, null,
   now() - interval '50 minutes', null, null, null),

  ('55555555-5555-4555-8555-000000000013', '22222222-2222-4222-8222-222222222222',
   '33333333-3333-4333-8333-000000000002', '66666666-6666-4666-8666-000000000010',
   2, current_date, 'IN_CONSULTATION', false, 'Cath Lab 1',
   now() - interval '75 minutes', now() - interval '20 minutes',
   now() - interval '15 minutes', null),

  -- Pediatrics: one waiting
  ('55555555-5555-4555-8555-000000000014', '22222222-2222-4222-8222-222222222222',
   '33333333-3333-4333-8333-000000000003', '66666666-6666-4666-8666-000000000011',
   1, current_date, 'WAITING', false, null,
   now() - interval '30 minutes', null, null, null);

-- Open consultation row for the Cardiology patient who is mid-consultation.
insert into public.consultations (queue_entry_id, staff_user_id, started_at, ended_at)
values
  ('55555555-5555-4555-8555-000000000013', '44444444-4444-4444-8444-000000000002',
   now() - interval '15 minutes', null);



