import type {
  MovementAnalysis,
  MovementSegment,
  MovementState,
} from '../../domain/movementAnalysis'
import type { WalkAnalysis } from '../../domain/history'
import type { LocalWalkSession, RawGpsPoint } from '../../domain/measurement'
import { calculateHaversineDistance } from './walkingAnalysis'

const MAX_GPS_GAP_SECONDS = 10
const STATIONARY_MAX_SPEED_MPS = 0.35
const MOVING_MIN_SPEED_MPS = 0.7
const MAX_VALID_WALKING_SPEED_MPS = 3.5
const SPEED_WINDOW_RADIUS = 2

interface SegmentCandidate {
  segment: MovementSegment
  canClassify: boolean
  estimatedSpeedMps: number | null
}

function sortPoints(points: RawGpsPoint[]): RawGpsPoint[] {
  return [...points].sort(
    (first, second) =>
      first.sequenceNo - second.sequenceNo ||
      first.measuredAt.localeCompare(second.measuredAt),
  )
}

function getSessionEndTime(
  session: LocalWalkSession,
  analysis: WalkAnalysis,
): number | null {
  if (analysis.metrics.durationSeconds === null) {
    return null
  }

  const startedTime = Date.parse(session.startedAt)
  return Number.isFinite(startedTime)
    ? startedTime + analysis.metrics.durationSeconds * 1000
    : null
}

function chooseSegmentSpeed(
  point: RawGpsPoint,
  coordinateSpeedMps: number,
): number {
  const deviceSpeedMps = point.deviceSpeedMps
  if (
    deviceSpeedMps !== null &&
    Number.isFinite(deviceSpeedMps) &&
    deviceSpeedMps >= 0 &&
    deviceSpeedMps <= MAX_VALID_WALKING_SPEED_MPS
  ) {
    return deviceSpeedMps
  }
  return coordinateSpeedMps
}

function median(values: number[]): number | null {
  if (values.length === 0) return null

  const sorted = [...values].sort((first, second) => first - second)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function classifySpeed(speedMps: number | null): MovementState {
  if (speedMps === null) return 'uncertain'
  if (speedMps <= STATIONARY_MAX_SPEED_MPS) return 'stationary'
  if (speedMps >= MOVING_MIN_SPEED_MPS) return 'moving'
  return 'uncertain'
}

function createCandidates(
  session: LocalWalkSession,
  rawPoints: RawGpsPoint[],
  analysis: WalkAnalysis,
): SegmentCandidate[] {
  const sessionStartTime = Date.parse(session.startedAt)
  const sessionEndTime = getSessionEndTime(session, analysis)
  if (!Number.isFinite(sessionStartTime) || sessionEndTime === null) return []

  const qualityByPointId = new Map(
    analysis.quality.map((quality) => [quality.pointId, quality.status]),
  )
  const points = sortPoints(rawPoints)
  const candidates: SegmentCandidate[] = []

  for (let index = 1; index < points.length; index += 1) {
    const first = points[index - 1]
    const second = points[index]
    const firstTime = Date.parse(first.measuredAt)
    const secondTime = Date.parse(second.measuredAt)
    const clippedStartTime = Math.max(firstTime, sessionStartTime)
    const clippedEndTime = Math.min(secondTime, sessionEndTime)
    const durationSeconds = (clippedEndTime - clippedStartTime) / 1000
    const originalGapSeconds = (secondTime - firstTime) / 1000

    if (
      !Number.isFinite(firstTime) ||
      !Number.isFinite(secondTime) ||
      durationSeconds <= 0
    ) {
      continue
    }

    const distanceM = calculateHaversineDistance(first, second)
    const coordinateSpeedMps = distanceM / originalGapSeconds
    const bothPointsIncluded =
      qualityByPointId.get(first.id) === 'included' &&
      qualityByPointId.get(second.id) === 'included'
    const canClassify =
      bothPointsIncluded &&
      originalGapSeconds > 0 &&
      originalGapSeconds <= MAX_GPS_GAP_SECONDS &&
      Number.isFinite(coordinateSpeedMps) &&
      coordinateSpeedMps <= MAX_VALID_WALKING_SPEED_MPS

    candidates.push({
      segment: {
        index: candidates.length,
        startedAt: new Date(clippedStartTime).toISOString(),
        endedAt: new Date(clippedEndTime).toISOString(),
        durationSeconds,
        distanceM,
        speedMps: canClassify ? coordinateSpeedMps : null,
        state: 'uncertain',
      },
      canClassify,
      estimatedSpeedMps: canClassify
        ? chooseSegmentSpeed(second, coordinateSpeedMps)
        : null,
    })
  }

  return candidates
}

function classifyCandidates(candidates: SegmentCandidate[]): MovementSegment[] {
  return candidates.map((candidate, index) => {
    if (!candidate.canClassify) return candidate.segment

    const nearbySpeeds = candidates
      .slice(
        Math.max(0, index - SPEED_WINDOW_RADIUS),
        index + SPEED_WINDOW_RADIUS + 1,
      )
      .filter((nearby) => nearby.canClassify)
      .map((nearby) => nearby.estimatedSpeedMps)
      .filter((speed): speed is number => speed !== null)
    const smoothedSpeedMps = median(nearbySpeeds)

    return {
      ...candidate.segment,
      speedMps: smoothedSpeedMps,
      state: classifySpeed(smoothedSpeedMps),
    }
  })
}

function addUnobservedTime(
  segments: MovementSegment[],
  session: LocalWalkSession,
  durationSeconds: number,
): MovementSegment[] {
  const sessionStartTime = Date.parse(session.startedAt)
  const sessionEndTime = sessionStartTime + durationSeconds * 1000
  const completed: MovementSegment[] = []
  let cursorTime = sessionStartTime

  for (const segment of segments) {
    const segmentStartTime = Date.parse(segment.startedAt)
    const segmentEndTime = Date.parse(segment.endedAt)

    if (segmentStartTime > cursorTime) {
      completed.push({
        index: completed.length,
        startedAt: new Date(cursorTime).toISOString(),
        endedAt: new Date(segmentStartTime).toISOString(),
        durationSeconds: (segmentStartTime - cursorTime) / 1000,
        distanceM: 0,
        speedMps: null,
        state: 'uncertain',
      })
    }

    completed.push({ ...segment, index: completed.length })
    cursorTime = Math.max(cursorTime, segmentEndTime)
  }

  if (cursorTime < sessionEndTime) {
    completed.push({
      index: completed.length,
      startedAt: new Date(cursorTime).toISOString(),
      endedAt: new Date(sessionEndTime).toISOString(),
      durationSeconds: (sessionEndTime - cursorTime) / 1000,
      distanceM: 0,
      speedMps: null,
      state: 'uncertain',
    })
  }

  return completed
}

export function analyzeMovement(
  session: LocalWalkSession,
  rawPoints: RawGpsPoint[],
  analysis: WalkAnalysis,
): MovementAnalysis {
  const candidates = createCandidates(session, rawPoints, analysis)
  let segments = classifyCandidates(candidates)
  const durationSeconds = analysis.metrics.durationSeconds

  if (durationSeconds !== null) {
    segments = addUnobservedTime(segments, session, durationSeconds)
  }

  let movingDurationSeconds = 0
  let stationaryDurationSeconds = 0
  let uncertainDurationSeconds = 0
  let movingDistanceM = 0

  for (const segment of segments) {
    if (segment.state === 'moving') {
      movingDurationSeconds += segment.durationSeconds
      movingDistanceM += segment.distanceM
    } else if (segment.state === 'stationary') {
      stationaryDurationSeconds += segment.durationSeconds
    } else {
      uncertainDurationSeconds += segment.durationSeconds
    }
  }

  return {
    algorithmVersion: 'movement-v1',
    qualityAlgorithmVersion: 'quality-v1',
    segments,
    movingDurationSeconds,
    stationaryDurationSeconds,
    uncertainDurationSeconds,
    movingDistanceM,
    movingAverageSpeedMps:
      movingDurationSeconds > 0
        ? movingDistanceM / movingDurationSeconds
        : null,
  }
}
