begin;

create extension if not exists pgtap with schema extensions;

select plan(34);

select has_table('public', 'walk_sessions', 'walk_sessions 테이블이 존재한다');
select has_table('public', 'gps_points', 'gps_points 테이블이 존재한다');
select has_table('public', 'measurement_events', 'measurement_events 테이블이 존재한다');
select has_table('public', 'point_quality', 'point_quality 테이블이 존재한다');
select has_table('public', 'session_metrics', 'session_metrics 테이블이 존재한다');
select has_table(
  'public',
  'user_data_deletion_cutoffs',
  '삭제 기준 테이블이 존재한다'
);

insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'g3-user-a@example.invalid'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'g3-user-b@example.invalid');

set local role anon;
select throws_ok(
  $$select * from public.walk_sessions$$,
  '42501',
  null,
  'anon은 session을 조회할 권한이 없다'
);
select throws_ok(
  $$insert into public.walk_sessions (
      id, user_id, installation_id, status, started_at,
      source_platform, app_version, schema_version
    ) values (
      '00000000-0000-4000-8000-000000000099',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '99999999-9999-4999-8999-999999999999',
      'recording', now(), 'web-browser', '0.0.0', 1
    )$$,
  '42501',
  null,
  'anon은 session을 작성할 권한이 없다'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local request.jwt.claim.role = 'authenticated';

select lives_ok(
  $$insert into public.walk_sessions (
      id, user_id, installation_id, status, started_at,
      source_platform, app_version, schema_version
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '99999999-9999-4999-8999-999999999999',
      'recording', '2026-10-29T00:00:00Z', 'web-ios-safari', '0.0.0', 1
    )$$,
  'A는 자기 session을 작성할 수 있다'
);

select is(
  (select count(*) from public.walk_sessions),
  1::bigint,
  'A는 자기 session을 조회할 수 있다'
);

select throws_ok(
  $$insert into public.walk_sessions (
      id, user_id, installation_id, status, started_at,
      source_platform, app_version, schema_version
    ) values (
      '22222222-2222-4222-8222-222222222222',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '99999999-9999-4999-8999-999999999999',
      'recording', '2026-10-29T00:00:00Z', 'web-browser', '0.0.0', 1
    )$$,
  '42501',
  null,
  'A는 B의 user_id로 session을 작성할 수 없다'
);

select throws_ok(
  $$update public.walk_sessions
       set user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
     where id = '11111111-1111-4111-8111-111111111111'$$,
  '42501',
  null,
  '인증 사용자는 session owner 열을 수정할 권한이 없다'
);

select lives_ok(
  $$update public.walk_sessions
       set status = 'completed',
           ended_at = '2026-10-29T00:10:00Z',
           updated_at = '2026-10-29T00:10:00Z'
     where id = '11111111-1111-4111-8111-111111111111'$$,
  'A는 자기 session의 종료 관련 열만 수정할 수 있다'
);

select is(
  (
    select status
      from public.walk_sessions
     where id = '11111111-1111-4111-8111-111111111111'
  ),
  'completed',
  '허용된 session 상태 변경이 저장된다'
);

select lives_ok(
  $$insert into public.gps_points (
      id, session_id, user_id, sequence_no, measured_at, received_at,
      latitude, longitude, accuracy_m, altitude_m, altitude_accuracy_m,
      device_speed_mps, heading_deg, schema_version
    ) values (
      '33333333-3333-4333-8333-333333333333',
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      1, '2026-10-29T00:00:01Z', '2026-10-29T00:00:02Z',
      37.1, 127.2, 8.5, null, null, null, null, 1
    )$$,
  'A는 자기 session에 GPS 원본을 삽입할 수 있다'
);

select ok(
  (
    select altitude_m is null
       and altitude_accuracy_m is null
       and device_speed_mps is null
       and heading_deg is null
      from public.gps_points
     where id = '33333333-3333-4333-8333-333333333333'
  ),
  'GPS 선택 원본 필드의 null이 보존된다'
);

select lives_ok(
  $$insert into public.measurement_events (
      id, session_id, user_id, event_type, occurred_at, received_at,
      error_code, details, schema_version
    ) values (
      '34343434-3434-4434-8434-343434343434',
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'position_timeout',
      '2026-10-29T00:00:03Z',
      '2026-10-29T00:00:04Z',
      'GEOLOCATION_TIMEOUT',
      '{"retrying": true}'::jsonb,
      1
    )$$,
  'GPS 오류는 별도 measurement event로 삽입할 수 있다'
);

select is(
  (select count(*) from public.gps_points),
  1::bigint,
  '오류 event 삽입은 GPS point 수를 늘리지 않는다'
);

select throws_ok(
  $$insert into public.gps_points (
      id, session_id, user_id, sequence_no, measured_at, received_at,
      latitude, longitude, accuracy_m, schema_version
    ) values (
      '35353535-3535-4535-8535-353535353535',
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      1, now(), now(), 37.2, 127.3, 10, 1
    )$$,
  '23505',
  null,
  '같은 session sequence 중복은 unique 제약이 차단한다'
);

select throws_ok(
  $$update public.gps_points
       set latitude = 0
     where id = '33333333-3333-4333-8333-333333333333'$$,
  '42501',
  null,
  'GPS 원본 update 권한이 없다'
);

select throws_ok(
  $$delete from public.gps_points
     where id = '33333333-3333-4333-8333-333333333333'$$,
  '42501',
  null,
  'GPS 원본 delete 권한이 없다'
);

reset role;

select throws_ok(
  $$insert into public.gps_points (
      id, session_id, user_id, sequence_no, measured_at, received_at,
      latitude, longitude, accuracy_m, schema_version
    ) values (
      '44444444-4444-4444-8444-444444444444',
      '11111111-1111-4111-8111-111111111111',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      2, now(), now(), 37.1, 127.2, 8.5, 1
    )$$,
  '23503',
  null,
  '복합 FK가 session과 자식 user_id 불일치를 차단한다'
);

insert into public.walk_sessions (
  id, user_id, installation_id, status, started_at,
  source_platform, app_version, schema_version
) values (
  '55555555-5555-4555-8555-555555555555',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '99999999-9999-4999-8999-999999999999',
  'completed', '2026-10-29T00:00:00Z', 'web-browser', '0.0.0', 1
);

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local request.jwt.claim.role = 'authenticated';

select is(
  (
    select count(*)
      from public.walk_sessions
     where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ),
  0::bigint,
  'A에게 B의 session이 보이지 않는다'
);

select throws_ok(
  $$insert into public.gps_points (
      id, session_id, user_id, sequence_no, measured_at, received_at,
      latitude, longitude, accuracy_m, schema_version
    ) values (
      '66666666-6666-4666-8666-666666666666',
      '55555555-5555-4555-8555-555555555555',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      1, now(), now(), 37.1, 127.2, 8.5, 1
    )$$,
  '42501',
  null,
  'A는 B의 session_id와 user_id로 자식을 삽입할 수 없다'
);

reset role;

insert into public.user_data_deletion_cutoffs (
  user_id,
  reject_sessions_started_at_or_before,
  requested_at
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '2026-10-29T12:00:00Z',
  '2026-10-29T12:00:00Z'
), (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '2026-10-29T12:00:00Z',
  '2026-10-29T12:00:00Z'
);

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local request.jwt.claim.role = 'authenticated';

select throws_ok(
  $$insert into public.walk_sessions (
      id, user_id, installation_id, status, started_at,
      source_platform, app_version, schema_version
    ) values (
      '77777777-7777-4777-8777-777777777777',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '99999999-9999-4999-8999-999999999999',
      'completed', '2026-10-29T12:00:00Z', 'web-browser', '0.0.0', 1
    )$$,
  'P0001',
  'SESSION_SUPPRESSED_BY_DELETION',
  'cutoff와 같거나 오래된 session은 재삽입할 수 없다'
);

select lives_ok(
  $$insert into public.walk_sessions (
      id, user_id, installation_id, status, started_at,
      source_platform, app_version, schema_version
    ) values (
      '88888888-8888-4888-8888-888888888888',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '99999999-9999-4999-8999-999999999999',
      'recording', '2026-10-29T12:00:01Z', 'web-browser', '0.0.0', 1
    )$$,
  'cutoff 이후 새 session은 삽입할 수 있다'
);

select is(
  (select count(*) from public.user_data_deletion_cutoffs),
  1::bigint,
  'A는 자신의 cutoff만 조회할 수 있다'
);

select throws_ok(
  $$insert into public.user_data_deletion_cutoffs (
      user_id, reject_sessions_started_at_or_before
    ) values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', now()
    ) on conflict (user_id) do update
      set reject_sessions_started_at_or_before = excluded.reject_sessions_started_at_or_before$$,
  '42501',
  null,
  '인증 사용자는 cutoff를 직접 변경할 권한이 없다'
);

reset role;

select ok(
  (
    select relrowsecurity
      from pg_class
     where oid = 'public.walk_sessions'::regclass
  ),
  'walk_sessions RLS가 활성화되어 있다'
);

select ok(
  (
    select relrowsecurity
      from pg_class
     where oid = 'public.gps_points'::regclass
  ),
  'gps_points RLS가 활성화되어 있다'
);

select is(
  (
    select count(*)
      from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name in (
         'walk_sessions',
         'gps_points',
         'measurement_events',
         'point_quality',
         'session_metrics',
         'user_data_deletion_cutoffs'
       )
       and grantee = 'anon'
  ),
  0::bigint,
  'anon에는 사용자 테이블 권한이 없다'
);

insert into public.gps_points (
  id, session_id, user_id, sequence_no, measured_at, received_at,
  latitude, longitude, accuracy_m, schema_version
) values (
  '99999999-0000-4000-8000-000000000001',
  '55555555-5555-4555-8555-555555555555',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  1, now(), now(), 37.1, 127.2, 8.5, 1
);

select lives_ok(
  $$delete from public.walk_sessions
     where id = '55555555-5555-4555-8555-555555555555'$$,
  '관리자 삭제 절차는 session을 삭제할 수 있다'
);

select is(
  (
    select count(*)
      from public.gps_points
     where session_id = '55555555-5555-4555-8555-555555555555'
  ),
  0::bigint,
  '관리자 session 삭제 시 자식 GPS 원본이 cascade 삭제된다'
);

select is(
  (
    select count(*)
      from pg_class
     where oid in (
       'public.walk_sessions'::regclass,
       'public.gps_points'::regclass,
       'public.measurement_events'::regclass,
       'public.point_quality'::regclass,
       'public.session_metrics'::regclass,
       'public.user_data_deletion_cutoffs'::regclass
     )
       and relrowsecurity
  ),
  6::bigint,
  '모든 사용자 데이터 테이블에 RLS가 활성화되어 있다'
);

select * from finish();
rollback;
