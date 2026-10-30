export interface LiveNavigationConfig {
  maximumAccuracyM: number
  maximumObservationGapSeconds: number
  maximumPositionAgeSeconds: number
  maximumWalkingSpeedMps: number
  stationaryMaximumSpeedMps: number
  movingMinimumSpeedMps: number
  recentSpeedWindowSeconds: number
  minimumRecentSpeedSegments: number
  recentSpeedWeight: number
  staleAfterSeconds: number
  offRouteDistanceM: number
  offRouteObservationCount: number
  rerouteCooldownSeconds: number
  maximumRerouteCount: number
  segmentSearchBacktrack: number
  segmentSearchForward: number
  maximumProgressBacktrackM: number
}

export const liveNavigationConfig: LiveNavigationConfig = {
  // quality-v1과 movement-v1의 핵심 GPS 기준을 실시간 판정에도 맞춘다.
  maximumAccuracyM: 50,
  maximumObservationGapSeconds: 10,
  maximumPositionAgeSeconds: 30,
  maximumWalkingSpeedMps: 3.5,
  stationaryMaximumSpeedMps: 0.35,
  movingMinimumSpeedMps: 0.7,
  recentSpeedWindowSeconds: 20,
  minimumRecentSpeedSegments: 3,
  recentSpeedWeight: 0.6,
  staleAfterSeconds: 20,
  offRouteDistanceM: 60,
  offRouteObservationCount: 3,
  rerouteCooldownSeconds: 60,
  maximumRerouteCount: 3,
  segmentSearchBacktrack: 3,
  segmentSearchForward: 25,
  maximumProgressBacktrackM: 10,
}
