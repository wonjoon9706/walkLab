-- WalkLab G3: PostgreSQL data contract and per-user RLS boundary.

create table public.walk_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  installation_id uuid not null,
  status text not null check (
    status in ('starting', 'recording', 'completed', 'interrupted', 'error')
  ),
  started_at timestamptz not null,
  ended_at timestamptz,
  source_platform text not null check (length(source_platform) between 1 and 100),
  app_version text not null check (length(app_version) between 1 and 50),
  schema_version smallint not null check (schema_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint walk_sessions_id_user_unique unique (id, user_id),
  constraint walk_sessions_time_order check (
    ended_at is null or ended_at >= started_at
  )
);

create index walk_sessions_user_started_idx
  on public.walk_sessions (user_id, started_at desc);

create table public.gps_points (
  id uuid primary key,
  session_id uuid not null,
  user_id uuid not null,
  sequence_no integer not null check (sequence_no > 0),
  measured_at timestamptz not null,
  received_at timestamptz not null,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_m double precision not null,
  altitude_m double precision,
  altitude_accuracy_m double precision,
  device_speed_mps double precision,
  heading_deg double precision,
  schema_version smallint not null check (schema_version > 0),
  created_at timestamptz not null default now(),
  constraint gps_points_session_sequence_unique unique (session_id, sequence_no),
  constraint gps_points_identity_unique unique (id, session_id, user_id),
  constraint gps_points_session_owner_fk foreign key (session_id, user_id)
    references public.walk_sessions (id, user_id) on delete cascade
);

create index gps_points_session_measured_idx
  on public.gps_points (session_id, measured_at);

create table public.measurement_events (
  id uuid primary key,
  session_id uuid not null,
  user_id uuid not null,
  event_type text not null check (
    event_type in (
      'measurement_start_requested',
      'measurement_started',
      'measurement_stopped',
      'measurement_interrupted',
      'permission_denied',
      'position_unavailable',
      'position_timeout',
      'unsupported',
      'page_hidden',
      'page_visible',
      'offline',
      'online',
      'local_save_failed',
      'otp_send_failed',
      'otp_verify_failed',
      'auth_expired',
      'sync_failed',
      'sync_partial',
      'sync_confirmed',
      'owner_mismatch',
      'suppressed_by_deletion'
    )
  ),
  occurred_at timestamptz not null,
  received_at timestamptz not null,
  error_code text check (error_code is null or length(error_code) <= 100),
  details jsonb,
  schema_version smallint not null check (schema_version > 0),
  created_at timestamptz not null default now(),
  constraint measurement_events_details_object check (
    details is null
    or (
      jsonb_typeof(details) = 'object'
      and pg_column_size(details) <= 8192
    )
  ),
  constraint measurement_events_session_owner_fk foreign key (session_id, user_id)
    references public.walk_sessions (id, user_id) on delete cascade
);

create index measurement_events_session_occurred_idx
  on public.measurement_events (session_id, occurred_at);

create table public.point_quality (
  point_id uuid not null,
  session_id uuid not null,
  user_id uuid not null,
  algorithm_version text not null check (length(algorithm_version) between 1 and 100),
  status text not null check (status in ('included', 'excluded')),
  reasons text[] not null default '{}',
  included_in_filtered_path boolean not null,
  evaluated_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (point_id, algorithm_version),
  constraint point_quality_point_owner_fk foreign key (point_id, session_id, user_id)
    references public.gps_points (id, session_id, user_id) on delete cascade
);

create index point_quality_session_idx
  on public.point_quality (session_id, algorithm_version);

create table public.session_metrics (
  session_id uuid not null,
  user_id uuid not null,
  algorithm_version text not null check (length(algorithm_version) between 1 and 100),
  quality_algorithm_version text not null check (
    length(quality_algorithm_version) between 1 and 100
  ),
  duration_s double precision,
  raw_distance_m double precision,
  filtered_distance_m double precision,
  average_speed_mps double precision,
  pace_seconds_per_km double precision,
  altitude_min_m double precision,
  altitude_max_m double precision,
  altitude_sample_count integer not null default 0 check (altitude_sample_count >= 0),
  raw_point_count integer not null default 0 check (raw_point_count >= 0),
  filtered_point_count integer not null default 0 check (filtered_point_count >= 0),
  calculated_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (session_id, algorithm_version),
  constraint session_metrics_session_owner_fk foreign key (session_id, user_id)
    references public.walk_sessions (id, user_id) on delete cascade,
  constraint session_metrics_duration_nonnegative check (
    duration_s is null or duration_s >= 0
  ),
  constraint session_metrics_raw_distance_nonnegative check (
    raw_distance_m is null or raw_distance_m >= 0
  ),
  constraint session_metrics_filtered_distance_nonnegative check (
    filtered_distance_m is null or filtered_distance_m >= 0
  ),
  constraint session_metrics_speed_nonnegative check (
    average_speed_mps is null or average_speed_mps >= 0
  ),
  constraint session_metrics_pace_nonnegative check (
    pace_seconds_per_km is null or pace_seconds_per_km >= 0
  ),
  constraint session_metrics_altitude_order check (
    altitude_min_m is null
    or altitude_max_m is null
    or altitude_min_m <= altitude_max_m
  )
);

create table public.user_data_deletion_cutoffs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  reject_sessions_started_at_or_before timestamptz not null,
  requested_at timestamptz not null default now(),
  reason text not null default 'user_request' check (reason = 'user_request')
);

create or replace function public.reject_session_before_deletion_cutoff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  deletion_cutoff timestamptz;
begin
  select cutoffs.reject_sessions_started_at_or_before
    into deletion_cutoff
    from public.user_data_deletion_cutoffs as cutoffs
   where cutoffs.user_id = new.user_id;

  if deletion_cutoff is not null and new.started_at <= deletion_cutoff then
    raise exception using
      errcode = 'P0001',
      message = 'SESSION_SUPPRESSED_BY_DELETION';
  end if;

  return new;
end;
$$;

create trigger reject_session_before_deletion_cutoff_trigger
before insert on public.walk_sessions
for each row execute function public.reject_session_before_deletion_cutoff();

create or replace function public.prevent_walk_session_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.user_id is distinct from old.user_id then
    raise exception using
      errcode = 'P0001',
      message = 'WALK_SESSION_IDENTITY_IMMUTABLE';
  end if;

  return new;
end;
$$;

create trigger prevent_walk_session_identity_change_trigger
before update on public.walk_sessions
for each row execute function public.prevent_walk_session_identity_change();

revoke all on function public.reject_session_before_deletion_cutoff() from public;
revoke all on function public.reject_session_before_deletion_cutoff() from anon;
revoke all on function public.reject_session_before_deletion_cutoff() from authenticated;
revoke all on function public.prevent_walk_session_identity_change() from public;
revoke all on function public.prevent_walk_session_identity_change() from anon;
revoke all on function public.prevent_walk_session_identity_change() from authenticated;

alter table public.walk_sessions enable row level security;
alter table public.gps_points enable row level security;
alter table public.measurement_events enable row level security;
alter table public.point_quality enable row level security;
alter table public.session_metrics enable row level security;
alter table public.user_data_deletion_cutoffs enable row level security;

revoke all on table public.walk_sessions from anon, authenticated;
revoke all on table public.gps_points from anon, authenticated;
revoke all on table public.measurement_events from anon, authenticated;
revoke all on table public.point_quality from anon, authenticated;
revoke all on table public.session_metrics from anon, authenticated;
revoke all on table public.user_data_deletion_cutoffs from anon, authenticated;

grant select, insert on table public.walk_sessions to authenticated;
grant update (status, ended_at, updated_at) on table public.walk_sessions to authenticated;
grant select, insert on table public.gps_points to authenticated;
grant select, insert on table public.measurement_events to authenticated;
grant select, insert on table public.point_quality to authenticated;
grant select, insert on table public.session_metrics to authenticated;
grant select on table public.user_data_deletion_cutoffs to authenticated;

create policy walk_sessions_select_own
on public.walk_sessions
for select
to authenticated
using (auth.uid() is not null and auth.uid() = user_id);

create policy walk_sessions_insert_own
on public.walk_sessions
for insert
to authenticated
with check (auth.uid() is not null and auth.uid() = user_id);

create policy walk_sessions_update_own
on public.walk_sessions
for update
to authenticated
using (auth.uid() is not null and auth.uid() = user_id)
with check (auth.uid() is not null and auth.uid() = user_id);

create policy gps_points_select_own
on public.gps_points
for select
to authenticated
using (auth.uid() is not null and auth.uid() = user_id);

create policy gps_points_insert_own
on public.gps_points
for insert
to authenticated
with check (auth.uid() is not null and auth.uid() = user_id);

create policy measurement_events_select_own
on public.measurement_events
for select
to authenticated
using (auth.uid() is not null and auth.uid() = user_id);

create policy measurement_events_insert_own
on public.measurement_events
for insert
to authenticated
with check (auth.uid() is not null and auth.uid() = user_id);

create policy point_quality_select_own
on public.point_quality
for select
to authenticated
using (auth.uid() is not null and auth.uid() = user_id);

create policy point_quality_insert_own
on public.point_quality
for insert
to authenticated
with check (auth.uid() is not null and auth.uid() = user_id);

create policy session_metrics_select_own
on public.session_metrics
for select
to authenticated
using (auth.uid() is not null and auth.uid() = user_id);

create policy session_metrics_insert_own
on public.session_metrics
for insert
to authenticated
with check (auth.uid() is not null and auth.uid() = user_id);

create policy user_data_deletion_cutoffs_select_own
on public.user_data_deletion_cutoffs
for select
to authenticated
using (auth.uid() is not null and auth.uid() = user_id);
