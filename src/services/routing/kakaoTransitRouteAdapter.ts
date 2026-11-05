import type { KakaoTransitRoute } from '../../domain/kakaoTransitRoute'
import type { TransitAccessWalk } from '../../domain/transitAccessWalk'
import type { TransitEgressWalk } from '../../domain/transitEgressWalk'
import type { TransitItinerary, TransitRouteLeg } from '../../domain/transitRoute'
import type {
  TransitReferenceWalkInput,
  TransitReferenceWalkOverlay,
} from '../../domain/transitMap'

export function createTransitReferenceWalkOverlay(
  input: TransitReferenceWalkInput,
): TransitReferenceWalkOverlay | null {
  if (
    input.walkingRoute.coordinates.length < 2 ||
    input.startGapM === null ||
    input.destinationGapM === null
  ) {
    return null
  }
  return {
    id: input.id,
    scope: input.scope,
    label: input.label,
    coordinates: input.walkingRoute.coordinates,
    distanceM: input.walkingRoute.distanceM,
    providerDurationSeconds: input.walkingRoute.providerDurationSeconds,
    requestedStart: input.requestedStart,
    requestedDestination: input.requestedDestination,
    startGapM: input.startGapM,
    destinationGapM: input.destinationGapM,
  }
}

function toLeg(step: KakaoTransitRoute['steps'][number]): TransitRouteLeg {
  const firstStop = step.stops[0]
  const lastStop = step.stops.at(-1)
  return {
    mode: step.mode === 'WALKING' ? 'WALK' : step.mode,
    distanceM: step.distanceM,
    durationSeconds: step.durationSeconds,
    routeName: step.vehicles.map((vehicle) => vehicle.name).join(' / ') || null,
    routeColor: null,

    startName: firstStop?.name ?? step.guidance,
    endName: lastStop?.name ?? step.guidance,
    startCoordinate: step.coordinates[0] ?? null,
    endCoordinate: step.coordinates.at(-1) ?? null,
    coordinates: step.coordinates,
  }
}

function walkingLeg(
  kind: 'access' | 'egress',
  walk: TransitAccessWalk | TransitEgressWalk,
): TransitRouteLeg {
  const isAccess = kind === 'access'
  const startName = isAccess
    ? '선택한 출발지'
    : (walk as TransitEgressWalk).alightingPoint.locationName
  const endName = isAccess
    ? (walk as TransitAccessWalk).target.locationName
    : (walk as TransitEgressWalk).destination.name
  return {
    mode: 'WALK',
    distanceM: walk.walkingRoute.distanceM,
    durationSeconds: walk.walkingRoute.providerDurationSeconds,
    routeName: isAccess ? 'G8 승차 접근 도보' : 'G8 목적지 도보',
    routeColor: null,

    startName,
    endName,
    startCoordinate: walk.walkingRoute.coordinates[0] ?? null,
    endCoordinate: walk.walkingRoute.coordinates.at(-1) ?? null,
    coordinates: walk.walkingRoute.coordinates,
  }
}

export function toTransitItineraryForMap(
  route: KakaoTransitRoute,
  accessWalk: TransitAccessWalk | null,
  egressWalk: TransitEgressWalk | null,
): TransitItinerary {
  const legs = route.steps.map(toLeg)
  if (accessWalk !== null) legs.unshift(walkingLeg('access', accessWalk))
  if (egressWalk !== null) legs.push(walkingLeg('egress', egressWalk))
  return {
    id: route.id,
    totalDurationSeconds: route.totalDurationSeconds,
    totalWalkDurationSeconds: route.steps
      .filter((step) => step.mode === 'WALKING')
      .reduce((sum, step) => sum + step.durationSeconds, 0),
    totalWalkDistanceM: route.steps
      .filter((step) => step.mode === 'WALKING')
      .reduce((sum, step) => sum + step.distanceM, 0),
    totalDistanceM: route.totalDistanceM,
    transferCount: route.transferCount,
    fareKrw: route.fare?.value ?? null,
    legs,
  }
}

export function toStationAccessComparisonItinerary(
  route: KakaoTransitRoute,
  accessWalk: TransitAccessWalk,
): TransitItinerary | null {
  const firstTransitStepIndex = route.steps.findIndex(
    (step) => step.mode === 'BUS' || step.mode === 'SUBWAY',
  )
  if (firstTransitStepIndex < 0) return null

  // 카카오가 접근 도보를 생략하거나 별도 step으로 줄 수 있으므로,
  // 검증된 G8 접근 도보와 첫 대중교통 이후 구간만 비교 입력으로 사용한다.
  return toTransitItineraryForMap(
    {
      ...route,
      steps: route.steps.slice(firstTransitStepIndex),
    },
    accessWalk,
    null,
  )
}
