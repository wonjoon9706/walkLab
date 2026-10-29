import { afterEach, describe, expect, it } from 'vitest'
import type { RawGpsPoint } from '../../domain/measurement'
import { createLocalMeasurementRepository } from './localMeasurementRepository'
import {
  createWalkLabDatabase,
  type WalkLabDatabase,
} from './walkLabDatabase'

let database: WalkLabDatabase | null = null

function createRepository() {
  database = createWalkLabDatabase(`walklab-test-${crypto.randomUUID()}`)
  return createLocalMeasurementRepository(database)
}

async function createSession(ownerUserId = 'user-a') {
  const repository = createRepository()
  const session = await repository.createSession({
    id: 'session-1',
    ownerUserId,
    startedAt: '2026-10-29T00:00:00.000Z',
    sourcePlatform: 'web-browser',
    eventId: 'event-start',
  })
  return { repository, session }
}

function createPoint(id = 'point-1', sequenceNo = 1): RawGpsPoint {
  return {
    id,
    sessionId: 'session-1',
    sequenceNo,
    measuredAt: '2026-10-29T00:00:01.000Z',
    receivedAt: '2026-10-29T00:00:01.100Z',
    latitude: 37.1,
    longitude: 127.2,
    accuracyM: 9.5,
    altitudeM: null,
    altitudeAccuracyM: null,
    deviceSpeedMps: null,
    headingDeg: null,
    schemaVersion: 1,
  }
}

afterEach(async () => {
  if (database !== null) {
    const currentDatabase = database
    database = null
    currentDatabase.close()
    await currentDatabase.delete()
  }
})

describe('LocalMeasurementRepository', () => {
  it('Dexie v1의 여덟 store를 만든다', async () => {
    createRepository()
    await database?.open()

    const storeNames = database?.tables.map((table) => table.name).sort()
    expect(storeNames).toEqual([
      'deletionCutoffs',
      'gpsPoints',
      'measurementEvents',
      'meta',
      'pointQuality',
      'sessionMetrics',
      'sessions',
      'syncItems',
    ])
  })

  it('세션과 시작 이벤트 및 pending 항목을 한 번에 저장한다', async () => {
    const { session } = await createSession()

    expect(session.ownerUserId).toBe('user-a')
    expect(await database?.sessions.count()).toBe(1)
    expect(await database?.measurementEvents.count()).toBe(1)
    expect(await database?.syncItems.count()).toBe(2)
    expect((await database?.syncItems.toArray())?.every((item) => item.state === 'pending')).toBe(true)
  })

  it('point와 sync item 중 하나가 실패하면 둘 다 남기지 않는다', async () => {
    const { repository } = await createSession()
    const point = createPoint()
    await database?.syncItems.add({
      key: `gps_point:${point.id}`,
      ownerUserId: 'user-a',
      entityType: 'gps_point',
      entityId: point.id,
      sessionId: point.sessionId,
      state: 'pending',
      attemptCount: 0,
      nextRetryAt: null,
      lastErrorCode: null,
      serverConfirmedAt: null,
      createdAt: point.receivedAt,
      updatedAt: point.receivedAt,
    })

    await expect(repository.savePoint('user-a', point)).rejects.toBeDefined()
    expect(await database?.gpsPoints.count()).toBe(0)
  })

  it('원본 point를 덮어쓰지 않고 null 필드를 보존한다', async () => {
    const { repository } = await createSession()
    const point = createPoint()
    const originalSnapshot = structuredClone(point)

    await repository.savePoint('user-a', point)
    await expect(repository.savePoint('user-a', point)).rejects.toBeDefined()

    const storedPoints = await repository.listPoints('user-a', 'session-1')
    expect(storedPoints).toEqual([originalSnapshot])
    expect(point).toEqual(originalSnapshot)
  })

  it('다른 소유자의 조회와 상태 변경을 거부한다', async () => {
    const { repository } = await createSession('user-a')

    expect(await repository.getSession('user-b', 'session-1')).toBeUndefined()
    expect(await repository.listSessions('user-b')).toEqual([])
    expect(await repository.listPoints('user-b', 'session-1')).toEqual([])
    await expect(
      repository.setSessionStatus('user-b', 'session-1', 'completed'),
    ).rejects.toThrow('LOCAL_SESSION_OWNER_MISMATCH')
    await expect(
      database?.sessions.update('session-1', { ownerUserId: 'user-b' }),
    ).rejects.toThrow('LOCAL_SESSION_OWNER_IMMUTABLE')

    expect((await database?.sessions.get('session-1'))?.ownerUserId).toBe('user-a')
  })

  it('남아 있는 recording 세션을 interrupted로 복구하고 종료 시각은 비워 둔다', async () => {
    const { repository } = await createSession()
    await repository.setSessionStatus('user-a', 'session-1', 'recording')

    expect(await repository.recoverInterruptedSessions('user-a')).toBe(1)
    const recovered = await repository.getSession('user-a', 'session-1')
    const events = await repository.listEvents('user-a', 'session-1')

    expect(recovered?.status).toBe('interrupted')
    expect(recovered?.endedAt).toBeNull()
    expect(events.some((event) => event.eventType === 'measurement_interrupted')).toBe(true)
  })
})
