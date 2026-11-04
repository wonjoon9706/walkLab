import type { KakaoTransitRoute } from '../../domain/kakaoTransitRoute'

export const INITIAL_KAKAO_PERSONALIZATION_LIMIT = 3

function initialAccessSignature(route: KakaoTransitRoute): string {
  const firstTransitStep = route.steps.find(
    (step) => step.mode === 'BUS' || step.mode === 'SUBWAY',
  )
  if (firstTransitStep === undefined) return 'NO_TRANSIT'
  const firstTransitPosition = route.steps.indexOf(firstTransitStep)
  const boardingName = firstTransitStep.stops[0]?.name ?? firstTransitStep.guidance
  const vehicleNames = firstTransitStep.vehicles
    .map((vehicle) => vehicle.name)
    .sort()
    .join('/')
  const hasExplicitAccessWalk = route.steps
    .slice(0, firstTransitPosition)
    .some((step) => step.mode === 'WALKING')
  return [
    firstTransitStep.mode,
    boardingName,
    vehicleNames,
    hasExplicitAccessWalk ? 'EXPLICIT_WALK' : 'G8_ACCESS',
  ].join(':')
}

export function selectInitialKakaoPersonalizationRoutes(
  routes: readonly KakaoTransitRoute[],
  limit = INITIAL_KAKAO_PERSONALIZATION_LIMIT,
): KakaoTransitRoute[] {
  if (limit <= 0) return []
  const ordered = routes
    .map((route, index) => ({ route, index }))
    .sort((left, right) =>
      left.route.totalDurationSeconds - right.route.totalDurationSeconds ||
      left.index - right.index,
    )
  const selected: KakaoTransitRoute[] = []
  const selectedIds = new Set<string>()
  const signatures = new Set<string>()

  for (const item of ordered) {
    const signature = initialAccessSignature(item.route)
    if (signatures.has(signature)) continue
    selected.push(item.route)
    selectedIds.add(item.route.id)
    signatures.add(signature)
    if (selected.length >= limit) return selected
  }
  for (const item of ordered) {
    if (selectedIds.has(item.route.id)) continue
    selected.push(item.route)
    if (selected.length >= limit) break
  }
  return selected
}
