import type {
  SubwayArrivalInfo,
  SubwayArrivalRequest,
} from '../../src/domain/subwayArrival.js'
import {
  getSeoulSubwayIdByLineName,
  getSeoulSubwayQueryName,
  isSameSubwayStationName,
  normalizeSeoulTrainType,
  readDestinationName,
  readDirectionStationName,
} from '../../src/services/transitArrival/seoulSubwayMatcher.js'
import type { SeoulSubwayProvider } from './seoulSubwayProvider.js'

function unavailable(
  request: SubwayArrivalRequest,
  status: Exclude<SubwayArrivalInfo['status'], 'available'>,
  fetchedAt: string,
): SubwayArrivalInfo {
  return {
    lineName: request.routeName ?? '노선 정보 없음',
    stationName: request.boardingStation.name,
    status,
    estimates: [],
    fetchedAt,
    provider: 'seoul-subway',
    dataMode: 'live',
  }
}

export async function resolveSeoulSubwayArrival(
  request: SubwayArrivalRequest,
  provider: SeoulSubwayProvider,
  signal: AbortSignal,
  now: Date = new Date(),
): Promise<SubwayArrivalInfo> {
  const fetchedAt = now.toISOString()
  const expectedSubwayId = request.routeName === null
    ? null : getSeoulSubwayIdByLineName(request.routeName)
  if (expectedSubwayId === null) {
    return unavailable(request, 'unsupported_station', fetchedAt)
  }

  const records = await provider.getArrivals(
    getSeoulSubwayQueryName(request.boardingStation.name),
    signal,
  )
  if (records.length === 0) {
    return unavailable(request, 'no_arrival_data', fetchedAt)
  }

  const stationRecords = records.filter((record) =>
    isSameSubwayStationName(
      record.stationName,
      request.boardingStation.name,
    ),
  )
  if (stationRecords.length === 0) {
    return unavailable(request, 'station_match_failed', fetchedAt)
  }

  const lineRecords = stationRecords.filter(
    (record) => record.subwayId === expectedSubwayId,
  )
  if (lineRecords.length === 0) {
    return unavailable(request, 'station_match_failed', fetchedAt)
  }

  let trainTypeNeedsReview = false
  const trainTypeRecords = lineRecords.filter((record) => {
    if (record.trainStatus === null) {
      trainTypeNeedsReview = true
      return false
    }
    const trainType = normalizeSeoulTrainType(record.trainStatus)
    if (trainType === null) {
      trainTypeNeedsReview = true
      return false
    }
    return trainType === request.trainType
  })

  const directionRecords = trainTypeRecords.filter((record) => {
    const directionStation = readDirectionStationName(record.trainLineName)
    if (directionStation !== null) {
      return isSameSubwayStationName(
        directionStation,
        request.nextStation.name,
      )
    }
    const destination = readDestinationName(record.trainLineName)
    return isSameSubwayStationName(
      destination,
      request.alightingStation.name,
    )
  })

  if (directionRecords.length === 0) {
    return unavailable(
      request,
      trainTypeNeedsReview || trainTypeRecords.length > 0
        ? 'review_required'
        : 'no_service',
      fetchedAt,
    )
  }

  const estimates = directionRecords
    .sort((left, right) => left.arrivalSeconds - right.arrivalSeconds)
    .slice(0, 4)
    .map((record, index) => {
      const generatedAt = new Date(record.generatedAt).getTime()
      const dataAgeSeconds = Math.max(
        0,
        Math.floor((now.getTime() - generatedAt) / 1_000),
      )
      return {
        order: (index + 1) as 1 | 2 | 3 | 4,
        rawArrivalSeconds: record.arrivalSeconds,
        dataAgeSeconds,
        arrivalSeconds: Math.max(0, record.arrivalSeconds - dataAgeSeconds),
        direction: record.upDownLine,
        destination: readDestinationName(record.trainLineName),
        trainType: request.trainType,
        statusCode: record.arrivalStatusCode,
        statusMessage: record.arrivalMessage,
        generatedAt: record.generatedAt,
      }
    })

  return {
    lineName: request.routeName ?? '노선 정보 없음',
    stationName: request.boardingStation.name,
    status: 'available',
    estimates,
    fetchedAt,
    provider: 'seoul-subway',
    dataMode: 'live',
  }
}
