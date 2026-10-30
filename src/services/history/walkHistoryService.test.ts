import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalMeasurementRepository } from '../../repositories/local/localMeasurementRepository'
import {
  createWalkLabDatabase,
  type WalkLabDatabase,
} from '../../repositories/local/walkLabDatabase'
import type { RemoteHistoryRepository } from '../../repositories/remote/historyRepository'
import { createWalkHistoryService } from './walkHistoryService'

let database: WalkLabDatabase | null = null

function createRemote(): RemoteHistoryRepository {
  return {
    listCompletedSessions: vi.fn().mockResolvedValue([
      {
        id: 'shared-session',
        startedAt: '2026-10-30T01:00:00.000Z',
        endedAt: '2026-10-30T01:01:00.000Z',
        durationSeconds: 60,
        pointCount: 10,
        source: 'server',
      },
      {
        id: 'server-session',
        startedAt: '2026-10-30T02:00:00.000Z',
        endedAt: '2026-10-30T02:01:00.000Z',
        durationSeconds: 60,
        pointCount: 20,
        source: 'server',
      },
    ]),
    getCompletedSession: vi.fn().mockResolvedValue(null),
    listSessionPoints: vi.fn().mockResolvedValue([]),
    saveAnalysis: vi.fn().mockResolvedValue(undefined),
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

describe('WalkHistoryService', () => {
  it('로컬과 서버 기록을 session ID로 합쳐 최근 순서로 반환한다', async () => {
    database = createWalkLabDatabase(`walklab-history-${crypto.randomUUID()}`)
    const local = createLocalMeasurementRepository(database)
    for (const id of ['local-session', 'shared-session']) {
      await local.createSession({
        id,
        ownerUserId: 'user-a',
        startedAt:
          id === 'local-session'
            ? '2026-10-30T03:00:00.000Z'
            : '2026-10-30T01:00:00.000Z',
        sourcePlatform: 'web',
        eventId: `event-${id}`,
      })
      await local.setSessionStatus(
        'user-a',
        id,
        'completed',
        id === 'local-session'
          ? '2026-10-30T03:01:00.000Z'
          : '2026-10-30T01:01:00.000Z',
      )
    }
    const service = createWalkHistoryService(createRemote(), local)

    const records = await service.listCompletedSessions('user-a')

    expect(records.map((record) => record.id)).toEqual([
      'local-session',
      'server-session',
      'shared-session',
    ])
    expect(records.filter((record) => record.id === 'shared-session')).toHaveLength(1)
    expect(records.find((record) => record.id === 'shared-session')?.source).toBe('both')
  })

  it('다른 사용자 소유의 로컬 상세를 반환하지 않는다', async () => {
    database = createWalkLabDatabase(`walklab-owner-${crypto.randomUUID()}`)
    const local = createLocalMeasurementRepository(database)
    await local.createSession({
      id: 'private-session',
      ownerUserId: 'user-a',
      startedAt: '2026-10-30T00:00:00.000Z',
      sourcePlatform: 'web',
      eventId: 'event-private',
    })
    await local.setSessionStatus(
      'user-a',
      'private-session',
      'completed',
      '2026-10-30T00:01:00.000Z',
    )
    const service = createWalkHistoryService(
      {
        ...createRemote(),
        listCompletedSessions: vi.fn().mockResolvedValue([]),
      },
      local,
    )

    await expect(
      service.getSessionDetail('user-b', 'private-session'),
    ).resolves.toBeNull()
  })

  it('파생 분석 결과 저장이 실패해도 계산된 상세 결과를 반환한다', async () => {
    database = createWalkLabDatabase(`walklab-save-failure-${crypto.randomUUID()}`)
    const local = createLocalMeasurementRepository(database)
    const service = createWalkHistoryService(createRemote(), local)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const result = await service.analyzeAndSave('user-a', {
      session: {
        id: 'missing-local-session',
        ownerUserId: 'user-a',
        status: 'completed',
        startedAt: '2026-10-30T00:00:00.000Z',
        endedAt: '2026-10-30T00:01:00.000Z',
        installationId: 'installation-1',
        sourcePlatform: 'web',
        appVersion: '0.0.0',
        schemaVersion: 1,
        createdAt: '2026-10-30T00:00:00.000Z',
        updatedAt: '2026-10-30T00:01:00.000Z',
      },
      points: [],
      existsLocally: true,
      existsOnServer: false,
    })

    expect(result.analysis.metrics.rawPointCount).toBe(0)
    expect(result.savedLocally).toBe(false)
    expect(consoleError).toHaveBeenCalledWith(
      '[WalkLab G5] local analysis save failed: LOCAL_SESSION_OWNER_MISMATCH',
    )
    consoleError.mockRestore()
  })
})
