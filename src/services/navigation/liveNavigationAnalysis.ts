import type {
  LiveNavigationObservation,
  RecentWalkingSpeed,
  RouteProgress,
} from '../../domain/liveNavigation'
import type { GeoCoordinate } from '../../domain/walkingRoute'
import type { LiveNavigationConfig } from './liveNavigationConfig'

const EARTH_RADIUS_M = 6_371_008.8

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

export function calculateCoordinateDistanceM(
  first: GeoCoordinate,
  second: GeoCoordinate,
): number {
  const latitudeDelta = toRadians(second.latitude - first.latitude)
  const longitudeDelta = toRadians(second.longitude - first.longitude)
  const firstLatitude = toRadians(first.latitude)
  const secondLatitude = toRadians(second.latitude)
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(haversine))
}

function projectToSegment(
  point: GeoCoordinate,
  start: GeoCoordinate,
  end: GeoCoordinate,
): { coordinate: GeoCoordinate; ratio: number; distanceM: number } {
  const referenceLatitude = toRadians(
    (start.latitude + end.latitude + point.latitude) / 3,
  )
  const longitudeScale = Math.cos(referenceLatitude)
  const endX = (end.longitude - start.longitude) * longitudeScale
  const endY = end.latitude - start.latitude
  const pointX = (point.longitude - start.longitude) * longitudeScale
  const pointY = point.latitude - start.latitude
  const segmentLengthSquared = endX * endX + endY * endY
  const rawRatio =
    segmentLengthSquared === 0
      ? 0
      : (pointX * endX + pointY * endY) / segmentLengthSquared
  const ratio = Math.max(0, Math.min(1, rawRatio))
  const coordinate = {
    latitude: start.latitude + (end.latitude - start.latitude) * ratio,
    longitude: start.longitude + (end.longitude - start.longitude) * ratio,
  }
  return {
    coordinate,
    ratio,
    distanceM: calculateCoordinateDistanceM(point, coordinate),
  }
}

function calculateSegmentLengths(coordinates: GeoCoordinate[]): number[] {
  const lengths: number[] = []
  for (let index = 1; index < coordinates.length; index += 1) {
    lengths.push(
      calculateCoordinateDistanceM(coordinates[index - 1], coordinates[index]),
    )
  }
  return lengths
}

export function calculateRouteProgress(
  coordinates: GeoCoordinate[],
  position: GeoCoordinate,
  previous: RouteProgress | null,
  config: LiveNavigationConfig,
): RouteProgress | null {
  if (coordinates.length < 2) return null

  const segmentLengths = calculateSegmentLengths(coordinates)
  const totalDistanceM = segmentLengths.reduce(
    (total, distance) => total + distance,
    0,
  )
  if (totalDistanceM <= 0) return null

  const firstSegment =
    previous === null
      ? 0
      : Math.max(0, previous.segmentIndex - config.segmentSearchBacktrack)
  const lastSegment =
    previous === null
      ? coordinates.length - 2
      : Math.min(
          coordinates.length - 2,
          previous.segmentIndex + config.segmentSearchForward,
        )
  let best:
    | {
        segmentIndex: number
        coordinate: GeoCoordinate
        ratio: number
        distanceM: number
      }
    | undefined

  for (let index = firstSegment; index <= lastSegment; index += 1) {
    const projection = projectToSegment(
      position,
      coordinates[index],
      coordinates[index + 1],
    )
    if (best === undefined || projection.distanceM < best.distanceM) {
      best = { segmentIndex: index, ...projection }
    }
  }
  if (best === undefined) return null

  const distanceBeforeSegment = segmentLengths
    .slice(0, best.segmentIndex)
    .reduce((total, distance) => total + distance, 0)
  const candidateDistance =
    distanceBeforeSegment + segmentLengths[best.segmentIndex] * best.ratio
  const traveledDistanceM =
    previous === null
      ? candidateDistance
      : Math.max(
          previous.traveledDistanceM - config.maximumProgressBacktrackM,
          candidateDistance,
        )
  const boundedDistanceM = Math.min(totalDistanceM, traveledDistanceM)

  return {
    segmentIndex: best.segmentIndex,
    projectedCoordinate: best.coordinate,
    distanceFromRouteM: best.distanceM,
    traveledDistanceM: boundedDistanceM,
    remainingDistanceM: Math.max(0, totalDistanceM - boundedDistanceM),
    remainingCoordinates: [
      best.coordinate,
      ...coordinates.slice(best.segmentIndex + 1),
    ],
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((first, second) => first - second)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

export function estimateRecentWalkingSpeed(
  observations: LiveNavigationObservation[],
  config: LiveNavigationConfig,
): RecentWalkingSpeed {
  const latestTime = observations.at(-1)?.measuredAtMs
  if (latestTime === undefined) {
    return { state: 'uncertain', speedMps: null, validSegmentCount: 0 }
  }
  const windowStart = latestTime - config.recentSpeedWindowSeconds * 1000
  const recent = observations.filter(
    (observation) => observation.measuredAtMs >= windowStart,
  )
  const latestGapSeconds =
    recent.length >= 2
      ? (recent.at(-1)!.measuredAtMs - recent.at(-2)!.measuredAtMs) / 1000
      : null
  if (
    latestGapSeconds !== null &&
    latestGapSeconds > config.maximumObservationGapSeconds
  ) {
    return { state: 'uncertain', speedMps: null, validSegmentCount: 0 }
  }
  const speeds: number[] = []

  for (let index = 1; index < recent.length; index += 1) {
    const first = recent[index - 1]
    const second = recent[index]
    const elapsedSeconds =
      (second.measuredAtMs - first.measuredAtMs) / 1000
    if (
      elapsedSeconds <= 0 ||
      elapsedSeconds > config.maximumObservationGapSeconds
    ) {
      continue
    }
    const coordinateSpeed =
      calculateCoordinateDistanceM(first.coordinate, second.coordinate) /
      elapsedSeconds
    const deviceSpeed = second.deviceSpeedMps
    const selectedSpeed =
      deviceSpeed !== null &&
      Number.isFinite(deviceSpeed) &&
      deviceSpeed >= 0 &&
      deviceSpeed <= config.maximumWalkingSpeedMps
        ? deviceSpeed
        : coordinateSpeed
    if (
      Number.isFinite(selectedSpeed) &&
      selectedSpeed >= 0 &&
      selectedSpeed <= config.maximumWalkingSpeedMps
    ) {
      speeds.push(selectedSpeed)
    }
  }

  const speedMps = median(speeds)
  if (
    speedMps === null ||
    speeds.length < config.minimumRecentSpeedSegments
  ) {
    return {
      state: 'uncertain',
      speedMps: null,
      validSegmentCount: speeds.length,
    }
  }
  if (speedMps <= config.stationaryMaximumSpeedMps) {
    return { state: 'stationary', speedMps, validSegmentCount: speeds.length }
  }
  if (speedMps >= config.movingMinimumSpeedMps) {
    return { state: 'moving', speedMps, validSegmentCount: speeds.length }
  }
  return { state: 'uncertain', speedMps, validSegmentCount: speeds.length }
}

export function combineWalkingSpeed(
  recentSpeed: RecentWalkingSpeed,
  baselineSpeedMps: number,
  config: LiveNavigationConfig,
): { speedMps: number; usesRecentSpeed: boolean } {
  if (recentSpeed.state !== 'moving' || recentSpeed.speedMps === null) {
    return { speedMps: baselineSpeedMps, usesRecentSpeed: false }
  }
  return {
    speedMps:
      recentSpeed.speedMps * config.recentSpeedWeight +
      baselineSpeedMps * (1 - config.recentSpeedWeight),
    usesRecentSpeed: true,
  }
}
