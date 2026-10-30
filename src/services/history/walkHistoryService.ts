import type {
  WalkAnalysis,
  WalkHistoryItem,
  WalkSessionDetail,
} from '../../domain/history'
import type { LocalWalkSession, RawGpsPoint } from '../../domain/measurement'
import {
  localMeasurementRepository,
  type LocalMeasurementRepository,
} from '../../repositories/local/localMeasurementRepository'
import {
  remoteHistoryRepository,
  type RemoteHistoryRepository,
} from '../../repositories/remote/historyRepository'
import { analyzeWalkSession } from '../analysis/walkingAnalysis'
import { reportDevelopmentError } from '../../utils/developmentError'

export interface WalkHistoryService {
  listCompletedSessions: (ownerUserId: string) => Promise<WalkHistoryItem[]>
  getSessionDetail: (
    ownerUserId: string,
    sessionId: string,
  ) => Promise<WalkSessionDetail | null>
  analyzeAndSave: (
    ownerUserId: string,
    detail: WalkSessionDetail,
  ) => Promise<{
    analysis: WalkAnalysis
    savedLocally: boolean
    savedOnServer: boolean
  }>
}

function durationSeconds(session: LocalWalkSession): number {
  if (session.endedAt === null) {
    return 0
  }
  return Math.max(
    0,
    (Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 1000,
  )
}

function mergePoints(
  localPoints: RawGpsPoint[],
  serverPoints: RawGpsPoint[],
): RawGpsPoint[] {
  const pointsById = new Map<string, RawGpsPoint>()
  localPoints.forEach((point) => pointsById.set(point.id, point))
  serverPoints.forEach((point) => pointsById.set(point.id, point))
  return [...pointsById.values()].sort(
    (first, second) =>
      first.sequenceNo - second.sequenceNo ||
      first.measuredAt.localeCompare(second.measuredAt),
  )
}

export function createWalkHistoryService(
  remote: RemoteHistoryRepository,
  local: LocalMeasurementRepository = localMeasurementRepository,
): WalkHistoryService {
  return {
    async listCompletedSessions(ownerUserId) {
      const [serverItems, localSessions] = await Promise.all([
        remote.listCompletedSessions(ownerUserId),
        local.listSessions(ownerUserId),
      ])
      const merged = new Map<string, WalkHistoryItem>()

      for (const session of localSessions) {
        if (session.status !== 'completed' || session.endedAt === null) {
          continue
        }
        const points = await local.listPoints(
          ownerUserId,
          session.id,
        )
        merged.set(session.id, {
          id: session.id,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          durationSeconds: durationSeconds(session),
          pointCount: points.length,
          source: 'local',
        })
      }

      for (const item of serverItems) {
        const localItem = merged.get(item.id)
        merged.set(item.id, {
          ...item,
          pointCount: Math.max(item.pointCount, localItem?.pointCount ?? 0),
          source: localItem === undefined ? 'server' : 'both',
        })
      }

      return [...merged.values()].sort(
        (first, second) =>
          Date.parse(second.startedAt) - Date.parse(first.startedAt),
      )
    },

    async getSessionDetail(ownerUserId, sessionId) {
      const [serverSession, localSession] = await Promise.all([
        remote.getCompletedSession(ownerUserId, sessionId),
        local.getSession(ownerUserId, sessionId),
      ])
      const completedLocalSession =
        localSession?.status === 'completed' ? localSession : null
      const session = serverSession ?? completedLocalSession

      if (session === null) {
        return null
      }

      const [serverPoints, localPoints] = await Promise.all([
        serverSession === null
          ? Promise.resolve([])
          : remote.listSessionPoints(ownerUserId, sessionId),
        completedLocalSession === null
          ? Promise.resolve([])
          : local.listPoints(ownerUserId, sessionId),
      ])

      return {
        session,
        points: mergePoints(localPoints, serverPoints),
        existsLocally: completedLocalSession !== null,
        existsOnServer: serverSession !== null,
      }
    },

    async analyzeAndSave(ownerUserId, detail) {
      const analysis = analyzeWalkSession(detail.session, detail.points)
      let savedLocally = false
      let savedOnServer = false

      if (detail.existsLocally) {
        try {
          await local.saveAnalysis(
            ownerUserId,
            analysis.quality,
            analysis.metrics,
          )
          savedLocally = true
        } catch (error) {
          reportDevelopmentError('local analysis save failed', error)
        }
      }

      if (detail.existsOnServer) {
        try {
          await remote.saveAnalysis(
            ownerUserId,
            analysis.quality,
            analysis.metrics,
          )
          savedOnServer = true
        } catch (error) {
          // 분석 표시는 유지하고 서버 파생 결과 저장 실패만 구분한다.
          reportDevelopmentError('server analysis save failed', error)
        }
      }

      return { analysis, savedLocally, savedOnServer }
    },
  }
}

export const walkHistoryService = createWalkHistoryService(
  remoteHistoryRepository,
)
