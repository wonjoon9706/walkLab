import type { WalkHistoryItem } from '../../domain/history'
import type {
  AnalysisExclusionReason,
  PersonalWalkingSummary,
  SessionComparison,
} from '../../domain/movementAnalysis'
import type { WalkHistoryService } from '../history/walkHistoryService'
import { analyzeMovement } from './movementAnalysis'
import { analyzeWalkSession } from './walkingAnalysis'

const MIN_DURATION_SECONDS = 60
const MIN_DISTANCE_M = 100
const MIN_POINT_COUNT = 20
const MIN_QUALITY_RATIO = 0.7
const MIN_SESSIONS_FOR_COMPARISON = 3

export function getAnalysisExclusionReasons(
  comparison: Pick<SessionComparison, 'metrics'>,
): AnalysisExclusionReason[] {
  const { metrics } = comparison
  const reasons: AnalysisExclusionReason[] = []
  const qualityRatio =
    metrics.rawPointCount > 0
      ? metrics.filteredPointCount / metrics.rawPointCount
      : 0

  if (
    metrics.durationSeconds === null ||
    metrics.durationSeconds < MIN_DURATION_SECONDS
  ) {
    reasons.push('too_short')
  }
  if (metrics.filteredDistanceM < MIN_DISTANCE_M) {
    reasons.push('too_little_distance')
  }
  if (metrics.rawPointCount < MIN_POINT_COUNT) {
    reasons.push('too_few_points')
  }
  if (qualityRatio < MIN_QUALITY_RATIO) {
    reasons.push('low_quality')
  }

  return reasons
}

export async function analyzePersonalWalkingHistory(
  ownerUserId: string,
  records: WalkHistoryItem[],
  historyService: WalkHistoryService,
): Promise<PersonalWalkingSummary> {
  const comparisons: SessionComparison[] = []

  // 한 번에 많은 GPS 페이지를 요청하지 않도록 세션별로 순서대로 분석한다.
  for (const record of records) {
    const detail = await historyService.getSessionDetail(
      ownerUserId,
      record.id,
    )
    if (detail === null) {
      throw new Error('PERSONAL_STATS_SESSION_NOT_FOUND')
    }

    const analysis = analyzeWalkSession(detail.session, detail.points)
    const movement = analyzeMovement(
      detail.session,
      detail.points,
      analysis,
    )
    const exclusionReasons = getAnalysisExclusionReasons({
      metrics: analysis.metrics,
    })

    comparisons.push({
      sessionId: record.id,
      startedAt: record.startedAt,
      metrics: analysis.metrics,
      movement,
      eligible: exclusionReasons.length === 0,
      exclusionReasons,
    })
  }

  const eligibleComparisons = comparisons.filter(
    (comparison) => comparison.eligible,
  )
  const totalDistanceM = eligibleComparisons.reduce(
    (sum, comparison) => sum + comparison.metrics.filteredDistanceM,
    0,
  )
  const movingDurationSeconds = eligibleComparisons.reduce(
    (sum, comparison) =>
      sum + comparison.movement.movingDurationSeconds,
    0,
  )
  const movingDistanceM = eligibleComparisons.reduce(
    (sum, comparison) => sum + comparison.movement.movingDistanceM,
    0,
  )

  return {
    totalSessionCount: records.length,
    eligibleSessionCount: eligibleComparisons.length,
    excludedSessionCount: records.length - eligibleComparisons.length,
    totalDistanceM,
    averageMovingSpeedMps:
      movingDurationSeconds > 0
        ? movingDistanceM / movingDurationSeconds
        : null,
    hasEnoughSamples:
      eligibleComparisons.length >= MIN_SESSIONS_FOR_COMPARISON,
    comparisons,
  }
}
