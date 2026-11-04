export type SubwayArrivalLookupStatus =
  | 'available'
  | 'no_service'
  | 'no_arrival_data'
  | 'unsupported_station'
  | 'station_match_failed'
  | 'review_required'
  | 'api_error'

export type SubwayTrainType = 'normal' | 'express'

export interface SubwayArrivalEstimate {
  order: 1 | 2 | 3 | 4
  /** 서울시 barvlDt 원본값이다. recptnDt 이후 경과시간을 중복 차감하지 않도록 보존한다. */
  rawArrivalSeconds: number
  /** 서버가 조회한 시점에 recptnDt로부터 경과한 초다. */
  dataAgeSeconds: number
  arrivalSeconds: number
  direction: string
  destination: string
  trainType: SubwayTrainType
  statusCode: string
  statusMessage: string
  generatedAt: string
}

export interface SubwayArrivalInfo {
  lineName: string
  stationName: string
  status: SubwayArrivalLookupStatus
  estimates: SubwayArrivalEstimate[]
  fetchedAt: string
  provider: 'seoul-subway'
  dataMode: 'live'
}

export interface SubwayArrivalRequest {
  routeName: string | null
  routeType: number | null
  trainType: SubwayTrainType
  boardingStation: {
    providerStationId: string | null
    name: string
  }
  nextStation: {
    providerStationId: string | null
    name: string
  }
  alightingStation: {
    providerStationId: string | null
    name: string
  }
}

export type SubwayArrivalErrorCode =
  | 'AUTH_SESSION_MISSING'
  | 'AUTH_HEADER_MISSING'
  | 'AUTH_TOKEN_INVALID'
  | 'SERVER_AUTH_NOT_CONFIGURED'
  | 'SERVER_NOT_CONFIGURED'
  | 'USER_NOT_ALLOWED'
  | 'PRODUCTION_DISABLED'
  | 'INVALID_REQUEST'
  | 'REQUEST_IN_PROGRESS'
  | 'SEOUL_SUBWAY_API_ERROR'
  | 'QUOTA_EXCEEDED'
  | 'REQUEST_TIMEOUT'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'

export class SubwayArrivalError extends Error {
  constructor(
    public readonly code: SubwayArrivalErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SubwayArrivalError'
  }
}
