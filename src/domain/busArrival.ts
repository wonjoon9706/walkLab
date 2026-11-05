import type { GeoCoordinate } from './walkingRoute.js'

export type BusArrivalLookupStatus =
  | 'available'
  | 'no_service'
  | 'unsupported_region'
  | 'stop_match_failed'
  | 'stop_match_review_required'
  | 'api_error'

export type BusArrivalDataMode = 'live' | 'mock'

export interface BusArrivalEstimate {
  order: 1 | 2
  arrivalSeconds: number
  remainingStops: number | null
  message: string | null
  serviceStatus?: 'in_service' | 'departure_waiting'
  rawStopSequence?: number
  rawSectionSequence?: number | null
  /** 0초인데 정류장이 남은 등 원본 필드가 모순되면 ETA 계산에서 제외한다. */
  arrivalTimeStatus?: 'estimated' | 'review_required'
}

export type TagoDiagnosticStage =
  | 'city_codes'
  | 'nearby_stops'
  | 'routes_at_stop'
  | 'route_stops'
  | 'direction'
  | 'arrivals'

export interface TagoDirectionDiagnostic {
  routeId: string
  routeName: string
  routeStopCount: number
  status: 'verified' | 'review_required' | 'failed'
  reason: string | null
}

export interface TagoStopCandidateDiagnostic {
  cityCode: string
  nodeId: string
  name: string
  distanceM: number
  nameMatched: boolean
  routeNames: string[]
  directionChecks: TagoDirectionDiagnostic[]
}

export interface TagoBusArrivalDiagnostics {
  source: 'live'
  lastStage: TagoDiagnosticStage
  outcomeReason: string
  route: {
    routeName: string
    boardingStopName: string
    boardingCoordinate: GeoCoordinate
    alightingStopName: string
  }
  cityCodeCount: number
  nearbyStopCount: number
  routeLookupCandidateCount: number
  candidates: TagoStopCandidateDiagnostic[]
}

interface BusArrivalInfoBase {
  routeName: string
  stopName: string
  fetchedAt: string
  provider: 'tago' | 'seoul'
  dataMode: BusArrivalDataMode
  /** G7 기반 접근 도보시간과 버스 도착시간을 중복 계산하지 않도록 별도로 둔다. */
  walkingTimeToStopSeconds: number | null
  /** 명시적으로 켠 로컬 개발 환경에서만 서버가 포함하는 실데이터 매칭 진단이다. */
  diagnostics?: TagoBusArrivalDiagnostics
}

export type BusArrivalInfo = BusArrivalInfoBase & (
  | {
      status: 'available'
      stopId: string
      arrivalSeconds: number
      remainingStops: number | null
      upcomingArrivals?: BusArrivalEstimate[]
    }
  | {
      status: Exclude<BusArrivalLookupStatus, 'available'>
      stopId: string | null
      arrivalSeconds: null
      remainingStops: null
    }
)

export interface TagoStopRoute {
  routeId: string
  routeName: string
  nextStopCoordinate: GeoCoordinate | null
}

export interface TagoStopCandidate {
  cityCode: string
  nodeId: string
  name: string
  coordinate: GeoCoordinate
  routes: TagoStopRoute[]
}

export interface TagoCityCode {
  code: string
  name: string
}

export interface TagoArrivalRecord {
  nodeId: string
  nodeName: string
  routeId: string
  routeName: string
  routeType: string
  arrivalSeconds: number
  remainingStops: number
}

export interface TagoRouteStop {
  routeId: string
  nodeId: string
  name: string
  sequence: number | null
  coordinate: GeoCoordinate | null
  upDownCode: string | null
}

export interface TagoRouteStopPage {
  stops: TagoRouteStop[]
  totalCount: number
}

export interface BusArrivalRequest {
  routeName: string
  routeId: string | null
  boardingStop: {
    providerStopId: string
    name: string
    coordinate: GeoCoordinate
  }
  nextStop: {
    providerStopId: string
    name: string
    coordinate: GeoCoordinate
  } | null
  alightingStop: {
    providerStopId: string
    name: string
    coordinate: GeoCoordinate
  }
}

export type BusArrivalErrorCode =
  | 'AUTH_SESSION_MISSING'
  | 'AUTH_HEADER_MISSING'
  | 'AUTH_TOKEN_INVALID'
  | 'SERVER_AUTH_NOT_CONFIGURED'
  | 'SERVER_NOT_CONFIGURED'
  | 'USER_NOT_ALLOWED'
  | 'PRODUCTION_DISABLED'
  | 'INVALID_REQUEST'
  | 'REQUEST_IN_PROGRESS'
  | 'TAGO_AUTH_ERROR'
  | 'SEOUL_BUS_API_ERROR'
  | 'QUOTA_EXCEEDED'
  | 'REQUEST_TIMEOUT'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'

export class BusArrivalError extends Error {
  constructor(
    public readonly code: BusArrivalErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'BusArrivalError'
  }
}

export type TagoStopMatchResult =
  | {
      status: 'matched'
      candidate: TagoStopCandidate
      distanceM: number
    }
  | {
      status: 'review_required'
      reason: 'DIRECTION_AMBIGUOUS'
    }
  | {
      status: 'failed'
      reason:
        | 'NO_NEARBY_STOP'
        | 'STOP_NAME_MISMATCH'
        | 'ROUTE_MISMATCH'
    }
