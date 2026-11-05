import type { TransitPathReferenceWalk, TransitWalkDiagnostic } from '../../domain/transitAccessWalk'
import type { KakaoTransitRoute } from '../../domain/kakaoTransitRoute'
import type { GeoCoordinate, WalkingRoute } from '../../domain/walkingRoute'
import { calculateWalkingRouteEndpointGaps } from './walkingRouteDiagnostics'
import { MAX_TRANSIT_WALK_ENDPOINT_GAP_M } from './transitAccessWalk'

export function getTransitStopFailureDiagnostic(error: unknown): TransitWalkDiagnostic {
  const code = error instanceof Error ? error.message : ''
  if (code === 'PRODUCTION_DISABLED') return 'PRODUCTION_DISABLED'
  if (code === 'SERVER_NOT_CONFIGURED' || code === 'SERVER_AUTH_NOT_CONFIGURED') return 'API_NOT_CONFIGURED'
  if (['AUTH_SESSION_MISSING', 'AUTH_HEADER_MISSING', 'AUTH_TOKEN_INVALID', 'USER_NOT_ALLOWED',
    'SEOUL_BUS_AUTH_ERROR'].includes(code)) return 'API_AUTH_ERROR'
  if (code === 'REQUEST_TIMEOUT') return 'API_TIMEOUT'
  if (code === 'QUOTA_EXCEEDED') return 'API_QUOTA_EXCEEDED'
  if (code === 'INVALID_RESPONSE') return 'API_INVALID_RESPONSE'
  if (code === 'NETWORK_ERROR') return 'API_CONNECTION_FAILED'
  if (code === 'SEOUL_BUS_API_ERROR') return 'API_PROVIDER_ERROR'
  return 'STOP_API_FAILED'
}

function valid(point: GeoCoordinate): boolean {
  return Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 &&
    Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180
}

export async function resolveTransitPathReferenceWalk(
  route: KakaoTransitRoute, scope: 'access' | 'egress', outside: GeoCoordinate,
  getWalkingRoute: (request: { start: GeoCoordinate; destination: GeoCoordinate }) => Promise<WalkingRoute>,
  signal: AbortSignal,
): Promise<{ referenceWalk?: TransitPathReferenceWalk; referenceWalkIssue?: TransitWalkDiagnostic }> {
  const transit = route.steps.filter((step) => step.mode === 'BUS' || step.mode === 'SUBWAY')
  const step = scope === 'access' ? transit[0] : transit.at(-1)
  // 원본 BUS 구간의 끝점까지만 참고한다. 정류장 ID/좌표 검증 결과로 승격하지 않는다.
  if (signal.aborted || step?.mode !== 'BUS' || step.vehicles.length !== 1 ||
    !step.vehicles[0].name.trim() ||
    step.stops.length < 2 || step.stops.some((stop) => !stop.name.trim()) ||
    step.coordinates.length < 2 || !step.coordinates.every(valid) || !valid(outside)) return {}
  if (step.coordinates[0].latitude === step.coordinates.at(-1)!.latitude &&
    step.coordinates[0].longitude === step.coordinates.at(-1)!.longitude) return {}
  const endpoint = scope === 'access' ? step.coordinates[0] : step.coordinates.at(-1)!
  const request = scope === 'access' ? { start: outside, destination: endpoint }
    : { start: endpoint, destination: outside }
  try {
    const walkingRoute = await getWalkingRoute(request)
    if (signal.aborted) return {}
    const gaps = calculateWalkingRouteEndpointGaps(walkingRoute, request.start, request.destination)
    if (gaps === null || !Number.isFinite(walkingRoute.distanceM) || walkingRoute.distanceM <= 0 ||
      !Number.isFinite(walkingRoute.providerDurationSeconds) || walkingRoute.providerDurationSeconds <= 0 ||
      !walkingRoute.coordinates.every(valid)) return { referenceWalkIssue: 'G8_EVIDENCE_EXCLUDED' }
    return { referenceWalk: {
      source: 'kakao_bus_path_endpoint', scope, stepIndex: step.index,
      locationName: (scope === 'access' ? step.stops[0] : step.stops.at(-1)!).name,
      requestedStart: request.start, requestedDestination: request.destination, walkingRoute,
      startGapM: gaps.startGapM, destinationGapM: gaps.destinationGapM,
      verification: 'unverified_boarding_point',
    }, ...(gaps.startGapM > MAX_TRANSIT_WALK_ENDPOINT_GAP_M || gaps.destinationGapM > MAX_TRANSIT_WALK_ENDPOINT_GAP_M
      ? { referenceWalkIssue: 'G8_SNAP_MISMATCH' as const } : {}) }
  } catch {
    return { referenceWalkIssue: 'G8_REQUEST_FAILED' }
  }
}
