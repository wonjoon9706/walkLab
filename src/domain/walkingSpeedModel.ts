import type {
  AnalysisExclusionReason,
  SessionComparison,
} from './movementAnalysis'

export type LearningExclusionReason =
  | AnalysisExclusionReason
  | 'outside_learning_window'
  | 'outside_selected_window'
  | 'missing_moving_speed'
  | 'future_session'
  | 'manually_excluded'

export interface LearningSessionDecision {
  sessionId: string
  startedAt: string
  movingAverageSpeedMps: number | null
  included: boolean
  weight: number | null
  exclusionReasons: LearningExclusionReason[]
}

export interface WalkingSpeedModel {
  algorithmVersion: 'recency-weighted-v1'
  status: 'ready' | 'insufficient'
  estimatedSpeedMps: number | null
  simpleAverageSpeedMps: number | null
  validSessionCount: number
  windowDays: 30 | 90
  trainingPeriodStart: string | null
  trainingPeriodEnd: string | null
  lastUpdatedAt: string | null
  calculatedAt: string
  estimatedOneKilometerSeconds: number | null
  decisions: LearningSessionDecision[]
}

export interface BacktestCase {
  targetSessionId: string
  targetStartedAt: string
  trainingSessionCount: number
  actualSpeedMps: number
  simplePredictionMps: number
  weightedPredictionMps: number
  simpleAbsoluteErrorMps: number
  weightedAbsoluteErrorMps: number
}

export interface WalkingSpeedBacktest {
  status: 'ready' | 'insufficient'
  evaluationSessionCount: number
  simpleMeanAbsoluteErrorMps: number | null
  weightedMeanAbsoluteErrorMps: number | null
  cases: BacktestCase[]
}

export interface TrainWalkingSpeedOptions {
  asOf?: Date
  manuallyExcludedSessionIds?: ReadonlySet<string>
}

export type WalkingSpeedTrainingInput = SessionComparison[]
