import type { KakaoTransitRoute } from '../../domain/kakaoTransitRoute'
import type { AutomaticTransitAccessResult } from '../../domain/transitBoardingPoint'
import type { WalkingSpeedModel } from '../../domain/walkingSpeedModel'
import { toStationAccessComparisonItinerary } from '../../services/routing/kakaoTransitRouteAdapter'
import { composeTransitBoardingPlan } from '../../services/routing/transitBoarding'
import { calculateKakaoTransitEta, collectKakaoEtaG8WalkEvidence } from '../../services/routing/kakaoTransitEta'
import { formatDuration } from '../../utils/format'
import type { KakaoRouteArrival } from './useKakaoRouteArrivals'

function remainingText(seconds: number): string {
  return seconds <= 30 ? '곧 도착' : `${Math.ceil(seconds / 60)}분 후`
}

export function KakaoFirstBoardingSummary({ route, access, arrival, speedModel, now, lookupPlanned = true }: {
  route: KakaoTransitRoute
  access: AutomaticTransitAccessResult | null
  arrival: KakaoRouteArrival | undefined
  speedModel: WalkingSpeedModel | null
  now: number
  lookupPlanned?: boolean
}) {
  const first = route.steps.find((step) => step.mode === 'BUS' || step.mode === 'SUBWAY')
  const name = first?.vehicles.map((vehicle) => vehicle.name).join(' / ') || '교통편'
  const boardingName = first?.stops[0]?.name ?? '승차 지점'
  const accessEta = calculateKakaoTransitEta(route, speedModel, collectKakaoEtaG8WalkEvidence(access, null))
  const estimatedAccess = accessEta.status === 'available'
    ? accessEta.estimate.g8Adjustments.find((item) => item.scope === 'access')?.personalizedDurationSeconds
    : undefined
  const itinerary = access?.status === 'ready'
    ? toStationAccessComparisonItinerary(route, access.accessWalk)
    : null
  const firstTransitIndex = itinerary?.legs.findIndex((leg) => leg.mode === 'BUS' || leg.mode === 'SUBWAY') ?? -1
  const assessment = itinerary === null || arrival?.checkedAt == null ? null
    : composeTransitBoardingPlan(itinerary, speedModel, {
      bus: arrival.bus === null ? new Map() : new Map([[firstTransitIndex, arrival.bus]]),
      subway: arrival.subway === null ? new Map() : new Map([[firstTransitIndex, arrival.subway]]),
    }, new Date(now)).boardings.find((item) => item.legIndex === firstTransitIndex) ?? null
  const fetchedAt = arrival?.bus?.fetchedAt ?? arrival?.subway?.fetchedAt
  const age = fetchedAt === undefined ? Number.NaN : now - Date.parse(fetchedAt)
  const stale = !Number.isFinite(age) || age > 120_000 || age < -30_000
  const rows: Array<{ order: number; text: string; usable: boolean }> = []
  const wasWaiting = arrival?.bus?.status === 'available' &&
    (arrival.bus.upcomingArrivals?.some((item) => item.serviceStatus === 'departure_waiting') ?? false)
  const hadNoArrivals = (arrival?.bus !== null && arrival?.bus !== undefined && arrival.bus.status === 'no_service') ||
    (arrival?.subway !== null && arrival?.subway !== undefined &&
      (arrival.subway.status === 'no_arrival_data' || arrival.subway.status === 'no_service'))
  const matchUnverified = arrival?.subway?.status === 'review_required' ||
    arrival?.subway?.status === 'station_match_failed' ||
    arrival?.bus?.status === 'stop_match_failed' || arrival?.bus?.status === 'stop_match_review_required'
  if (!stale && arrival?.bus?.status === 'available') {
    const bus = arrival.bus
    const estimates = bus.upcomingArrivals ?? [{ order: 1, arrivalSeconds: bus.arrivalSeconds }]
    for (const estimate of estimates.slice(0, 2)) {
      const waiting = 'serviceStatus' in estimate && estimate.serviceStatus === 'departure_waiting'
      const review = 'arrivalTimeStatus' in estimate && estimate.arrivalTimeStatus === 'review_required'
      rows.push({
        order: estimate.order,
        text: waiting ? '출발 대기 중 · 도착시간 미정'
          : review ? '도착시간 확인 필요'
            : remainingText(Math.max(0, (Date.parse(bus.fetchedAt) - now) / 1_000 + estimate.arrivalSeconds)),
        usable: !waiting && !review,
      })
    }
  }
  if (!stale && arrival?.subway?.status === 'available') {
    for (const estimate of arrival.subway.estimates.slice(0, 2)) {
      const generated = Date.parse(estimate.generatedAt)
      const usable = Number.isFinite(generated) && now - generated <= 120_000 && now >= generated - 30_000
      rows.push({
        order: estimate.order,
        text: usable
          ? `${estimate.destination}행 ${remainingText(Math.max(0, (generated - now) / 1_000 + estimate.rawArrivalSeconds))}`
          : '열차 정보 갱신 필요',
        usable,
      })
    }
  }
  return (
    <span className="kakao-first-boarding" aria-label="첫 승차 실시간 정보">
      <strong>첫 승차 · {name} · {boardingName}</strong>
      <span>{access?.status === 'ready'
        ? `접근 도보 ${formatDuration(access.accessWalk.pureWalkingDurationSeconds)}`
        : estimatedAccess !== undefined
          ? `접근 추정 도보 ${formatDuration(estimatedAccess)} · 연결 확인 필요`
          : '접근 도보 연결 확인 필요'}</span>
      {arrival === undefined || arrival.status === 'loading' ? (
        <span>{arrival === undefined && !lookupPlanned
          ? '경로 선택 시 첫 승차 도착정보 확인'
          : '도착정보 확인 중 · 탑승 여부 확인 필요'}</span>
      ) : arrival.error !== null ? (
        <span>{arrival.issue === 'boarding_unverified' ? '승차 위치·노선 확인 필요'
          : arrival.issue === 'direction_unverified' ? '정류장·운행 방향 재확인 필요'
            : arrival.issue === 'timeout' ? '도착정보 응답 지연 · 새로고침으로 확인해 주세요'
              : '실시간 제공기관 조회 실패 · 새로고침으로 확인해 주세요'}</span>
      ) : matchUnverified ? (
        <span>승차 위치·노선·방향 확인 필요</span>
      ) : arrival.bus?.status === 'api_error' || arrival.subway?.status === 'api_error' ? (
        <span>실시간 제공기관 조회 실패 · 새로고침으로 확인해 주세요</span>
      ) : arrival.bus?.status === 'unsupported_region' || arrival.subway?.status === 'unsupported_station' ? (
        <span>이 승차 지점의 실시간 정보 제공 범위 확인 필요</span>
      ) : stale ? (
        <span>{wasWaiting ? '마지막 조회: 출발 대기 · 현재 도착시간 미확인'
          : hadNoArrivals ? '마지막 조회에 도착예정 정보 없음 · 새로고침 필요'
            : '도착정보 갱신 필요 · 탑승 여부 확인 필요'}</span>
      ) : rows.length === 0 ? (
        <span>현재 도착예정 정보 없음 · 탑승 여부 확인 필요</span>
      ) : rows.map((row) => {
        const candidate = assessment?.candidates.find((item) => item.order === row.order)
        const likelihood = row.usable ? candidate?.likelihood : undefined
        const label = likelihood === 'likely' ? '탑승 가능성 높음'
          : likelihood === 'tight' ? '시간이 촉박함'
            : likelihood === 'unlikely' ? '탑승 어려움' : '확인 필요'
        return <span key={row.order}>{row.order}번째 정보 · {row.text} · {label}</span>
      })}
      {(wasWaiting || hadNoArrivals) && (
        <small>대기시간 미확정 · 표시된 개인화 시간에 실시간 대기는 반영되지 않았습니다.</small>
      )}
      {first?.mode === 'SUBWAY' && <small>승강장 이동시간 미확인</small>}
    </span>
  )
}
