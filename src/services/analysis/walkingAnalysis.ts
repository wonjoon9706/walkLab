import type {
  PointQualityResult,
  QualityReason,
  WalkAnalysis,
  WalkMetricsResult,
} from '../../domain/history'
import type { LocalWalkSession, RawGpsPoint } from '../../domain/measurement'

const EARTH_RADIUS_M = 6_371_008.8
const MAX_ACCURACY_M = 50
const MAX_STALE_MILLISECONDS = 30_000
const MAX_WALKING_SPEED_MPS = 3.5

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

export function isValidCoordinate(point: RawGpsPoint): boolean {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    point.longitude >= -180 &&
    point.longitude <= 180
  )
}

export function calculateHaversineDistance(
  first: RawGpsPoint,
  second: RawGpsPoint,
): number {
  if (!isValidCoordinate(first) || !isValidCoordinate(second)) {
    return 0
  }

  const latitudeDifference = toRadians(second.latitude - first.latitude)
  const longitudeDifference = toRadians(second.longitude - first.longitude)
  const firstLatitude = toRadians(first.latitude)
  const secondLatitude = toRadians(second.latitude)
  const haversine =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDifference / 2) ** 2

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(haversine))
}

function sortPoints(points: RawGpsPoint[]): RawGpsPoint[] {
  return [...points].sort((first, second) => {
    if (first.sequenceNo !== second.sequenceNo) {
      return first.sequenceNo - second.sequenceNo
    }
    return first.measuredAt.localeCompare(second.measuredAt)
  })
}

function calculatePathDistance(points: RawGpsPoint[]): number {
  let distanceM = 0

  for (let index = 1; index < points.length; index += 1) {
    distanceM += calculateHaversineDistance(points[index - 1], points[index])
  }
  return distanceM
}

function getInitialQualityReasons(point: RawGpsPoint): QualityReason[] {
  const reasons: QualityReason[] = []

  if (!isValidCoordinate(point)) {
    reasons.push('invalid_coordinate')
  }
  if (!Number.isFinite(point.accuracyM) || point.accuracyM > MAX_ACCURACY_M) {
    reasons.push('low_accuracy')
  }

  const measuredTime = Date.parse(point.measuredAt)
  const receivedTime = Date.parse(point.receivedAt)
  if (
    !Number.isFinite(measuredTime) ||
    !Number.isFinite(receivedTime) ||
    receivedTime - measuredTime > MAX_STALE_MILLISECONDS
  ) {
    reasons.push('stale_position')
  }

  return reasons
}

export function analyzeWalkSession(
  session: LocalWalkSession,
  rawPoints: RawGpsPoint[],
  calculatedAt = new Date().toISOString(),
): WalkAnalysis {
  const points = sortPoints(rawPoints)
  const originalSnapshot = JSON.stringify(points)
  const quality: PointQualityResult[] = []
  const filteredPoints: RawGpsPoint[] = []
  let previousIncludedPoint: RawGpsPoint | null = null

  for (const point of points) {
    const reasons = getInitialQualityReasons(point)

    if (reasons.length === 0 && previousIncludedPoint !== null) {
      const previousTime = Date.parse(previousIncludedPoint.measuredAt)
      const currentTime = Date.parse(point.measuredAt)
      const elapsedSeconds = (currentTime - previousTime) / 1000

      if (elapsedSeconds <= 0) {
        reasons.push('non_monotonic_time')
      } else {
        const segmentDistanceM = calculateHaversineDistance(
          previousIncludedPoint,
          point,
        )
        if (segmentDistanceM / elapsedSeconds > MAX_WALKING_SPEED_MPS) {
          reasons.push('implausible_walking_speed')
        }
      }
    }

    const included = reasons.length === 0
    quality.push({
      pointId: point.id,
      sessionId: point.sessionId,
      status: included ? 'included' : 'excluded',
      reasons,
      includedInFilteredPath: included,
      evaluatedAt: calculatedAt,
      algorithmVersion: 'quality-v1',
    })

    if (included) {
      filteredPoints.push(point)
      previousIncludedPoint = point
    }
  }

  const startedTime = Date.parse(session.startedAt)
  const lastReceivedTime = points.reduce((latest, point) => {
    const receivedTime = Date.parse(point.receivedAt)
    return Number.isFinite(receivedTime) ? Math.max(latest, receivedTime) : latest
  }, Number.NEGATIVE_INFINITY)
  const endedTime =
    session.endedAt !== null
      ? Date.parse(session.endedAt)
      : session.status === 'interrupted'
        ? lastReceivedTime
        : Number.NaN
  const durationSeconds =
    Number.isFinite(startedTime) &&
    Number.isFinite(endedTime) &&
    endedTime >= startedTime
      ? (endedTime - startedTime) / 1000
      : null
  const rawDistanceM = calculatePathDistance(points)
  const filteredDistanceM = calculatePathDistance(filteredPoints)
  const averageSpeedMps =
    durationSeconds !== null && durationSeconds > 0
      ? filteredDistanceM / durationSeconds
      : null
  const paceSecondsPerKm =
    durationSeconds !== null && durationSeconds > 0 && filteredDistanceM > 0
      ? durationSeconds / (filteredDistanceM / 1000)
      : null
  const altitudes = points
    .map((point) => point.altitudeM)
    .filter((altitude): altitude is number =>
      altitude !== null && Number.isFinite(altitude),
    )

  const metrics: WalkMetricsResult = {
    sessionId: session.id,
    durationSeconds,
    rawDistanceM,
    filteredDistanceM,
    averageSpeedMps,
    paceSecondsPerKm,
    altitudeMinM: altitudes.length > 0 ? Math.min(...altitudes) : null,
    altitudeMaxM: altitudes.length > 0 ? Math.max(...altitudes) : null,
    altitudeSampleCount: altitudes.length,
    rawPointCount: points.length,
    filteredPointCount: filteredPoints.length,
    calculatedAt,
    algorithmVersion: 'metrics-v1',
    qualityAlgorithmVersion: 'quality-v1',
  }

  // 분석은 원본을 읽기만 하며 필드 변경이나 삭제를 허용하지 않는다.
  if (JSON.stringify(points) !== originalSnapshot) {
    throw new Error('RAW_GPS_MUTATED')
  }

  return { quality, metrics, filteredPoints }
}
