import type { LocalWalkSession, RawGpsPoint } from './measurement'

export interface WalkHistoryItem {
  id: string
  startedAt: string
  endedAt: string
  durationSeconds: number
  pointCount: number
  source: 'local' | 'server' | 'both'
}

export interface WalkSessionDetail {
  session: LocalWalkSession
  points: RawGpsPoint[]
  existsLocally: boolean
  existsOnServer: boolean
}

export type QualityReason =
  | 'invalid_coordinate'
  | 'low_accuracy'
  | 'stale_position'
  | 'non_monotonic_time'
  | 'implausible_walking_speed'

export interface PointQualityResult {
  pointId: string
  sessionId: string
  status: 'included' | 'excluded'
  reasons: QualityReason[]
  includedInFilteredPath: boolean
  evaluatedAt: string
  algorithmVersion: 'quality-v1'
}

export interface WalkMetricsResult {
  sessionId: string
  durationSeconds: number | null
  rawDistanceM: number
  filteredDistanceM: number
  averageSpeedMps: number | null
  paceSecondsPerKm: number | null
  altitudeMinM: number | null
  altitudeMaxM: number | null
  altitudeSampleCount: number
  rawPointCount: number
  filteredPointCount: number
  calculatedAt: string
  algorithmVersion: 'metrics-v1'
  qualityAlgorithmVersion: 'quality-v1'
}

export interface WalkAnalysis {
  quality: PointQualityResult[]
  metrics: WalkMetricsResult
  filteredPoints: RawGpsPoint[]
}
