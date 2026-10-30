import type { SessionComparison } from '../../domain/movementAnalysis'
import type {
  BacktestCase,
  LearningExclusionReason,
  LearningSessionDecision,
  TrainWalkingSpeedOptions,
  WalkingSpeedBacktest,
  WalkingSpeedModel,
} from '../../domain/walkingSpeedModel'
import {
  walkingSpeedModelConfig,
  type WalkingSpeedModelConfig,
} from './walkingSpeedModelConfig'

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

interface TrainingCandidate {
  comparison: SessionComparison
  ageDays: number
  speedMps: number
}

function getAgeDays(startedAt: string, asOfTime: number): number | null {
  const startedTime = Date.parse(startedAt)
  if (!Number.isFinite(startedTime)) return null
  return (asOfTime - startedTime) / MILLISECONDS_PER_DAY
}

function normalizeWithMaximum(
  rawWeights: number[],
  maximumWeight: number,
): number[] {
  if (rawWeights.length === 0) return []
  if (rawWeights.length === 1) return [1]

  const normalized = rawWeights.map(
    (weight) => weight / rawWeights.reduce((sum, value) => sum + value, 0),
  )
  if (normalized.every((weight) => weight <= maximumWeight)) {
    return normalized
  }

  const finalWeights = Array(rawWeights.length).fill(0) as number[]
  const remainingIndexes = new Set(rawWeights.map((_weight, index) => index))
  let remainingMass = 1

  while (remainingIndexes.size > 0) {
    const remainingRawTotal = [...remainingIndexes].reduce(
      (sum, index) => sum + rawWeights[index],
      0,
    )
    const overMaximum = [...remainingIndexes].filter(
      (index) =>
        (rawWeights[index] / remainingRawTotal) * remainingMass >
        maximumWeight,
    )

    if (overMaximum.length === 0) {
      for (const index of remainingIndexes) {
        finalWeights[index] =
          (rawWeights[index] / remainingRawTotal) * remainingMass
      }
      break
    }

    for (const index of overMaximum) {
      finalWeights[index] = maximumWeight
      remainingMass -= maximumWeight
      remainingIndexes.delete(index)
    }
  }

  return finalWeights
}

function getBaseExclusionReasons(
  comparison: SessionComparison,
  ageDays: number | null,
  manuallyExcludedSessionIds: ReadonlySet<string>,
  config: WalkingSpeedModelConfig,
): LearningExclusionReason[] {
  const reasons: LearningExclusionReason[] = [...comparison.exclusionReasons]

  if (manuallyExcludedSessionIds.has(comparison.sessionId)) {
    reasons.push('manually_excluded')
  }
  if (comparison.movement.movingAverageSpeedMps === null) {
    reasons.push('missing_moving_speed')
  }
  if (ageDays === null || ageDays < 0) {
    reasons.push('future_session')
  } else if (ageDays > config.fallbackWindowDays) {
    reasons.push('outside_learning_window')
  }

  return [...new Set(reasons)]
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function trainWalkingSpeedModel(
  comparisons: SessionComparison[],
  options: TrainWalkingSpeedOptions = {},
  config: WalkingSpeedModelConfig = walkingSpeedModelConfig,
): WalkingSpeedModel {
  const asOf = options.asOf ?? new Date()
  const asOfTime = asOf.getTime()
  const manuallyExcludedSessionIds =
    options.manuallyExcludedSessionIds ?? new Set<string>()
  const baseDecisions = comparisons.map((comparison) => {
    const ageDays = getAgeDays(comparison.startedAt, asOfTime)
    const reasons = getBaseExclusionReasons(
      comparison,
      ageDays,
      manuallyExcludedSessionIds,
      config,
    )
    return { comparison, ageDays, reasons }
  })
  const availableCandidates: TrainingCandidate[] = baseDecisions
    .filter(
      (decision) =>
        decision.reasons.length === 0 &&
        decision.ageDays !== null &&
        decision.comparison.movement.movingAverageSpeedMps !== null,
    )
    .map((decision) => ({
      comparison: decision.comparison,
      ageDays: decision.ageDays as number,
      speedMps: decision.comparison.movement.movingAverageSpeedMps as number,
    }))
  const primaryCandidates = availableCandidates.filter(
    (candidate) => candidate.ageDays <= config.primaryWindowDays,
  )
  const usePrimaryWindow =
    primaryCandidates.length >= config.minimumTrainingSessions
  const selectedCandidates = usePrimaryWindow
    ? primaryCandidates
    : availableCandidates
  const windowDays = usePrimaryWindow
    ? config.primaryWindowDays
    : config.fallbackWindowDays
  const rawWeights = selectedCandidates.map((candidate) =>
    Math.pow(0.5, candidate.ageDays / config.weightHalfLifeDays),
  )
  const weights = normalizeWithMaximum(
    rawWeights,
    config.maximumSessionWeight,
  )
  const estimatedSpeedMps = selectedCandidates.reduce(
    (sum, candidate, index) => sum + candidate.speedMps * weights[index],
    0,
  )
  const selectedIds = new Set(
    selectedCandidates.map((candidate) => candidate.comparison.sessionId),
  )
  const weightBySessionId = new Map(
    selectedCandidates.map((candidate, index) => [
      candidate.comparison.sessionId,
      weights[index],
    ]),
  )
  const decisions: LearningSessionDecision[] = baseDecisions.map((decision) => {
    const reasons = [...decision.reasons]
    if (
      reasons.length === 0 &&
      !selectedIds.has(decision.comparison.sessionId)
    ) {
      reasons.push('outside_selected_window')
    }

    return {
      sessionId: decision.comparison.sessionId,
      startedAt: decision.comparison.startedAt,
      movingAverageSpeedMps:
        decision.comparison.movement.movingAverageSpeedMps,
      included: reasons.length === 0,
      weight: weightBySessionId.get(decision.comparison.sessionId) ?? null,
      exclusionReasons: reasons,
    }
  })
  const includedDates = selectedCandidates
    .map((candidate) => candidate.comparison.startedAt)
    .sort((first, second) => Date.parse(first) - Date.parse(second))
  const validSessionCount = selectedCandidates.length
  const hasEstimate = validSessionCount > 0

  return {
    algorithmVersion: 'recency-weighted-v1',
    status:
      validSessionCount >= config.minimumTrainingSessions
        ? 'ready'
        : 'insufficient',
    estimatedSpeedMps: hasEstimate ? estimatedSpeedMps : null,
    simpleAverageSpeedMps: mean(
      selectedCandidates.map((candidate) => candidate.speedMps),
    ),
    validSessionCount,
    windowDays,
    trainingPeriodStart: includedDates[0] ?? null,
    trainingPeriodEnd: includedDates.at(-1) ?? null,
    lastUpdatedAt: includedDates.at(-1) ?? null,
    calculatedAt: asOf.toISOString(),
    estimatedOneKilometerSeconds:
      hasEstimate && estimatedSpeedMps > 0
        ? 1000 / estimatedSpeedMps
        : null,
    decisions,
  }
}

export function backtestWalkingSpeedModel(
  comparisons: SessionComparison[],
  config: WalkingSpeedModelConfig = walkingSpeedModelConfig,
): WalkingSpeedBacktest {
  const chronological = [...comparisons].sort(
    (first, second) =>
      Date.parse(first.startedAt) - Date.parse(second.startedAt),
  )
  const cases: BacktestCase[] = []

  for (let targetIndex = 0; targetIndex < chronological.length; targetIndex += 1) {
    const target = chronological[targetIndex]
    const actualSpeedMps = target.movement.movingAverageSpeedMps
    if (!target.eligible || actualSpeedMps === null) continue

    // target 이후 기록은 slice에 포함하지 않아 미래 데이터 누수를 막는다.
    const previousComparisons = chronological.slice(0, targetIndex)
    const model = trainWalkingSpeedModel(
      previousComparisons,
      { asOf: new Date(target.startedAt) },
      config,
    )
    if (
      model.status !== 'ready' ||
      model.estimatedSpeedMps === null ||
      model.simpleAverageSpeedMps === null
    ) {
      continue
    }

    cases.push({
      targetSessionId: target.sessionId,
      targetStartedAt: target.startedAt,
      trainingSessionCount: model.validSessionCount,
      actualSpeedMps,
      simplePredictionMps: model.simpleAverageSpeedMps,
      weightedPredictionMps: model.estimatedSpeedMps,
      simpleAbsoluteErrorMps: Math.abs(
        actualSpeedMps - model.simpleAverageSpeedMps,
      ),
      weightedAbsoluteErrorMps: Math.abs(
        actualSpeedMps - model.estimatedSpeedMps,
      ),
    })
  }

  const hasEnoughCases = cases.length >= config.minimumBacktestCases
  return {
    status: hasEnoughCases ? 'ready' : 'insufficient',
    evaluationSessionCount: cases.length,
    simpleMeanAbsoluteErrorMps: hasEnoughCases
      ? mean(cases.map((item) => item.simpleAbsoluteErrorMps))
      : null,
    weightedMeanAbsoluteErrorMps: hasEnoughCases
      ? mean(cases.map((item) => item.weightedAbsoluteErrorMps))
      : null,
    cases,
  }
}
