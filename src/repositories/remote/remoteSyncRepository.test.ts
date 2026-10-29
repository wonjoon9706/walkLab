import { describe, expect, it } from 'vitest'
import type { LocalWalkSession, MeasurementEvent, RawGpsPoint } from '../../domain/measurement'
import {
  toGpsPointRow,
  toMeasurementEventRow,
  toRemoteFailure,
  toWalkSessionRow,
} from './remoteSyncRepository'

describe('RemoteSyncRepository DTO', () => {
  it('세션을 PostgreSQL snake_case 구조로 변환한다', () => {
    const session: LocalWalkSession = {
      id: 'session-1',
      ownerUserId: 'user-a',
      installationId: 'installation-1',
      status: 'completed',
      startedAt: '2026-10-29T00:00:00.000Z',
      endedAt: '2026-10-29T00:10:00.000Z',
      sourcePlatform: 'web-ios-safari',
      appVersion: '0.0.0',
      schemaVersion: 1,
      createdAt: '2026-10-29T00:00:00.000Z',
      updatedAt: '2026-10-29T00:10:00.000Z',
    }

    expect(toWalkSessionRow(session)).toEqual({
      id: 'session-1',
      user_id: 'user-a',
      installation_id: 'installation-1',
      status: 'completed',
      started_at: '2026-10-29T00:00:00.000Z',
      ended_at: '2026-10-29T00:10:00.000Z',
      source_platform: 'web-ios-safari',
      app_version: '0.0.0',
      schema_version: 1,
    })
  })

  it('GPS 시각과 null 원본 필드를 변경하지 않는다', () => {
    const point: RawGpsPoint = {
      id: 'point-1',
      sessionId: 'session-1',
      sequenceNo: 1,
      measuredAt: '2026-10-29T00:00:01.000Z',
      receivedAt: '2026-10-29T00:00:02.000Z',
      latitude: 37.1,
      longitude: 127.2,
      accuracyM: 8,
      altitudeM: null,
      altitudeAccuracyM: null,
      deviceSpeedMps: null,
      headingDeg: null,
      schemaVersion: 1,
    }

    const row = toGpsPointRow('user-a', point)
    expect(row.measured_at).toBe(point.measuredAt)
    expect(row.received_at).toBe(point.receivedAt)
    expect(row.altitude_m).toBeNull()
    expect(row.altitude_accuracy_m).toBeNull()
    expect(row.device_speed_mps).toBeNull()
    expect(row.heading_deg).toBeNull()
  })

  it('측정 이벤트를 원본 지점과 다른 테이블 구조로 변환한다', () => {
    const event: MeasurementEvent = {
      id: 'event-1',
      sessionId: 'session-1',
      eventType: 'position_timeout',
      occurredAt: '2026-10-29T00:00:03.000Z',
      receivedAt: '2026-10-29T00:00:04.000Z',
      errorCode: 'GEOLOCATION_TIMEOUT',
      details: null,
      schemaVersion: 1,
    }

    expect(toMeasurementEventRow('user-a', event)).toMatchObject({
      id: 'event-1',
      user_id: 'user-a',
      event_type: 'position_timeout',
      occurred_at: event.occurredAt,
      received_at: event.receivedAt,
    })
  })

  it('서버 오류를 재시도·인증·권한·검증 오류로 구분한다', () => {
    expect(toRemoteFailure(new TypeError('network')).kind).toBe('transient')
    expect(toRemoteFailure({ code: 'PGRST301' }).kind).toBe('auth')
    expect(toRemoteFailure({ code: '42501' }).kind).toBe('forbidden')
    expect(toRemoteFailure({ code: '23503' }).kind).toBe('validation')
    expect(
      toRemoteFailure({ message: 'SESSION_SUPPRESSED_BY_DELETION' }).kind,
    ).toBe('deletion')
  })
})
