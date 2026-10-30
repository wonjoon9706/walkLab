export type MeasurementStatus =
  | 'starting'
  | 'recording'
  | 'completed'
  | 'interrupted'
  | 'error'

export type MeasurementEventType =
  | 'measurement_start_requested'
  | 'measurement_started'
  | 'measurement_stopped'
  | 'measurement_interrupted'
  | 'permission_denied'
  | 'position_unavailable'
  | 'position_timeout'
  | 'page_hidden'
  | 'page_visible'

export type SyncState =
  | 'pending'
  | 'syncing'
  | 'confirmed'
  | 'retry_wait'
  | 'failed'
  | 'auth_required'
  | 'owner_mismatch'
  | 'suppressed_by_deletion'

export interface LocalMeta {
  key: string
  value: string
}

export interface LocalWalkSession {
  id: string
  ownerUserId: string
  status: MeasurementStatus
  startedAt: string
  endedAt: string | null
  installationId: string
  sourcePlatform: string
  appVersion: string
  schemaVersion: 1
  createdAt: string
  updatedAt: string
}

export interface RawGpsPoint {
  id: string
  sessionId: string
  sequenceNo: number
  measuredAt: string
  receivedAt: string
  latitude: number
  longitude: number
  accuracyM: number
  altitudeM: number | null
  altitudeAccuracyM: number | null
  deviceSpeedMps: number | null
  headingDeg: number | null
  schemaVersion: 1
}

export interface MeasurementEvent {
  id: string
  sessionId: string
  eventType: MeasurementEventType
  occurredAt: string
  receivedAt: string
  errorCode: string | null
  details: Record<string, string | number | boolean | null> | null
  schemaVersion: 1
}

export interface PointQuality {
  key: string
  sessionId: string
  pointId: string
  algorithmVersion: string
  status: string
  reasons: string[]
  includedInFilteredPath: boolean
  evaluatedAt: string
}

export interface SessionMetrics {
  key: string
  sessionId: string
  algorithmVersion: string
  qualityAlgorithmVersion: string
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
}

export type SyncEntityType = 'session' | 'gps_point' | 'measurement_event'

export interface SyncItem {
  key: string
  ownerUserId: string
  entityType: SyncEntityType
  entityId: string
  sessionId: string
  state: SyncState
  attemptCount: number
  nextRetryAt: string | null
  lastErrorCode: string | null
  serverConfirmedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface DeletionCutoff {
  ownerUserId: string
  rejectSessionsStartedAtOrBefore: string
  cachedAt: string
}
