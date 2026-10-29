import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  LocalWalkSession,
  MeasurementEvent,
  RawGpsPoint,
} from '../../domain/measurement'
import { createLocalMeasurementRepository } from '../../repositories/local/localMeasurementRepository'
import {
  createWalkLabDatabase,
  type WalkLabDatabase,
} from '../../repositories/local/walkLabDatabase'
import type {
  RemoteSyncRepository,
  RemoteWriteResult,
} from '../../repositories/remote/remoteSyncRepository'
import { createSyncCoordinator } from './syncCoordinator'

let database: WalkLabDatabase | null = null

const userA = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: null }

function createRemote(overrides: Partial<RemoteSyncRepository> = {}) {
  const remote: RemoteSyncRepository = {
    getDeletionCutoff: vi.fn().mockResolvedValue(null),
    syncSession: vi.fn(async (session) => ({
      confirmedIds: [session.id],
      failure: null,
    })),
    syncPoints: vi.fn(async (_owner: string, points: RawGpsPoint[]) => ({
      confirmedIds: points.map((point) => point.id),
      failure: null,
    })),
    syncEvents: vi.fn(async (_owner: string, events: MeasurementEvent[]) => ({
      confirmedIds: events.map((event) => event.id),
      failure: null,
    })),
    ...overrides,
  }
  return remote
}

async function createLocalData(ownerUserId = userA.id) {
  database = createWalkLabDatabase(`sync-test-${crypto.randomUUID()}`)
  const local = createLocalMeasurementRepository(database)
  await local.createSession({
    id: '11111111-1111-4111-8111-111111111111',
    ownerUserId,
    startedAt: '2026-10-29T00:00:00.000Z',
    sourcePlatform: 'web-ios-safari',
    eventId: '22222222-2222-4222-8222-222222222222',
  })
  const point: RawGpsPoint = {
    id: '33333333-3333-4333-8333-333333333333',
    sessionId: '11111111-1111-4111-8111-111111111111',
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
  const startedEvent: MeasurementEvent = {
    id: '44444444-4444-4444-8444-444444444444',
    sessionId: point.sessionId,
    eventType: 'measurement_started',
    occurredAt: point.measuredAt,
    receivedAt: point.receivedAt,
    errorCode: null,
    details: null,
    schemaVersion: 1,
  }
  await local.savePoint(ownerUserId, point, startedEvent)
  await local.setSessionStatus(
    ownerUserId,
    point.sessionId,
    'completed',
    '2026-10-29T00:10:00.000Z',
  )
  return local
}

function createCoordinator(
  local: ReturnType<typeof createLocalMeasurementRepository>,
  remote: RemoteSyncRepository,
  overrides: Record<string, unknown> = {},
) {
  const sleep = vi.fn().mockResolvedValue(undefined)
  const coordinator = createSyncCoordinator({
    localRepository: local,
    remoteRepository: remote,
    getCurrentUser: vi.fn().mockResolvedValue(userA),
    refreshCurrentUser: vi.fn().mockResolvedValue(userA),
    getOnline: vi.fn(() => true),
    now: vi.fn(() => new Date('2026-10-29T00:20:00.000Z')),
    sleep,
    setTimer: vi.fn(() => 1),
    clearTimer: vi.fn(),
    ...overrides,
  })
  return { coordinator, sleep }
}

afterEach(async () => {
  if (database !== null) {
    const current = database
    database = null
    current.close()
    await current.delete()
  }
})

describe('SyncCoordinator', () => {
  it('session을 확인한 뒤 point와 event를 전송하고 확인된 항목만 완료한다', async () => {
    const local = await createLocalData()
    const order: string[] = []
    const remote = createRemote({
      syncSession: vi.fn(async (session) => {
        order.push('session')
        return { confirmedIds: [session.id], failure: null }
      }),
      syncPoints: vi.fn(async (_owner: string, points: RawGpsPoint[]) => {
        order.push('points')
        return { confirmedIds: points.map((point) => point.id), failure: null }
      }),
      syncEvents: vi.fn(async (_owner: string, events: MeasurementEvent[]) => {
        order.push('events')
        return { confirmedIds: events.map((event) => event.id), failure: null }
      }),
    })
    const { coordinator } = createCoordinator(local, remote)

    await coordinator.run('test')

    expect(order).toEqual(['session', 'points', 'events'])
    const summary = await local.getSyncSummary(userA.id)
    expect(summary.confirmed).toBe(4)
    expect(summary.pending).toBe(0)
    expect(coordinator.getState().status).toBe('synced')
  })

  it('이미 확인된 데이터는 다시 전송하지 않는다', async () => {
    const local = await createLocalData()
    const remote = createRemote()
    const { coordinator } = createCoordinator(local, remote)

    await coordinator.run('first')
    await coordinator.run('second')

    expect(remote.syncSession).toHaveBeenCalledOnce()
    expect(remote.syncPoints).toHaveBeenCalledOnce()
    expect(remote.syncEvents).toHaveBeenCalledOnce()
  })

  it('일시적인 서버 오류를 5초·30초·120초 간격으로 재시도한다', async () => {
    const local = await createLocalData()
    const syncSession = vi
      .fn()
      .mockResolvedValueOnce({
        confirmedIds: [],
        failure: { kind: 'transient', code: '500' },
      })
      .mockResolvedValueOnce({
        confirmedIds: [],
        failure: { kind: 'transient', code: '500' },
      })
      .mockResolvedValueOnce({
        confirmedIds: [],
        failure: { kind: 'transient', code: '500' },
      })
      .mockImplementation(async (session) => ({
        confirmedIds: [session.id],
        failure: null,
      }))
    const remote = createRemote({ syncSession })
    const { coordinator, sleep } = createCoordinator(local, remote)

    await coordinator.run('retry')

    expect(sleep.mock.calls.map((call) => call[0])).toEqual([
      5_000,
      30_000,
      120_000,
    ])
    expect(syncSession).toHaveBeenCalledTimes(4)
    expect((await local.getSyncSummary(userA.id)).confirmed).toBe(4)
  })

  it('인증 오류는 세션을 한 번 갱신한 뒤 재시도한다', async () => {
    const local = await createLocalData()
    const syncSession = vi
      .fn()
      .mockResolvedValueOnce({
        confirmedIds: [],
        failure: { kind: 'auth', code: '401' },
      })
      .mockImplementation(async (session) => ({
        confirmedIds: [session.id],
        failure: null,
      }))
    const refreshCurrentUser = vi.fn().mockResolvedValue(userA)
    const remote = createRemote({ syncSession })
    const { coordinator } = createCoordinator(local, remote, {
      refreshCurrentUser,
    })

    await coordinator.run('auth')

    expect(refreshCurrentUser).toHaveBeenCalledOnce()
    expect(syncSession).toHaveBeenCalledTimes(2)
  })

  it('재시도를 모두 실패하면 원본은 유지하고 retry wait로 남긴다', async () => {
    const local = await createLocalData()
    const remote = createRemote({
      syncSession: vi.fn().mockResolvedValue({
        confirmedIds: [],
        failure: { kind: 'transient', code: 'NETWORK_ERROR' },
      }),
    })
    const { coordinator } = createCoordinator(local, remote)

    await coordinator.run('retry_exhausted')

    expect((await local.getSyncSummary(userA.id)).retry_wait).toBe(1)
    expect(
      await local.listPoints(
        userA.id,
        '11111111-1111-4111-8111-111111111111',
      ),
    ).toHaveLength(1)
  })

  it('부분 성공 시 확인된 항목만 confirmed로 남긴다', async () => {
    const local = await createLocalData()
    const secondPoint: RawGpsPoint = {
      ...(await local.listPoints(userA.id, '11111111-1111-4111-8111-111111111111'))[0],
      id: '55555555-5555-4555-8555-555555555555',
      sequenceNo: 2,
    }
    await local.savePoint(userA.id, secondPoint)
    const remote = createRemote({
      syncPoints: vi.fn(async (_owner: string, points: RawGpsPoint[]) => ({
        confirmedIds: [points[0].id],
        failure: { kind: 'validation' as const, code: '23505' },
      })),
    })
    const { coordinator } = createCoordinator(local, remote)

    await coordinator.run('partial')

    const summary = await local.getSyncSummary(userA.id)
    expect(summary.confirmed).toBe(4)
    expect(summary.failed).toBe(1)
    expect(coordinator.getState().status).toBe('partial')
  })

  it('cutoff 이전 session과 자식은 전송하지 않는다', async () => {
    const local = await createLocalData()
    const remote = createRemote({
      getDeletionCutoff: vi
        .fn()
        .mockResolvedValue('2026-10-29T00:00:00.000Z'),
    })
    const { coordinator } = createCoordinator(local, remote)

    await coordinator.run('cutoff')

    expect(remote.syncSession).not.toHaveBeenCalled()
    expect((await local.getSyncSummary(userA.id)).suppressed_by_deletion).toBe(4)
  })

  it('동시에 실행을 요청해도 하나의 동기화만 수행한다', async () => {
    const local = await createLocalData()
    let resolveSession: () => void = () => undefined
    const remote = createRemote({
      syncSession: vi.fn(
        (session: LocalWalkSession) =>
          new Promise<RemoteWriteResult>((resolve) => {
            resolveSession = () =>
              resolve({ confirmedIds: [session.id], failure: null })
          }),
      ),
    })
    const { coordinator } = createCoordinator(local, remote)

    const first = coordinator.run('first')
    const second = coordinator.run('second')
    await vi.waitFor(() => expect(remote.syncSession).toHaveBeenCalledOnce())
    resolveSession()
    await Promise.all([first, second])

    expect(remote.syncSession).toHaveBeenCalledOnce()
  })

  it('오프라인에서는 서버 요청 없이 대기한다', async () => {
    const local = await createLocalData()
    const remote = createRemote()
    const { coordinator } = createCoordinator(local, remote, {
      getOnline: vi.fn(() => false),
    })

    await coordinator.run('offline')

    expect(remote.getDeletionCutoff).not.toHaveBeenCalled()
    expect(coordinator.getState().status).toBe('offline')
  })

  it('네트워크 복구 후 같은 pending 데이터를 다시 처리한다', async () => {
    const local = await createLocalData()
    const remote = createRemote()
    let online = false
    const { coordinator } = createCoordinator(local, remote, {
      getOnline: vi.fn(() => online),
    })

    await coordinator.run('offline')
    online = true
    await coordinator.run('online')

    expect(remote.syncSession).toHaveBeenCalledOnce()
    expect((await local.getSyncSummary(userA.id)).confirmed).toBe(4)
  })
})
