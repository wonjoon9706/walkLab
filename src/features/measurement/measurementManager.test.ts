import { describe, expect, it, vi } from 'vitest'
import type {
  LocalWalkSession,
  RawGpsPoint,
} from '../../domain/measurement'
import type { LocalMeasurementRepository } from '../../repositories/local/localMeasurementRepository'
import type { GpsCollector } from '../../services/gps/gpsCollector'
import {
  createMeasurementManager,
  type MeasurementManagerDependencies,
} from './measurementManager'

const testUser = { id: 'user-a', email: 'walklab@example.com' }

function createFakeRepository(
  changes: Partial<LocalMeasurementRepository> = {},
): LocalMeasurementRepository {
  return {
    createSession: vi.fn(async (input) => ({
      id: input.id,
      ownerUserId: input.ownerUserId,
      status: 'starting',
      startedAt: input.startedAt,
      endedAt: null,
      installationId: 'installation-1',
      sourcePlatform: input.sourcePlatform,
      appVersion: '0.0.0',
      schemaVersion: 1,
      createdAt: input.startedAt,
      updatedAt: input.startedAt,
    } satisfies LocalWalkSession)),
    setSessionStatus: vi.fn().mockResolvedValue(undefined),
    savePoint: vi.fn().mockResolvedValue(undefined),
    saveEvent: vi.fn().mockResolvedValue(undefined),
    recoverInterruptedSessions: vi.fn().mockResolvedValue(0),
    getSession: vi.fn().mockResolvedValue(undefined),
    listSessions: vi.fn().mockResolvedValue([]),
    listPoints: vi.fn().mockResolvedValue([]),
    listEvents: vi.fn().mockResolvedValue([]),
    ...changes,
  }
}

function createTestManager(repository = createFakeRepository()) {
  let onPosition: PositionCallback | null = null
  let onError: PositionErrorCallback | null = null
  let id = 0
  const collector: GpsCollector = {
    start: vi.fn((nextPosition, nextError) => {
      onPosition = nextPosition
      onError = nextError
    }),
    stop: vi.fn(),
    isRunning: vi.fn().mockReturnValue(true),
  }
  const dependencies: MeasurementManagerDependencies = {
    repository,
    createCollector: vi.fn(() => collector),
    getOnline: vi.fn(() => true),
    getSecureContext: vi.fn(() => true),
    getSourcePlatform: vi.fn(() => 'web-ios-safari'),
    now: vi.fn(() => new Date('2026-10-29T00:00:02.000Z')),
    createId: vi.fn(() => `id-${++id}`),
  }
  const manager = createMeasurementManager(dependencies)

  return {
    manager,
    repository,
    collector,
    dependencies,
    emitPosition(position: GeolocationPosition) {
      if (onPosition === null) {
        throw new Error('watcher가 시작되지 않았습니다.')
      }
      onPosition(position)
    },
    emitError(error: GeolocationPositionError) {
      if (onError === null) {
        throw new Error('watcher가 시작되지 않았습니다.')
      }
      onError(error)
    },
  }
}

function createPosition(timestamp: number, latitude = 37.1): GeolocationPosition {
  return {
    timestamp,
    coords: {
      latitude,
      longitude: 127.2,
      accuracy: 8,
      altitude: null,
      altitudeAccuracy: null,
      speed: null,
      heading: null,
      toJSON: () => ({}),
    },
    toJSON: () => ({}),
  }
}

function createPositionError(code: number): GeolocationPositionError {
  return {
    code,
    message: 'test error',
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  }
}

async function startManager(
  manager: ReturnType<typeof createMeasurementManager>,
) {
  await manager.start({
    user: testUser,
    confirmCurrentUser: vi.fn().mockResolvedValue(testUser),
  })
}

describe('MeasurementManager', () => {
  it('사용자 시작 전에는 watcher를 호출하지 않고 온라인·인증 확인 후 한 번만 시작한다', async () => {
    const test = createTestManager()
    expect(test.dependencies.createCollector).not.toHaveBeenCalled()

    await startManager(test.manager)
    await startManager(test.manager)

    expect(test.repository.createSession).toHaveBeenCalledOnce()
    expect(test.collector.start).toHaveBeenCalledOnce()
    expect(test.manager.getState().status).toBe('recording')
  })

  it('오프라인이면 session과 watcher를 만들지 않는다', async () => {
    const test = createTestManager()
    vi.mocked(test.dependencies.getOnline).mockReturnValue(false)

    await startManager(test.manager)

    expect(test.repository.createSession).not.toHaveBeenCalled()
    expect(test.dependencies.createCollector).not.toHaveBeenCalled()
    expect(test.manager.getState().message).toContain('인터넷 연결')
  })

  it('모든 위치 콜백을 순서대로 저장하고 시각과 null 원본을 보존한다', async () => {
    const test = createTestManager()
    await startManager(test.manager)

    test.emitPosition(createPosition(Date.parse('2026-10-29T00:00:00.000Z')))
    test.emitPosition(createPosition(Date.parse('2026-10-29T00:00:01.000Z'), 37.2))
    await test.manager.stop()

    const calls = vi.mocked(test.repository.savePoint).mock.calls
    const points = calls.map((call) => call[1] as RawGpsPoint)
    expect(points.map((point) => point.sequenceNo)).toEqual([1, 2])
    expect(points[0]).toMatchObject({
      measuredAt: '2026-10-29T00:00:00.000Z',
      receivedAt: '2026-10-29T00:00:02.000Z',
      altitudeM: null,
      altitudeAccuracyM: null,
      deviceSpeedMps: null,
      headingDeg: null,
    })
    expect(points[0].id).not.toBe(points[1].id)
    expect(calls[0][2]?.eventType).toBe('measurement_started')
    expect(calls[1][2]).toBeUndefined()
    expect(test.collector.stop).toHaveBeenCalledOnce()
    expect(test.manager.getState()).toMatchObject({
      status: 'completed',
      savedPointCount: 2,
      firstSavedSequenceNo: 1,
      lastSavedSequenceNo: 2,
      nullOptionalFieldCount: 8,
      gpsStatus: 'stopped',
    })
  })

  it.each([
    [1, 'permission_denied'],
    [2, 'position_unavailable'],
    [3, 'position_timeout'],
  ])('GPS 오류 code %s를 point가 아닌 %s 이벤트로 저장한다', async (code, eventType) => {
    const test = createTestManager()
    await startManager(test.manager)

    test.emitError(createPositionError(code))
    if (code !== 1) {
      await test.manager.stop()
    } else {
      await Promise.resolve()
      await Promise.resolve()
    }

    const savedEvents = vi.mocked(test.repository.saveEvent).mock.calls.map(
      (call) => call[0],
    )
    expect(savedEvents.some((event) => event.eventType === eventType)).toBe(true)
    expect(test.repository.savePoint).not.toHaveBeenCalled()
  })

  it('한 위치 저장이 실패해도 다음 위치를 계속 저장한다', async () => {
    const savePoint = vi
      .fn()
      .mockRejectedValueOnce(new Error('IndexedDB failure'))
      .mockResolvedValueOnce(undefined)
    const repository = createFakeRepository({ savePoint })
    const test = createTestManager(repository)
    await startManager(test.manager)

    test.emitPosition(createPosition(1))
    test.emitPosition(createPosition(2))
    await test.manager.stop()

    expect(savePoint).toHaveBeenCalledTimes(2)
    expect(test.manager.getState().savedPointCount).toBe(1)
    expect(test.manager.getState().failedSaveCount).toBe(1)
  })

  it('이전 recording 세션을 interrupted로 복구해도 watcher를 자동 시작하지 않는다', async () => {
    const repository = createFakeRepository({
      recoverInterruptedSessions: vi.fn().mockResolvedValue(1),
    })
    const test = createTestManager(repository)

    await test.manager.recover('user-a')

    expect(test.manager.getState().status).toBe('interrupted')
    expect(test.dependencies.createCollector).not.toHaveBeenCalled()
  })
})
