import type {
  GeoCoordinate,
  WalkingRoute,
  WalkingSpeedProfile,
} from './walkingRoute'

export type LiveNavigationStatus =
  | 'idle'
  | 'starting'
  | 'moving'
  | 'stationary'
  | 'gps_unstable'
  | 'stale'
  | 'off_route'
  | 'rerouting'
  | 'error'

export type LiveNavigationSpeedSource =
  | 'recent_blended'
  | 'personalized'
  | 'default'

export interface LiveNavigationObservation {
  coordinate: GeoCoordinate
  accuracyM: number
  measuredAtMs: number
  deviceSpeedMps: number | null
}

export interface RouteProgress {
  segmentIndex: number
  projectedCoordinate: GeoCoordinate
  distanceFromRouteM: number
  traveledDistanceM: number
  remainingDistanceM: number
  remainingCoordinates: GeoCoordinate[]
}

export interface RecentWalkingSpeed {
  state: 'moving' | 'stationary' | 'uncertain'
  speedMps: number | null
  validSegmentCount: number
}

export interface LiveNavigationState {
  status: LiveNavigationStatus
  isActive: boolean
  route: WalkingRoute | null
  currentPosition: GeoCoordinate | null
  currentAccuracyM: number | null
  remainingCoordinates: GeoCoordinate[]
  remainingDistanceM: number | null
  progressRatio: number | null
  recentSpeedMps: number | null
  appliedSpeedMps: number | null
  speedSource: LiveNavigationSpeedSource | null
  remainingDurationSeconds: number | null
  arrivalAt: string | null
  lastPositionAt: string | null
  rerouteCount: number
  message: string | null
}

export interface StartLiveNavigationInput {
  route: WalkingRoute
  destination: GeoCoordinate
  baselineSpeed: WalkingSpeedProfile
  forceInitialReroute: boolean
}
