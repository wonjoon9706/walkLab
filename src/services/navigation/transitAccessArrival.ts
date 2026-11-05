import type { GeoCoordinate } from '../../domain/walkingRoute'
import type { KakaoTransitRoute } from '../../domain/kakaoTransitRoute'
import type { AutomaticTransitAccessResult } from '../../domain/transitBoardingPoint'
import { getCoordinateDistanceMeters, isSameBusRouteName, isSameStopName } from '../transitArrival/tagoStopMatcher'
import { isSameSubwayStationName } from '../transitArrival/seoulSubwayMatcher'

export const transitAccessArrivalPolicy = {
  radiusM: 40,
  maximumAccuracyM: 30,
  consecutiveFixes: 3,
  maximumFixAgeMs: 15_000,
  maximumFixGapMs: 15_000,
  minimumFixIntervalMs: 1_000,
  maximumApproachSpeedMps: 6,
} as const

export interface TransitBoardingTarget {
  name: string
  coordinate: GeoCoordinate
  source: 'seoul_bus_stop' | 'kakao_place_subway_entrance'
  mode: 'BUS' | 'SUBWAY'
}

function validCoordinate(point: GeoCoordinate): boolean {
  return Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 &&
    Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180
}

export function isValidTransitBoardingTarget(target: TransitBoardingTarget): boolean {
  return target.name.trim().length > 0 && validCoordinate(target.coordinate) &&
    (target.mode === 'BUS' ? target.source === 'seoul_bus_stop' :
      target.mode === 'SUBWAY' && target.source === 'kakao_place_subway_entrance')
}

export function resolveTransitRecordingTarget(
  route: KakaoTransitRoute,
  access: AutomaticTransitAccessResult | null,
): TransitBoardingTarget | null {
  const first = route.steps.find((step) => step.mode === 'BUS' || step.mode === 'SUBWAY')
  if (first === undefined || access === null || first.vehicles.length !== 1) return null
  if (access.status === 'ready') {
    const target = access.accessWalk.target
    if (access.accessWalk.sourceRouteId !== route.id || target.mode !== first.mode ||
      !validCoordinate(target.coordinate) ||
      !(first.mode === 'SUBWAY'
        ? isSameSubwayStationName(target.boardingPointName, first.stops[0]?.name ?? '')
        : isSameStopName(target.boardingPointName, first.stops[0]?.name ?? '')) ||
      !isSameBusRouteName(target.routeName, first.vehicles[0].name)) return null
    return { name: target.locationName, coordinate: { ...target.coordinate }, mode: target.mode, source: target.source }
  }
  if (first.mode === 'SUBWAY' && access.reason !== 'MULTIPLE_VEHICLE_OPTIONS') {
    const verified = access.subwayCandidates.filter((candidate) =>
      candidate.stationNameMatches && candidate.lineMatches && candidate.entranceCategoryMatches &&
      candidate.closureStatus !== 'confirmed_closed' && validCoordinate(candidate.place.coordinate),
    )
    if (verified.length === 1) return {
      name: verified[0].place.name, coordinate: { ...verified[0].place.coordinate },
      mode: 'SUBWAY', source: 'kakao_place_subway_entrance',
    }
  }
  // 도보 스냅 실패와 탑승 지점 자체의 검증은 다르다. 검증된 단일 버스 후보만 재사용한다.
  if (first.mode === 'BUS' && access.busCandidates.length === 1 &&
    access.reason !== 'MULTIPLE_VEHICLE_OPTIONS') {
    const candidate = access.busCandidates[0]
    if (validCoordinate(candidate.coordinate) &&
      isSameBusRouteName(candidate.routeName, first.vehicles[0].name) &&
      candidate.orderedStopNames.length === first.stops.length &&
      candidate.orderedStopNames.every((name, index) => isSameStopName(name, first.stops[index].name))) {
      return { name: candidate.stopName, coordinate: { ...candidate.coordinate }, mode: 'BUS', source: 'seoul_bus_stop' }
    }
  }
  // 복수 출입구·역 중심점은 도착 판정 대상으로 임의 선택하지 않는다.
  return null
}

export function createTransitAccessArrivalDetector(target: GeoCoordinate | null, startedAt: number) {
  let streak = 0
  let lastTimestamp = startedAt - 1
  let previous: { coordinate: GeoCoordinate; accuracy: number; timestamp: number } | null = null
  let completed = false
  let lastCountedAt = Number.NEGATIVE_INFINITY
  return {
    reset() { streak = 0; previous = null; lastCountedAt = Number.NEGATIVE_INFINITY },
    observe(position: GeolocationPosition, now: number) {
      const coordinate = { latitude: position.coords.latitude, longitude: position.coords.longitude }
      const timestamp = position.timestamp
      const accuracy = position.coords.accuracy
      if (completed || !Number.isFinite(timestamp) || timestamp <= lastTimestamp) {
        return { arrived: false, distanceM: null, valid: false, ignored: true }
      }
      const elapsed = timestamp - lastTimestamp
      lastTimestamp = timestamp
      if (!validCoordinate(coordinate) || !Number.isFinite(accuracy) || accuracy < 0 ||
        accuracy > transitAccessArrivalPolicy.maximumAccuracyM || now - timestamp < -5_000 ||
        now - timestamp > transitAccessArrivalPolicy.maximumFixAgeMs) {
        streak = 0
        previous = null
        return { arrived: false, distanceM: null, valid: false }
      }
      const distanceM = target === null ? null : getCoordinateDistanceMeters(coordinate, target)
      const jump = previous !== null && getCoordinateDistanceMeters(previous.coordinate, coordinate) >
        transitAccessArrivalPolicy.maximumApproachSpeedMps * (timestamp - previous.timestamp) / 1_000 + accuracy + previous.accuracy
      previous = { coordinate, timestamp, accuracy }
      if (jump || elapsed > transitAccessArrivalPolicy.maximumFixGapMs) streak = 0
      if (jump || timestamp - lastCountedAt < transitAccessArrivalPolicy.minimumFixIntervalMs) {
        return { arrived: false, distanceM, valid: !jump }
      }
      lastCountedAt = timestamp
      streak = distanceM !== null && distanceM <= transitAccessArrivalPolicy.radiusM ? streak + 1 : 0
      completed = streak >= transitAccessArrivalPolicy.consecutiveFixes
      return { arrived: completed, distanceM, valid: true }
    },
  }
}
