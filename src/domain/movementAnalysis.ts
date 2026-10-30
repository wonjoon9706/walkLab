import type { WalkMetricsResult } from './history'

export type MovementState = 'moving' | 'stationary' | 'uncertain'

export interface MovementSegment {
  index: number
  startedAt: string
  endedAt: string
  durationSeconds: number
  distanceM: number
  speedMps: number | null
  state: MovementState
}

export interface MovementAnalysis {
  algorithmVersion: 'movement-v1'
  qualityAlgorithmVersion: 'quality-v1'
  segments: MovementSegment[]
  movingDurationSeconds: number
  stationaryDurationSeconds: number
  uncertainDurationSeconds: number
  movingDistanceM: number
  movingAverageSpeedMps: number | null
}

export type AnalysisExclusionReason =
  | 'too_short'
  | 'too_little_distance'
  | 'too_few_points'
  | 'low_quality'

export interface SessionComparison {
  sessionId: string
  startedAt: string
  metrics: WalkMetricsResult
  movement: MovementAnalysis
  eligible: boolean
  exclusionReasons: AnalysisExclusionReason[]
}

export interface PersonalWalkingSummary {
  totalSessionCount: number
  eligibleSessionCount: number
  excludedSessionCount: number
  totalDistanceM: number
  averageMovingSpeedMps: number | null
  hasEnoughSamples: boolean
  comparisons: SessionComparison[]
}
