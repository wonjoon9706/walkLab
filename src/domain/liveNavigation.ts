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
  isReferenceRoute: boolean
  currentPosition: GeoCoordinate | null
  currentAccuracyM: number | null
  remainingCoordinates: GeoCoordinate[]
  remainingDistanceM: number | null
  progressRatio: number | null
  recentSpeedMps: number | null
  baselineSpeed: WalkingSpeedProfile | null
  pace: 'similar' | 'slower' | 'faster' | 'checking'
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
  /** 참고 G8 구간은 연결·재탐색을 임의 생성하지 않는다. */
  allowReroute?: boolean
  isReferenceRoute?: boolean
}
