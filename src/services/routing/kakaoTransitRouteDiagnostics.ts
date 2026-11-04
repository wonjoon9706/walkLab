import type {
  KakaoTransitMode,
  KakaoTransitRoute,
} from '../../domain/kakaoTransitRoute'
import type { GeoCoordinate } from '../../domain/walkingRoute'

export type KakaoRealtimeEvidenceLevel = 'partial' | 'insufficient'

export interface KakaoTransitStepMatchingEvidence {
  stepIndex: number
  mode: Exclude<KakaoTransitMode, 'WALKING'>
  orderedStopNames: string[]
  vehicleNames: string[]
  vehicleTypes: Array<string | null>
  vehicleOptionCount: number
  hasMultipleVehicleOptions: boolean
  hasBoardingAndAlightingNames: boolean
  hasNextStopName: boolean
  hasStepEndpointCoordinates: boolean
  hasProviderStopIds: false
  hasProviderRouteIds: false
  hasPerStopCoordinates: false
  level: KakaoRealtimeEvidenceLevel
}

export interface KakaoTransitRouteDiagnostics {
  routeId: string
  initialAccessWalkExplicit: boolean
  finalAccessWalkExplicit: boolean
  initialAccessWalkMayBeMissing: boolean
  finalAccessWalkMayBeMissing: boolean
  requestStartToFirstPathM: number | null
  lastPathToRequestEndM: number | null
  stepDurationSumSeconds: number
  totalToStepDurationDifferenceSeconds: number
  stepDistanceSumM: number
  totalToStepDistanceDifferenceM: number
  missingCoordinateStepIndexes: number[]
  missingTransitStopStepIndexes: number[]
  missingVehicleStepIndexes: number[]
  ambiguousVehicleStepIndexes: number[]
  realtimeMatchingEvidence: KakaoTransitStepMatchingEvidence[]
}

function toRadians(value: number): number {
  return value * Math.PI / 180
}

function calculateDistanceM(
  left: GeoCoordinate,
  right: GeoCoordinate,
): number {
  const earthRadiusM = 6_371_000
  const latitudeDelta = toRadians(right.latitude - left.latitude)
  const longitudeDelta = toRadians(right.longitude - left.longitude)
  const leftLatitude = toRadians(left.latitude)
  const rightLatitude = toRadians(right.latitude)
  const a = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) *
    Math.sin(longitudeDelta / 2) ** 2
  return Math.round(
    earthRadiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)),
  )
}

export function createKakaoTransitStepMatchingEvidence(
  step: KakaoTransitRoute['steps'][number],
): KakaoTransitStepMatchingEvidence | null {
  if (step.mode === 'WALKING') return null
    const orderedStopNames = step.stops.map((stop) => stop.name)
    const vehicleNames = step.vehicles.map((vehicle) => vehicle.name)
    const hasBoardingAndAlightingNames = orderedStopNames.length >= 2
    const hasStepEndpointCoordinates = step.coordinates.length >= 2
    const level = hasBoardingAndAlightingNames &&
      vehicleNames.length > 0 &&
      hasStepEndpointCoordinates
      ? 'partial'
      : 'insufficient'
    return {
      stepIndex: step.index,
      mode: step.mode,
      orderedStopNames,
      vehicleNames,
      vehicleTypes: step.vehicles.map((vehicle) => vehicle.type),
      vehicleOptionCount: step.vehicles.length,
      // 실제 응답은 한 step에 복수 노선 또는 일반·급행 후보를 함께 줄 수 있다.
      // 첫 항목을 확정 노선으로 선택하지 않고 실시간 매칭의 불확실성으로 남긴다.
      hasMultipleVehicleOptions: step.vehicles.length > 1,
      hasBoardingAndAlightingNames,
      hasNextStopName: orderedStopNames.length >= 2,
      hasStepEndpointCoordinates,
      hasProviderStopIds: false,
      hasProviderRouteIds: false,
      hasPerStopCoordinates: false,
      level,
    }
}

function createMatchingEvidence(
  route: KakaoTransitRoute,
): KakaoTransitStepMatchingEvidence[] {
  return route.steps.flatMap((step): KakaoTransitStepMatchingEvidence[] => {
    const evidence = createKakaoTransitStepMatchingEvidence(step)
    return evidence === null ? [] : [evidence]
  })
}

export function diagnoseKakaoTransitRoute(
  route: KakaoTransitRoute,
  requestStart: GeoCoordinate,
  requestEnd: GeoCoordinate,
): KakaoTransitRouteDiagnostics {
  const firstStep = route.steps[0]
  const lastStep = route.steps.at(-1)
  const firstPathCoordinate = firstStep?.coordinates[0] ?? null
  const lastPathCoordinate = lastStep?.coordinates.at(-1) ?? null
  const stepDurationSumSeconds = route.steps.reduce(
    (sum, step) => sum + step.durationSeconds,
    0,
  )
  const stepDistanceSumM = route.steps.reduce(
    (sum, step) => sum + step.distanceM,
    0,
  )
  const initialAccessWalkExplicit = firstStep?.mode === 'WALKING'
  const finalAccessWalkExplicit = lastStep?.mode === 'WALKING'
  return {
    routeId: route.id,
    initialAccessWalkExplicit,
    finalAccessWalkExplicit,
    // 비도보 구간으로 바로 시작·종료하면 접근 도보가 0인지 누락인지
    // 응답만으로 확정할 수 없으므로 가능성만 기록한다.
    initialAccessWalkMayBeMissing: firstStep !== undefined &&
      !initialAccessWalkExplicit,
    finalAccessWalkMayBeMissing: lastStep !== undefined &&
      !finalAccessWalkExplicit,
    requestStartToFirstPathM: firstPathCoordinate === null
      ? null
      : calculateDistanceM(requestStart, firstPathCoordinate),
    lastPathToRequestEndM: lastPathCoordinate === null
      ? null
      : calculateDistanceM(lastPathCoordinate, requestEnd),
    stepDurationSumSeconds,
    // 이 차이의 의미를 대기시간 등으로 해석하지 않고 원본 차이만 보존한다.
    totalToStepDurationDifferenceSeconds:
      route.totalDurationSeconds - stepDurationSumSeconds,
    stepDistanceSumM,
    totalToStepDistanceDifferenceM: route.totalDistanceM - stepDistanceSumM,
    missingCoordinateStepIndexes: route.steps
      .filter((step) => step.coordinates.length === 0)
      .map((step) => step.index),
    missingTransitStopStepIndexes: route.steps
      .filter((step) => step.mode !== 'WALKING' && step.stops.length < 2)
      .map((step) => step.index),
    missingVehicleStepIndexes: route.steps
      .filter((step) => step.mode !== 'WALKING' && step.vehicles.length === 0)
      .map((step) => step.index),
    ambiguousVehicleStepIndexes: route.steps
      .filter((step) => step.mode !== 'WALKING' && step.vehicles.length > 1)
      .map((step) => step.index),
    realtimeMatchingEvidence: createMatchingEvidence(route),
  }
}
