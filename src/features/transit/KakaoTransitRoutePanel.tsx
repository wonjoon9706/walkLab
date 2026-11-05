import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type { AutomaticTransitAccessResult } from '../../domain/transitBoardingPoint'
import type { AutomaticTransitEgressResult } from '../../domain/transitEgressPoint'
import type { KakaoTransitRoute, KakaoTransitRouteResult } from '../../domain/kakaoTransitRoute'
import type { TransitReferenceWalkOverlay } from '../../domain/transitMap'
import type { GeoCoordinate, PlaceSearchResult, WalkingRoute } from '../../domain/walkingRoute'
import { WalkingRouteError } from '../../domain/walkingRoute'
import type { WalkingSpeedModel } from '../../domain/walkingSpeedModel'
import { resolveAutomaticTransitAccess } from '../../services/routing/automaticTransitAccess'
import { resolveAutomaticTransitEgress } from '../../services/routing/automaticTransitEgress'
import { kakaoTransitRouteClient, type KakaoTransitRequestStage } from '../../services/routing/kakaoTransitRouteClient'
import { selectInitialKakaoPersonalizationRoutes } from '../../services/routing/kakaoInitialCandidateSelection'
import {
  calculateKakaoTransitEta,
  collectKakaoEtaG8WalkEvidence,
  type KakaoEtaG8WalkEvidence,
  type KakaoEtaG8Adjustment,
  type KakaoTransitEtaResult,
} from '../../services/routing/kakaoTransitEta'
import {
  createTransitReferenceWalkOverlay,
  toStationAccessComparisonItinerary,
  toTransitItineraryForMap,
} from '../../services/routing/kakaoTransitRouteAdapter'
import { seoulBusEvidenceClient } from '../../services/routing/seoulBusEvidenceClient'
import { createSubwayEntranceWalkingRouteCache } from '../../services/routing/subwayEntranceResolution'
import { searchSubwayEntrances } from '../../services/routing/subwayEntranceSearchClient'
import {
  createTransitDetailRequestCache,
  type TransitDetailRequestCache,
  type TransitDetailRequestStats,
} from '../../services/routing/transitDetailRequestCache'
import { walkingRouteClient } from '../../services/routing/walkingRouteClient'
import { composeTransitBoardingPlan } from '../../services/routing/transitBoarding'
import {
  compareStationAccessOptions,
  findStationAccessComparisonContext,
} from '../../services/routing/stationAccessComparison'
import { formatDistance, formatDuration } from '../../utils/format'
import { TransitRouteMap } from '../map/TransitRouteMap'
import { useKakaoRouteArrivals } from './useKakaoRouteArrivals'
import { KakaoFirstBoardingSummary } from './KakaoFirstBoardingSummary'
import { useTransitAccessRecording } from './useTransitAccessRecording'
import { TransitAccessRecordingStatus } from './TransitAccessRecordingStatus'
import { resolveTransitRecordingTarget } from '../../services/navigation/transitAccessArrival'
import { selectWalkingSpeedProfile } from '../../services/routing/walkingEta'

interface Props {
  active: boolean
  origin: GeoCoordinate
  originSource?: 'current_location' | 'searched_place' | 'map'
  destination: PlaceSearchResult
  speedModel: WalkingSpeedModel | null
  onMapVisibilityChange?: (visible: boolean) => void
  onResultAvailabilityChange?: (available: boolean) => void
}

interface DetailResult {
  routeId: string
  access: AutomaticTransitAccessResult | null
  egress: AutomaticTransitEgressResult | null
  accessError: string | null
  egressError: string | null
}

interface DirectWalkResult {
  routeId: string
  route: WalkingRoute
}

interface RoutePersonalization {
  status: 'not_started' | 'calculating' | 'complete' | 'partial' | 'unavailable'
  detail: DetailResult | null
}

interface SearchPerformanceTiming {
  routeLookupMs: number | null
  listVisibleMs: number | null
  initialPersonalizationMs: number | null
  etaCalculationMs: number
}

type KakaoTransitView = 'list' | 'detail'

function stepLabel(step: KakaoTransitRoute['steps'][number]): string {
  if (step.mode === 'WALKING') return '도보'
  return step.vehicles.map((vehicle) => vehicle.name).join(' / ') || step.mode
}

function KakaoModeIcon({ mode }: { mode: KakaoTransitRoute['steps'][number]['mode'] }) {
  if (mode === 'WALKING') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="5" r="2" />
        <path d="m10 9 3 2 2 4m-5-6-2 5m5-3-3 9m5-5 3 5" />
      </svg>
    )
  }
  if (mode === 'BUS') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="3" width="14" height="16" rx="3" />
        <path d="M7 8h10M8 19v2m8-2v2" />
        <circle cx="8.5" cy="15.5" r="1" />
        <circle cx="15.5" cy="15.5" r="1" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="3" width="14" height="16" rx="5" />
      <path d="M8 8h8M8 19l-2 3m10-3 2 3" />
      <circle cx="9" cy="15" r="1" />
      <circle cx="15" cy="15" r="1" />
    </svg>
  )
}

function KakaoRouteFlow({ route, walks, adjustments }: {
  route: KakaoTransitRoute
  walks: KakaoEtaG8WalkEvidence[]
  adjustments: KakaoEtaG8Adjustment[]
}) {
  const replaced = new Set(adjustments.flatMap((item) => item.overlappingStepIndexes))
  const visibleSteps = route.steps.filter((step) =>
    (step.durationSeconds > 0 || step.distanceM > 0) && !replaced.has(step.index),
  )
  for (const walk of walks) {
    const adjustment = adjustments.find((item) => item.scope === walk.scope)
    // G8이 실제 반환한 구간만 추가한다. 원본 경로는 수정하지 않는다.
    if (adjustment === undefined) continue
    const step: KakaoTransitRoute['steps'][number] = {
      index: walk.scope === 'access' ? -1 : -2, mode: 'WALKING',
      guidance: walk.endpointVerification === 'verified' ? '도보' : '추정 도보',
      distanceM: walk.walkingRoute.distanceM,
      durationSeconds: adjustment.personalizedDurationSeconds,
      stops: [], vehicles: [], coordinates: walk.walkingRoute.coordinates,
    }
    if (walk.scope === 'access') visibleSteps.unshift(step)
    else visibleSteps.push(step)
  }
  const totalStepDuration = visibleSteps.reduce(
    (sum, step) => sum + step.durationSeconds,
    0,
  )
  return (
    <>
      <span className="kakao-route-flow" aria-label="이동 수단 순서">
        {visibleSteps.map((step, index) => (
          <span className="kakao-route-flow-item" key={`${step.index}-${step.mode}`}>
            {index > 0 && <span className="kakao-route-flow-arrow">›</span>}
            <span className={`kakao-mode-chip mode-${step.mode.toLowerCase()}`}>
              <span className="kakao-mode-icon"><KakaoModeIcon mode={step.mode} /></span>
              {step.mode === 'WALKING' && step.guidance === '추정 도보' ? '추정 도보' : stepLabel(step)}
            </span>
          </span>
        ))}
      </span>
      {totalStepDuration > 0 && (
        <span className="kakao-duration-bar" aria-label="구간별 소요시간 비율">
          {visibleSteps.map((step) => (
            <span
              className={`mode-${step.mode.toLowerCase()}`}
              key={`${step.index}-${step.mode}`}
              style={{ flexGrow: step.durationSeconds, flexBasis: 0 }}
              title={`${stepLabel(step)} ${formatDuration(step.durationSeconds)}`}
            />
          ))}
        </span>
      )}
    </>
  )
}

function endpointLabel(step: KakaoTransitRoute['steps'][number]): string {
  const first = step.stops[0]?.name ?? step.guidance
  const last = step.stops.at(-1)?.name ?? step.guidance
  return `${first} → ${last}`
}

function kakaoEtaUnavailableText(
  reason: 'NO_EXPLICIT_WALKING_STEP' | 'INVALID_WALKING_STEP' | 'INCONSISTENT_DURATION_COMPONENTS',
): string {
  if (reason === 'NO_EXPLICIT_WALKING_STEP') {
    return '카카오 WALKING step과 사용할 수 있는 G8 접근·하차 경로가 없어 개인화할 수 없습니다.'
  }
  if (reason === 'INVALID_WALKING_STEP') {
    return 'WALKING step의 거리 또는 시간이 유효하지 않아 개인화할 수 없습니다.'
  }
  return '카카오 전체시간과 step 시간 구성요소가 모순되어 개인화할 수 없습니다.'
}

function partialPersonalizationNote(evidence: KakaoEtaG8WalkEvidence[]): string {
  const access = evidence.some((item) => item.scope === 'access')
  const egress = evidence.some((item) => item.scope === 'egress')
  if (evidence.some((item) => item.source === 'kakao_bus_path_endpoint')) {
    const missing = !access ? ' 출발 도보는 미반영입니다.' : !egress ? ' 하차 후 도보는 미반영입니다.' : ''
    return `카카오 버스 구간 끝점 기준 참고시간입니다. 실제 정류장 연결은 미확인입니다.${missing}`
  }
  return access && !egress ? '출발 도보만 반영한 참고시간입니다. 하차 후 도보는 미반영입니다.'
    : egress && !access ? '하차 후 도보만 반영한 참고시간입니다. 출발 도보는 미반영입니다.'
      : '원본에 명시된 도보만 개인화했습니다. 출발·하차 도보는 미반영입니다.'
}

function personalizationIssue(eta: KakaoTransitEtaResult | null, detail: DetailResult | null): string {
  if (eta?.status === 'unavailable') {
    if (eta.reason === 'INCONSISTENT_DURATION_COMPONENTS') return '공급자의 전체시간과 구간시간이 맞지 않아 개인화 시간을 계산하지 못했습니다.'
    if (eta.reason === 'INVALID_WALKING_STEP') return '원본 도보 구간의 거리·시간이 유효하지 않습니다.'
  }
  const apiFailure = [detail?.access, detail?.egress].find((result) =>
    result?.status === 'review_required' && result.diagnosticCode?.startsWith('API_'))
  if (apiFailure?.status === 'review_required') {
    switch (apiFailure.diagnosticCode) {
      case 'API_NOT_CONFIGURED': return '정류장 조회 서버의 인증키·설정이 필요합니다.'
      case 'API_AUTH_ERROR': return '정류장 조회 인증 또는 접근 권한을 확인해 주세요.'
      case 'API_TIMEOUT': return '정류장 조회 응답이 지연되어 도보시간을 확인하지 못했습니다.'
      case 'API_QUOTA_EXCEEDED': return '정류장 조회 한도를 초과했습니다. 잠시 후 다시 검색해 주세요.'
      case 'API_INVALID_RESPONSE': return '정류장 제공기관 응답 형식을 확인하지 못했습니다.'
      default: return '정류장 조회 서버 연결·응답을 확인하지 못했습니다.'
    }
  }
  if ([detail?.access, detail?.egress].some((result) =>
    result?.status === 'review_required' && result.diagnosticCode === 'PRODUCTION_DISABLED')) {
    return '운영 환경에서 정류장 검증을 제공하지 않아 도보시간을 확인하지 못했습니다.'
  }
  const evidence = collectKakaoEtaG8WalkEvidence(detail?.access ?? null, detail?.egress ?? null)
  const accessMissing = !evidence.some((item) => item.scope === 'access')
  const egressMissing = !evidence.some((item) => item.scope === 'egress')
  if (accessMissing && egressMissing) return '출발·하차 도보 경로를 확인하지 못해 전체 개인화 시간을 계산하지 못했습니다.'
  if (accessMissing) {
    if (detail?.access?.status === 'review_required' && detail.access.reason === 'NO_VERIFIED_BUS_STOP') {
      return '승차 정류장의 위치·노선·방향을 확인하지 못해 접근 도보를 계산하지 못했습니다.'
    }
    return '첫 승차 지점까지의 도보 경로를 확인하지 못했습니다.'
  }
  if (egressMissing) {
    if (detail?.egress?.status === 'review_required' && detail.egress.reason === 'NO_VERIFIED_SUBWAY_EXIT') {
      return '하차역의 출구를 확인하지 못해 목적지 도보를 계산하지 못했습니다.'
    }
    if (detail?.egress?.status === 'review_required' && detail.egress.reason === 'NO_VERIFIED_BUS_STOP') {
      return '하차 정류장의 위치·노선·방향을 확인하지 못해 목적지 도보를 계산하지 못했습니다.'
    }
    return '마지막 하차 지점부터 목적지까지의 도보 경로를 확인하지 못했습니다.'
  }
  return '개인화 시간 계산에 필요한 경로 정보를 확인하지 못했습니다.'
}

function getReferenceWalks(
  detail: DetailResult | null,
  origin: GeoCoordinate,
  destination: GeoCoordinate,
): TransitReferenceWalkOverlay[] {
  if (detail === null) return []
  const overlays: TransitReferenceWalkOverlay[] = []
  for (const result of [detail.access, detail.egress]) {
    if (result?.status !== 'review_required' || result.referenceWalk === undefined) continue
    const reference = result.referenceWalk
    const overlay = createTransitReferenceWalkOverlay({
      id: `path-reference-${reference.scope}-${reference.stepIndex}`, scope: reference.scope,
      label: `${reference.locationName} 참고 도보 · 정류장 연결 미확인`,
      walkingRoute: reference.walkingRoute, requestedStart: reference.requestedStart,
      requestedDestination: reference.requestedDestination,
      startGapM: reference.startGapM, destinationGapM: reference.destinationGapM,
    })
    if (overlay !== null) overlays.push(overlay)
  }

  if (
    detail.access?.status === 'review_required' &&
    detail.access.detailReason === 'WALKING_ENDPOINT_MISMATCH'
  ) {
    for (const candidate of detail.access.subwayCandidates) {
      if (candidate.walkingRoute === null) continue
      const overlay = createTransitReferenceWalkOverlay({
        id: `access-subway-${candidate.place.id}`,
        scope: 'access',
        label: `${candidate.place.name} 접근 참고 경로`,
        walkingRoute: candidate.walkingRoute,
        requestedStart: origin,
        requestedDestination: candidate.place.coordinate,
        startGapM: candidate.startGapM,
        destinationGapM: candidate.destinationGapM,
      })
      if (overlay !== null) overlays.push(overlay)
    }
    for (const candidate of detail.access.busCandidates) {
      if (candidate.walkingRoute === null) continue
      const overlay = createTransitReferenceWalkOverlay({
        id: `access-bus-${candidate.stopId}-${candidate.routeId}`,
        scope: 'access',
        label: `${candidate.stopName} 접근 참고 경로`,
        walkingRoute: candidate.walkingRoute,
        requestedStart: origin,
        requestedDestination: candidate.coordinate,
        startGapM: candidate.startGapM,
        destinationGapM: candidate.destinationGapM,
      })
      if (overlay !== null) overlays.push(overlay)
    }
  }

  if (
    detail.egress?.status === 'review_required' &&
    detail.egress.detailReason === 'WALKING_ENDPOINT_MISMATCH'
  ) {
    for (const candidate of detail.egress.subwayCandidates) {
      if (candidate.walkingRoute === null) continue
      const overlay = createTransitReferenceWalkOverlay({
        id: `egress-subway-${candidate.place.id}`,
        scope: 'egress',
        label: `${candidate.place.name} 하차 참고 경로`,
        walkingRoute: candidate.walkingRoute,
        requestedStart: candidate.place.coordinate,
        requestedDestination: destination,
        startGapM: candidate.startGapM,
        destinationGapM: candidate.destinationGapM,
      })
      if (overlay !== null) overlays.push(overlay)
    }
    for (const candidate of detail.egress.busCandidates) {
      if (candidate.walkingRoute === null) continue
      const overlay = createTransitReferenceWalkOverlay({
        id: `egress-bus-${candidate.stopId}-${candidate.routeId}`,
        scope: 'egress',
        label: `${candidate.stopName} 하차 참고 경로`,
        walkingRoute: candidate.walkingRoute,
        requestedStart: candidate.coordinate,
        requestedDestination: destination,
        startGapM: candidate.startGapM,
        destinationGapM: candidate.destinationGapM,
      })
      if (overlay !== null) overlays.push(overlay)
    }
  }
  return overlays
}

function KakaoDetailDiagnostics({
  detail,
  originSource,
}: {
  detail: DetailResult
  originSource: Props['originSource']
}) {
  if (!import.meta.env.DEV) return null
  const accessSubway = detail.access?.subwayCandidates ?? []
  const accessBusDiagnostics = detail.access?.busDiagnostics ?? null
  const egressSubway = detail.egress?.subwayCandidates ?? []
  const egressBus = detail.egress?.busCandidates ?? []
  return (
    <div className="bus-arrival-diagnostics kakao-detail-diagnostics">
      <p>인증키·JWT·요청 URL·좌표는 표시하지 않습니다.</p>
      <p>화면 출발 좌표 출처: {originSource ?? '미확인'}</p>
      {[detail.access, detail.egress].map((result, index) => result?.status === 'review_required' && (
        <p key={index}>{index === 0 ? '접근' : '하차'}: {result.diagnosticCode ?? result.reason}
          {' / 원본 '}{result.reason}
          {' / '}{result.referenceWalkIssue ?? result.detailReason ?? '-'}
          {result.referenceWalk !== undefined ? ' / KAKAO_PATH_REFERENCE_UNVERIFIED' : ''}
          {result.referenceWalk === undefined && result.detailReason === 'WALKING_ENDPOINT_MISMATCH' &&
            collectKakaoEtaG8WalkEvidence(index === 0 ? detail.access : null,
              index === 1 ? detail.egress : null).length === 0 ? ' / G8_EVIDENCE_EXCLUDED' : ''}
        </p>
      ))}
      {detail.egress?.status === 'review_required' && detail.egress.busAmbiguity !== undefined && (
        <p>하차 복수 후보: 차량 {detail.egress.busAmbiguity.vehicleOptionCount},
          조합 {detail.egress.busAmbiguity.candidateCount},
          정류장 {detail.egress.busAmbiguity.distinctStopCount}, 노선 {detail.egress.busAmbiguity.distinctRouteCount}
          {' / '}{detail.egress.busAmbiguity.locationRelation}
          {' / 참고 근거 '}{detail.egress.busAmbiguity.referenceBasis}</p>
      )}
      <strong>승차 출입구 후보 {accessSubway.length}개</strong>
      <ul>
        {accessSubway.map((candidate) => (
          <li key={candidate.place.id}>
            {candidate.place.name}: 역명 {String(candidate.stationNameMatches)}, 노선 {String(candidate.lineMatches)}, 출구 {String(candidate.entranceCategoryMatches)}, 폐쇄 {candidate.closureStatus}, G8 {candidate.walkingRouteStatus}, 스냅 {candidate.startGapM?.toFixed(1) ?? '-'}m/{candidate.destinationGapM?.toFixed(1) ?? '-'}m
          </li>
        ))}
      </ul>
      {accessBusDiagnostics !== null && (
        <>
          <strong>
            승차 버스 원본 후보 {accessBusDiagnostics.nearbyStopCount}개
            {' · '}기준 {accessBusDiagnostics.searchRadiusM}m
          </strong>
          <p>
            기대 정류장 {accessBusDiagnostics.expectedStopName}
            {' · '}차량 {accessBusDiagnostics.vehicleNames.join(', ')}
            {' · '}경유 {accessBusDiagnostics.orderedStopNames.join(' → ')}
          </p>
          <ul>
            {accessBusDiagnostics.candidates.map((candidate) => (
              <li key={`${candidate.stopId}-${candidate.arsId}`}>
                {candidate.stopName}: {candidate.distanceFromSearchAnchorM.toFixed(1)}m
                {' · 이름 '}{candidate.nameMatched ? '일치' : '불일치'}
                {' · 거리 '}{candidate.withinSearchDistance ? '통과' : '초과'}
                {' · 판정 '}{candidate.outcome}
                {candidate.routeMatches.map((route) => (
                  <small key={route.routeId}>
                    {route.routeName} / {route.routeId}: {route.reason}
                  </small>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
      <strong>하차 출입구 후보 {egressSubway.length}개</strong>
      <ul>
        {egressSubway.map((candidate) => (
          <li key={candidate.place.id}>
            {candidate.place.name}: G8 {candidate.walkingRouteStatus}, 스냅 {candidate.startGapM?.toFixed(1) ?? '-'}m/{candidate.destinationGapM?.toFixed(1) ?? '-'}m
          </li>
        ))}
      </ul>
      <strong>하차 버스 후보 {egressBus.length}개</strong>
      <ul>
        {egressBus.map((candidate) => (
          <li key={`${candidate.stopId}-${candidate.routeId}`}>
            {candidate.stopName} / {candidate.routeName}: 정류장 ID {candidate.stopId}, 노선 ID {candidate.routeId}, 방향 순서 검증, G8 {candidate.walkingRouteStatus}, 스냅 {candidate.startGapM?.toFixed(1) ?? '-'}m/{candidate.destinationGapM?.toFixed(1) ?? '-'}m{candidate.walkingErrorCode === null ? '' : `, 오류 ${candidate.walkingErrorCode}`}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function KakaoTransitRoutePanel({
  active,
  origin,
  originSource,
  destination,
  speedModel,
  onMapVisibilityChange,
  onResultAvailabilityChange,
}: Props) {
  const searchRequestId = useRef(0)
  const directWalkRequestId = useRef(0)
  const detailAbort = useRef<AbortController | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  const autoSearchStarted = useRef(false)
  const searchStartedAt = useRef<number | null>(null)
  const etaCalculationDurationMs = useRef(0)
  const listScrollPosition = useRef(0)
  const walkingCache = useRef(createSubwayEntranceWalkingRouteCache())
  const detailRequestCache = useRef<TransitDetailRequestCache | null>(null)
  const personalizationRef = useRef(new Map<string, RoutePersonalization>())
  const [view, setView] = useState<KakaoTransitView>('list')
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [searchStage, setSearchStage] = useState<KakaoTransitRequestStage | null>(null)
  const [result, setResult] = useState<KakaoTransitRouteResult | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailStatus, setDetailStatus] = useState<'idle' | 'loading' | 'ready'>('idle')
  const [detail, setDetail] = useState<DetailResult | null>(null)
  const [personalization, setPersonalization] = useState(
    new Map<string, RoutePersonalization>(),
  )
  const [requestStats, setRequestStats] = useState<TransitDetailRequestStats | null>(null)
  const [initialCandidateIds, setInitialCandidateIds] = useState<string[]>([])
  const [performanceTiming, setPerformanceTiming] = useState<SearchPerformanceTiming>({
    routeLookupMs: null,
    listVisibleMs: null,
    initialPersonalizationMs: null,
    etaCalculationMs: 0,
  })
  const [mapVisible, setMapVisible] = useState(false)
  const routeArrivals = useKakaoRouteArrivals()
  const accessRecording = useTransitAccessRecording()
  const navigation = accessRecording.navigation
  // G9가 1초마다 갱신하는 절대 도착시각과 남은 시간으로 같은 평가시각을 재사용한다.
  const navigationClock = navigation?.arrivalAt != null && navigation.remainingDurationSeconds != null
    ? Date.parse(navigation.arrivalAt) - navigation.remainingDurationSeconds * 1_000 : null
  const firstBoardingNow = accessRecording.isActive && navigationClock !== null && Number.isFinite(navigationClock)
    ? Math.max(navigationClock, routeArrivals.displayedAt) : routeArrivals.displayedAt
  const walkingContext = { routeId: accessRecording.state.routeId, isRecording: accessRecording.isActive,
    guidanceEnded: !accessRecording.isActive && accessRecording.state.routeId !== null && accessRecording.state.phase !== 'idle',
    navigation: accessRecording.navigation }
  const [arrivalRefreshPending, setArrivalRefreshPending] = useState(false)
  const arrivalRefreshInFlight = useRef(false)
  const [showOtherRoutes, setShowOtherRoutes] = useState(false)
  const [directWalkStatus, setDirectWalkStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [directWalkResult, setDirectWalkResult] = useState<DirectWalkResult | null>(null)
  const [directWalkError, setDirectWalkError] = useState<string | null>(null)

  useEffect(() => () => {
    // StrictMode의 setup → cleanup → setup에서도 무효화한 검색을 다시 시작한다.
    autoSearchStarted.current = false
    searchRequestId.current += 1
    directWalkRequestId.current += 1
    detailAbort.current?.abort()
    detailRequestCache.current?.cancelQueuedWalkingRequests()
    onMapVisibilityChange?.(false)
    onResultAvailabilityChange?.(false)
  }, [onMapVisibilityChange, onResultAvailabilityChange])

  const selected = result?.routes.find((route) => route.id === selectedId) ?? null
  const recordingTarget = useMemo(() => selected === null ? null
    : resolveTransitRecordingTarget(selected, detail?.routeId === selected.id ? detail.access : null), [selected, detail])
  const firstTransitStepIndex = selected?.steps.find((step) => step.mode === 'BUS' || step.mode === 'SUBWAY')?.index
  const selectedArrival = selectedId === null ? undefined : routeArrivals.entries.get(selectedId)
  const arrivalStatus = selectedArrival?.status ?? 'idle'
  const busArrival = selectedArrival?.bus ?? null
  const subwayArrival = selectedArrival?.subway ?? null
  const boardingCalculatedAt = selectedArrival?.checkedAt ?? null
  const mapItinerary = useMemo(() => selected === null
    ? null
    : toTransitItineraryForMap(
        selected,
        detail?.routeId === selected.id && detail.access?.status === 'ready'
          ? detail.access.accessWalk
          : null,
        detail?.routeId === selected.id && detail.egress?.status === 'ready'
          ? detail.egress.egressWalk
          : null,
      ), [detail, selected])
  const referenceWalks = useMemo(
    () => getReferenceWalks(detail, origin, destination.coordinate),
    [detail, destination.coordinate, origin],
  )
  const comparisonItinerary = useMemo(() => {
    if (selected === null || detail?.routeId !== selected.id || detail.access?.status !== 'ready') {
      return null
    }
    return toStationAccessComparisonItinerary(selected, detail.access.accessWalk)
  }, [detail, selected])
  const boardingPlan = useMemo(() => {
    if (
      comparisonItinerary === null ||
      boardingCalculatedAt === null ||
      (busArrival === null && subwayArrival === null)
    ) {
      return null
    }
    const firstTransitIndex = comparisonItinerary.legs.findIndex(
      (leg) => leg.mode === 'BUS' || leg.mode === 'SUBWAY',
    )
    if (firstTransitIndex < 0) return null
    return composeTransitBoardingPlan(
      comparisonItinerary,
      speedModel,
      {
        bus: busArrival === null
          ? new Map()
          : new Map([[firstTransitIndex, busArrival]]),
        subway: subwayArrival === null
          ? new Map()
          : new Map([[firstTransitIndex, subwayArrival]]),
      },
      new Date(routeArrivals.displayedAt),
    )
  }, [boardingCalculatedAt, busArrival, comparisonItinerary, speedModel, subwayArrival, routeArrivals.displayedAt])
  const stationAccessContext = comparisonItinerary === null
    ? null
    : findStationAccessComparisonContext(comparisonItinerary, {
      allowFollowingLegs: true,
    })
  const stationAccessComparison =
    comparisonItinerary !== null &&
    boardingPlan !== null &&
    stationAccessContext?.status === 'ready' &&
    directWalkResult !== null &&
    directWalkResult.routeId === selected?.id
      ? compareStationAccessOptions(
        comparisonItinerary,
        stationAccessContext.context,
        boardingPlan,
        directWalkResult.route,
        speedModel,
      )
      : null
  const selectedG8EtaEvidence = selected !== null && detail?.routeId === selected.id
    ? collectKakaoEtaG8WalkEvidence(detail.access, detail.egress)
    : []
  const selectedEtaCalculation = selected === null
    ? null
    : calculateKakaoTransitEta(selected, speedModel, selectedG8EtaEvidence)
  const selectedPersonalization = selected === null
    ? null
    : personalization.get(selected.id) ?? null
  const selectedEta = selectedPersonalization?.status === 'complete' || selectedPersonalization?.status === 'partial'
    ? selectedEtaCalculation
    : null
  const replacedWalkingStepIndexes = new Set(
    selectedEtaCalculation?.status === 'available'
      ? selectedEtaCalculation.estimate.g8Adjustments.flatMap(
        (adjustment) => adjustment.overlappingStepIndexes,
      )
      : [],
  )
  const selectedAccessEvidence = selectedG8EtaEvidence.find(
    (evidence) => evidence.scope === 'access',
  ) ?? null
  const selectedEgressEvidence = selectedG8EtaEvidence.find(
    (evidence) => evidence.scope === 'egress',
  ) ?? null
  const selectedAccessAdjustment = selectedEtaCalculation?.status === 'available'
    ? selectedEtaCalculation.estimate.g8Adjustments.find(
      (adjustment) => adjustment.scope === 'access',
    ) ?? null
    : null
  const selectedEgressAdjustment = selectedEtaCalculation?.status === 'available'
    ? selectedEtaCalculation.estimate.g8Adjustments.find(
      (adjustment) => adjustment.scope === 'egress',
    ) ?? null
    : null
  const initialPersonalizationCompletedCount = initialCandidateIds.filter((routeId) => {
    const routeStatus = personalization.get(routeId)?.status
    return routeStatus === 'complete' || routeStatus === 'partial' || routeStatus === 'unavailable'
  }).length
  const initialPersonalizationFinished = initialCandidateIds.length > 0 &&
    initialPersonalizationCompletedCount === initialCandidateIds.length
  const initialIdSet = new Set(initialCandidateIds)
  const preferredRoutes = initialCandidateIds.flatMap((id) =>
    result?.routes.find((route) => route.id === id) ?? [],
  )
  const canRankPreferred = preferredRoutes.length > 0 && preferredRoutes.every((route) =>
    personalization.get(route.id)?.status === 'complete',
  )
  function personalizedDuration(route: KakaoTransitRoute): number {
    const item = personalization.get(route.id)?.detail
    const eta = calculateKakaoTransitEta(route, speedModel,
      collectKakaoEtaG8WalkEvidence(item?.access ?? null, item?.egress ?? null))
    return eta.status === 'available' ? eta.estimate.appliedDurationSeconds : Infinity
  }
  if (canRankPreferred) preferredRoutes.sort((a, b) => personalizedDuration(a) - personalizedDuration(b))
  const otherRoutes = result?.routes.filter((route) => !initialIdSet.has(route.id)) ?? []
  const visibleRoutes = showOtherRoutes ? [...preferredRoutes, ...otherRoutes] : preferredRoutes

  function setMap(next: boolean) {
    setMapVisible(next)
    onMapVisibilityChange?.(next)
  }

  function updatePersonalization(
    routeId: string,
    next: RoutePersonalization,
  ) {
    const updated = new Map(personalizationRef.current)
    updated.set(routeId, next)
    personalizationRef.current = updated
    setPersonalization(updated)
    if (detailRequestCache.current !== null) {
      setRequestStats({ ...detailRequestCache.current.stats })
    }
    if (selectedIdRef.current === routeId && next.detail !== null) {
      setDetail(next.detail)
      setDetailStatus(next.status === 'calculating' ? 'loading' : 'ready')
    }
  }

  function resolveRouteAccess(route: KakaoTransitRoute, controller: AbortController, requests: TransitDetailRequestCache) {
    return resolveAutomaticTransitAccess({
      route,
      origin: {
        coordinate: origin,
        verification: originSource === 'current_location'
          ? 'current_location'
          : originSource === 'map'
            ? 'map_coordinate'
            : 'searched_place',
        note: originSource === 'current_location'
          ? '현재 위치 좌표이며 실제 보행로 진입점은 미확인'
          : originSource === 'map'
            ? '지도에서 선택한 좌표이며 실제 보행로 진입점은 미확인'
            : '장소검색으로 선택한 좌표이며 실제 건물 출입구는 미확인',
      },
      speed: { kind: 'g7_model', model: speedModel },
      signal: controller.signal,
    }, {
      seoulBusProvider: requests.seoulBusProvider, searchPlaces: requests.searchPlaces,
      getWalkingRoute: requests.getWalkingRoute, subwayEntranceWalkingRouteCache: walkingCache.current,
    })
  }

  async function resolveRoutePersonalization(
    route: KakaoTransitRoute,
    controller: AbortController,
    requests: TransitDetailRequestCache,
  ): Promise<DetailResult> {
    const commonDependencies = {
      seoulBusProvider: requests.seoulBusProvider,
      searchPlaces: requests.searchPlaces,
      getWalkingRoute: requests.getWalkingRoute,
      subwayEntranceWalkingRouteCache: walkingCache.current,
    }
    const accessPromise = resolveRouteAccess(route, controller, requests)
    const egressPromise = resolveAutomaticTransitEgress({
      route,
      destination: {
        name: destination.name,
        coordinate: destination.coordinate,
        source: 'user_selected_place',
        providerPlaceId: destination.id || null,
      },
      speed: { kind: 'g7_model', model: speedModel },
      signal: controller.signal,
    }, commonDependencies)
    void accessPromise.then((access) => {
      if (controller.signal.aborted) return
      updatePersonalization(route.id, {
        status: 'calculating',
        detail: { routeId: route.id, access, egress: null, accessError: null, egressError: null },
      })
      void routeArrivals.ensure(route, access, controller.signal)
    }, () => undefined)
    const [access, egress] = await Promise.allSettled([accessPromise, egressPromise])
    return {
      routeId: route.id,
      access: access.status === 'fulfilled' ? access.value : null,
      egress: egress.status === 'fulfilled' ? egress.value : null,
      accessError: access.status === 'rejected' ? '승차 지점 상세 조회 실패' : null,
      egressError: egress.status === 'rejected' ? '하차 지점 상세 조회 실패' : null,
    }
  }

  async function personalizeRoutes(
    routes: KakaoTransitRoute[],
    requestId: number,
    controller: AbortController,
    requests: TransitDetailRequestCache,
  ) {
    let nextIndex = 0
    async function worker() {
      while (nextIndex < routes.length && !controller.signal.aborted) {
        const route = routes[nextIndex]
        nextIndex += 1
        const nextDetail = await resolveRoutePersonalization(
          route,
          controller,
          requests,
        )
        if (searchRequestId.current !== requestId || controller.signal.aborted) return
        const evidence = collectKakaoEtaG8WalkEvidence(
          nextDetail.access,
          nextDetail.egress,
        )
        const etaStartedAt = performance.now()
        const eta = calculateKakaoTransitEta(route, speedModel, evidence)
        etaCalculationDurationMs.current += performance.now() - etaStartedAt
        const hasCompleteG8Coverage =
          evidence.some((item) => item.scope === 'access') &&
          evidence.some((item) => item.scope === 'egress')
        updatePersonalization(route.id, {
          status: eta.status !== 'available' ? 'unavailable'
            : hasCompleteG8Coverage && !evidence.some((item) => item.source === 'kakao_bus_path_endpoint')
              ? 'complete' : 'partial',
          detail: nextDetail,
        })
        // 실시간 응답은 개인화 완료 및 목록 표시를 기다리게 하지 않는다.
        void routeArrivals.ensure(route, nextDetail.access, controller.signal)
      }
    }
    const workerCount = Math.min(2, routes.length)
    await Promise.all(Array.from({ length: workerCount }, () => worker()))
  }

  async function searchRoutes() {
    const searchStart = window.performance.now()
    searchStartedAt.current = searchStart
    etaCalculationDurationMs.current = 0
    const requestId = ++searchRequestId.current
    directWalkRequestId.current += 1
    detailAbort.current?.abort()
    detailRequestCache.current?.cancelQueuedWalkingRequests()
    const controller = new AbortController()
    detailAbort.current = controller
    walkingCache.current = createSubwayEntranceWalkingRouteCache()
    const requests = createTransitDetailRequestCache({
      getWalkingRoute: walkingRouteClient.getWalkingRoute,
      searchPlaces: searchSubwayEntrances,
      seoulBusProvider: seoulBusEvidenceClient,
    }, 3)
    detailRequestCache.current = requests
    setStatus('loading')
    setSearchStage(null)
    setView('list')
    setError(null)
    setResult(null)
    selectedIdRef.current = null
    setSelectedId(null)
    setDetail(null)
    setDetailStatus('idle')
    routeArrivals.reset()
    setShowOtherRoutes(false)
    setDirectWalkStatus('idle')
    setDirectWalkResult(null)
    setDirectWalkError(null)
    personalizationRef.current = new Map()
    setPersonalization(new Map())
    setRequestStats(null)
    setInitialCandidateIds([])
    setPerformanceTiming({
      routeLookupMs: null,
      listVisibleMs: null,
      initialPersonalizationMs: null,
      etaCalculationMs: 0,
    })
    setMap(false)
    onResultAvailabilityChange?.(false)
    try {
      const next = await kakaoTransitRouteClient.getTransitRoutes({
        start: origin,
        destination: destination.coordinate,
      }, {
        signal: controller.signal,
        onStageChange(stage) {
          if (searchRequestId.current === requestId) setSearchStage(stage)
        },
      })
      if (searchRequestId.current !== requestId) return
      const routeLookupMs = window.performance.now() - searchStart
      const initialRoutes = selectInitialKakaoPersonalizationRoutes(next.routes)
      const initialIds = new Set(initialRoutes.map((route) => route.id))
      const initialPersonalization = new Map(
        next.routes.map((route) => [
          route.id,
          {
            status: initialIds.has(route.id) ? 'calculating' : 'not_started',
            detail: null,
          } satisfies RoutePersonalization,
        ]),
      )
      personalizationRef.current = initialPersonalization
      setPersonalization(initialPersonalization)
      setInitialCandidateIds(initialRoutes.map((route) => route.id))
      setPerformanceTiming((current) => ({ ...current, routeLookupMs }))
      setResult(next)
      setStatus('ready')
      onResultAvailabilityChange?.(true)
      const personalizationStartedAt = window.performance.now()
      void personalizeRoutes(initialRoutes, requestId, controller, requests).then(() => {
        if (searchRequestId.current !== requestId || controller.signal.aborted) return
        setPerformanceTiming((current) => ({
          ...current,
          initialPersonalizationMs: performance.now() - personalizationStartedAt,
          etaCalculationMs: etaCalculationDurationMs.current,
        }))
      })
    } catch (nextError) {
      if (searchRequestId.current !== requestId) return
      setStatus('error')
      setError(nextError instanceof Error ? nextError.message : '카카오 경로 조회에 실패했습니다.')
    }
  }

  function selectRoute(route: KakaoTransitRoute) {
    selectedIdRef.current = route.id
    setSelectedId(route.id)
    directWalkRequestId.current += 1
    setDirectWalkStatus('idle')
    setDirectWalkResult(null)
    setDirectWalkError(null)
    const cached = personalizationRef.current.get(route.id)
    if (cached?.detail !== null && cached?.detail !== undefined && detailAbort.current !== null) {
      void routeArrivals.ensure(route, cached.detail.access, detailAbort.current.signal)
    }
    if (
      cached?.status === 'not_started' &&
      detailAbort.current !== null &&
      detailRequestCache.current !== null
    ) {
      updatePersonalization(route.id, { status: 'calculating', detail: null })
      void personalizeRoutes(
        [route],
        searchRequestId.current,
        detailAbort.current,
        detailRequestCache.current,
      )
    }
    setDetail(cached?.detail ?? null)
    setDetailStatus(cached?.status === 'complete' || cached?.status === 'partial' || cached?.status === 'unavailable'
      ? 'ready'
      : 'loading')
  }

  function openRoute(route: KakaoTransitRoute) {
    if (accessRecording.isActive && accessRecording.state.routeId !== route.id) return
    listScrollPosition.current = window.scrollY
    setView('detail')
    setMap(true)
    if (import.meta.env.MODE !== 'test') {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    }
    if (selectedId === route.id && detailStatus === 'ready') return
    selectRoute(route)
  }

  function returnToRouteList() {
    setView('list')
    setMap(false)
    window.requestAnimationFrame(() => {
      if (import.meta.env.MODE !== 'test') {
        window.scrollTo({
          top: listScrollPosition.current,
          left: 0,
          behavior: 'auto',
        })
      }
    })
  }

  async function lookupRealtimeArrival() {
    if (selected === null || detail?.routeId !== selected.id || detailStatus !== 'ready' || detailAbort.current === null || arrivalRefreshInFlight.current) return
    const route = selected
    const controller = detailAbort.current
    const requestId = searchRequestId.current
    arrivalRefreshInFlight.current = true
    setArrivalRefreshPending(true)
    try {
      let access = detail.access
      const first = route.steps.find((step) => step.mode === 'BUS' || step.mode === 'SUBWAY')
      // 선행 API가 실패하면 후보 자체가 없다. 도착 API만 재시도하지 않고 같은 검증기를 재사용한다.
      if (first?.mode === 'BUS' && (access === null || access.busCandidates.length !== 1) && detailRequestCache.current !== null) {
        access = await resolveRouteAccess(route, controller, detailRequestCache.current)
        if (controller.signal.aborted || requestId !== searchRequestId.current) return
        const current = personalizationRef.current.get(route.id)
        const nextDetail = { ...(current?.detail ?? detail), access }
        const evidence = collectKakaoEtaG8WalkEvidence(access, nextDetail.egress)
        const eta = calculateKakaoTransitEta(route, speedModel, evidence)
        const complete = evidence.some((item) => item.scope === 'access') && evidence.some((item) => item.scope === 'egress') &&
          !evidence.some((item) => item.source === 'kakao_bus_path_endpoint')
        updatePersonalization(route.id, { detail: nextDetail,
          status: eta.status !== 'available' ? 'unavailable' : complete ? 'complete' : 'partial' })
      }
      if (!controller.signal.aborted && requestId === searchRequestId.current) {
        await routeArrivals.ensure(route, access, controller.signal, true)
      }
    } finally {
      arrivalRefreshInFlight.current = false
      setArrivalRefreshPending(false)
    }
  }

  async function loadDirectWalkComparison() {
    if (
      selected === null ||
      comparisonItinerary === null ||
      boardingPlan === null ||
      stationAccessContext?.status !== 'ready' ||
      directWalkStatus === 'loading'
    ) {
      return
    }

    const busAssessment = boardingPlan.boardings.find(
      (item) => item.legIndex === stationAccessContext.context.busLegIndex,
    )
    const fetchedAtMs = busArrival === null
      ? Number.NaN
      : new Date(busArrival.fetchedAt).getTime()
    const comparisonTime = new Date()
    const liveDataAgeSeconds = Number.isFinite(fetchedAtMs)
      ? Math.max(0, (comparisonTime.getTime() - fetchedAtMs) / 1_000)
      : Number.POSITIVE_INFINITY
    if (liveDataAgeSeconds > 120) {
      setDirectWalkError('버스 실시간 정보가 2분 이상 지나 다시 조회해야 비교할 수 있습니다.')
      return
    }
    if (
      busAssessment?.selectedOrder === null ||
      (busAssessment?.status !== 'likely' && busAssessment?.status !== 'tight')
    ) {
      setDirectWalkError('출발대기·도착정보 없음·모순된 ETA는 비교에 사용하지 않습니다. 탑승 가능한 차량이 확인되어야 합니다.')
      return
    }

    setDirectWalkError(null)
    if (directWalkResult?.routeId === selected.id) {
      setDirectWalkStatus('ready')
      return
    }

    const requestId = ++directWalkRequestId.current
    setDirectWalkStatus('loading')
    try {
      const route = await walkingRouteClient.getWalkingRoute({
        start: origin,
        destination: stationAccessContext.context.targetCoordinate,
      })
      if (directWalkRequestId.current !== requestId) return
      setDirectWalkResult({ routeId: selected.id, route })
      setDirectWalkStatus('ready')
    } catch (nextError) {
      if (directWalkRequestId.current !== requestId) return
      setDirectWalkStatus('error')
      setDirectWalkError(
        nextError instanceof WalkingRouteError
          ? nextError.message
          : '동일한 역 접근점까지의 G8 직접 도보 경로를 조회하지 못했습니다.',
      )
    }
  }

  const startAutomaticSearch = useEffectEvent(() => {
    void searchRoutes()
  })
  useEffect(() => {
    if (!active || autoSearchStarted.current) return
    autoSearchStarted.current = true
    startAutomaticSearch()
  }, [active])
  useEffect(() => {
    if (result === null) return
    const frameId = window.requestAnimationFrame(() => {
      if (searchStartedAt.current === null) return
      setPerformanceTiming((current) => current.listVisibleMs === null
        ? {
            ...current,
            listVisibleMs: performance.now() - (searchStartedAt.current ?? performance.now()),
          }
        : current)
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [result])

  if (!active) return null

  return (
    <>
      {view === 'list' && accessRecording.state.routeId !== null && (
        <TransitAccessRecordingStatus state={accessRecording.state} target={recordingTarget}
          navigation={accessRecording.navigation}
          active={accessRecording.isActive} canStart={false} onStart={() => undefined} onStop={() => { void accessRecording.finish() }} />
      )}
      {view === 'list' && (
        <>
          {status === 'loading' && (
            <>
            <p className="transit-calculation-status" role="status">
              대중교통 경로를 찾고 있습니다.
            </p>
            {import.meta.env.DEV && searchStage !== null && (
              <small>검색 단계: {searchStage === 'auth'
                ? '로그인 인증 확인'
                : searchStage === 'request' ? '카카오 경로 응답 대기' : '응답 형식 확인'}</small>
            )}
            </>
          )}
          {error !== null && (
            <div className="status-card">
              <p className="error-message auth-message" role="alert">{error}</p>
              <button type="button" className="primary-action" onClick={() => void searchRoutes()}>
                다시 검색
              </button>
            </div>
          )}
        </>
      )}
      {view === 'list' && result !== null && (
        <section className="transit-results-section" aria-labelledby="kakao-transit-results-title">
          <div className="transit-section-heading">
            <h2 id="kakao-transit-results-title">경로</h2>
            <span>
              {!initialPersonalizationFinished
                ? `우선 개인화 ${initialPersonalizationCompletedCount}/${initialCandidateIds.length}`
                : `우선 개인화 완료 · 총 ${result.routes.length}개`}
            </span>
          </div>
          <div className="transit-route-list">
            {visibleRoutes.map((route) => {
              const index = result.routes.indexOf(route)
              const isSelected = selectedId === route.id
              const routePersonalization = personalization.get(route.id)
              const routeDetail = routePersonalization?.detail ?? null
              const routeEvidence = routeDetail === null
                ? []
                : collectKakaoEtaG8WalkEvidence(
                  routeDetail.access,
                  routeDetail.egress,
                )
              const routeEta = routeDetail !== null
                ? calculateKakaoTransitEta(route, speedModel, routeEvidence)
                : null
              const personalizedEta = (routePersonalization?.status === 'complete' || routePersonalization?.status === 'partial') && routeEta?.status === 'available'
                ? routeEta.estimate
                : null
              const displayedDuration = personalizedEta?.appliedDurationSeconds ??
                route.totalDurationSeconds
              const walkingDistanceM = personalizedEta === null
                ? null
                : personalizedEta.explicitWalkingDistanceM +
                  personalizedEta.g8Adjustments.reduce(
                    (sum, adjustment) => sum + adjustment.walkingDistanceM,
                    0,
                  )
              const walkingDistanceIsEstimated = personalizedEta !== null && (
                personalizedEta.g8Adjustments.some(
                  (adjustment) => adjustment.endpointVerification === 'review_required',
                ) ||
                routeDetail?.access?.status !== 'ready' ||
                routeDetail?.egress?.status !== 'ready'
              )
              const walkingDistanceText = routePersonalization?.status === 'calculating'
                ? '도보거리 계산 중'
                : routePersonalization?.status === 'not_started'
                  ? '도보거리 · 선택 후 계산'
                  : walkingDistanceM === null
                    ? '도보거리 계산 불가'
                    : routePersonalization?.status === 'partial'
                      ? `계산된 도보 ${formatDistance(walkingDistanceM)} · 전체 미확정`
                      : `도보 ${formatDistance(walkingDistanceM)}${walkingDistanceIsEstimated ? ' · 일부 추정' : ''}`
              return (
                <button
                key={route.id}
                type="button"
                className={`transit-route-option kakao-route-option ${isSelected ? 'selected' : ''}`}
                aria-pressed={isSelected}
                disabled={accessRecording.isActive && accessRecording.state.routeId !== route.id}
                onClick={() => openRoute(route)}
              >
                <span className="transit-option-heading">
                  <span>경로 {index + 1}</span>
                  {isSelected && <span className="selected-route-mark">선택됨</span>}
                  {canRankPreferred && initialIdSet.has(route.id) && (
                    <span className="selected-route-mark">우선 후보 추천 {preferredRoutes.indexOf(route) + 1}</span>
                  )}
                </span>
                <span className={`transit-option-time ${personalizedEta === null ? '' : 'is-personalized'}`}>
                  <strong>{formatDuration(displayedDuration)}</strong>
                  <small>
                    {personalizedEta !== null
                      ? routePersonalization?.status === 'partial' ? '부분 개인화 참고' : '개인화 추정'
                      : routePersonalization?.status === 'calculating'
                        ? '카카오 기본 · 개인화 계산 중'
                        : routePersonalization?.status === 'unavailable'
                          ? '카카오 기본 · 개인화 계산 불가'
                          : routePersonalization?.status === 'not_started'
                            ? '카카오 기본 · 선택 시 개인화'
                            : '카카오 기본'}
                  </small>
                </span>
                {personalizedEta !== null && (
                  <small className="transit-provider-time">
                    카카오 기본 {formatDuration(route.totalDurationSeconds)}
                  </small>
                )}
                {routePersonalization?.status === 'unavailable' && (
                  <small className="transit-estimate-note">{personalizationIssue(routeEta, routeDetail)}</small>
                )}
                {routePersonalization?.status === 'partial' && (
                  <small className="transit-estimate-note">{partialPersonalizationNote(routeEvidence)}</small>
                )}
                <KakaoRouteFlow route={route} walks={routeEvidence}
                  adjustments={routeEta?.status === 'available' ? routeEta.estimate.g8Adjustments : []} />
                <small className="transit-option-facts">
                  {walkingDistanceText} · 환승 {route.transferCount}회
                </small>
                <KakaoFirstBoardingSummary route={route} access={routeDetail?.access ?? null}
                  arrival={routeArrivals.entries.get(route.id)} speedModel={speedModel}
                  now={firstBoardingNow} walkingContext={walkingContext}
                  lookupPlanned={initialIdSet.has(route.id) || routePersonalization?.status !== 'not_started'} />
                </button>
              )
            })}
          </div>
          {otherRoutes.length > 0 && (
            <button type="button" className="secondary-button kakao-more-routes"
              aria-expanded={showOtherRoutes} onClick={() => setShowOtherRoutes((current) => !current)}>
              {showOtherRoutes ? '다른 경로 접기' : `다른 경로 ${otherRoutes.length}개 더보기`}
            </button>
          )}
        </section>
      )}
      {view === 'detail' && selected !== null && (
        <>
          <div className="transit-detail-navigation">
            <button type="button" className="transit-back-button" onClick={returnToRouteList}>
              <span aria-hidden="true">←</span> 경로 목록
            </button>
            <span>경로 상세</span>
          </div>
          {mapVisible && mapItinerary !== null && (
            <section className="status-card map-card kakao-detail-map">
              <h2>전체 이동 경로</h2>
              <TransitRouteMap
                itinerary={mapItinerary}
                start={origin}
                destination={destination.coordinate}
                referenceWalks={referenceWalks}
                currentPosition={accessRecording.isActive ? accessRecording.state.currentPosition : null}
              />
            </section>
          )}
          <TransitAccessRecordingStatus
            state={!accessRecording.isActive && accessRecording.state.routeId !== selected.id
              ? { ...accessRecording.state, phase: 'idle', message: null } : accessRecording.state}
            target={recordingTarget} active={accessRecording.isActive}
            navigation={accessRecording.navigation}
            canStart={detailStatus === 'ready' && firstTransitStepIndex !== undefined}
            onStart={() => {
              setMap(true)
              if (selectedAccessEvidence === null) {
                void accessRecording.start(selected.id, recordingTarget)
                return
              }
              const walkingRoute = selectedAccessEvidence.walkingRoute
              void accessRecording.start(selected.id, recordingTarget, {
                route: walkingRoute,
                destination: walkingRoute.coordinates.at(-1)!,
                baselineSpeed: selectWalkingSpeedProfile(speedModel),
                forceInitialReroute: false,
                allowReroute: false,
                isReferenceRoute: selectedAccessEvidence.endpointVerification !== 'verified',
              })
            }}
            onStop={() => { void accessRecording.finish() }}
          />
          <section className="status-card transit-eta-card">
            <div className="transit-detail-heading">
              <div>
                <span className="transit-detail-kicker">선택한 경로</span>
                <h2>예상 소요시간</h2>
              </div>
              <span className="transit-transfer-count">환승 {selected.transferCount}회</span>
            </div>
            {selectedPersonalization?.status === 'unavailable' && (
              <p className="transit-estimate-note">{personalizationIssue(selectedEtaCalculation, detail)}</p>
            )}
            {selectedPersonalization?.status === 'partial' && (
              <p className="transit-estimate-note">{partialPersonalizationNote(selectedG8EtaEvidence)}</p>
            )}
            <dl className="transit-summary-grid">
              <div className="primary-summary">
                <dt>
                  {detailStatus === 'ready' && selectedEta?.status === 'available'
                    ? selectedPersonalization?.status === 'partial' ? '부분 개인화 참고' : '개인화 추정'
                    : '카카오 기본 예상'}
                </dt>
                <dd>
                  {detailStatus === 'ready' && selectedEta?.status === 'available'
                    ? formatDuration(selectedEta.estimate.appliedDurationSeconds)
                    : formatDuration(selected.totalDurationSeconds)}
                </dd>
              </div>
              <div><dt>카카오 기본</dt><dd>{formatDuration(selected.totalDurationSeconds)}</dd></div>
              <div><dt>이동</dt><dd>{selected.steps.filter((step) => step.mode !== 'WALKING').length}개 구간</dd></div>
            </dl>
            {detailStatus === 'loading' && (
              <p className="transit-calculation-status" role="status">
                개인 보행속도로 상세 시간을 계산하고 있습니다.
              </p>
            )}
            {detailStatus === 'ready' && selectedEta?.status === 'available' && (
              <p className="transit-estimate-note">
                {selectedPersonalization?.status === 'complete'
                  ? '출발·하차 G8 도보를 반영한 추정값입니다. 역사 내부 이동·실시간 대기는 미확인입니다.'
                  : '확보한 도보 구간만 반영한 참고값입니다. 미확인 구간과 실제 대기는 다를 수 있습니다.'}
              </p>
            )}
            <button type="button" className="secondary-button route-map-toggle" onClick={() => setMap(!mapVisible)}>
              {mapVisible ? '지도 접기' : '지도 보기'}
            </button>
          </section>
          <section className="status-card">
            <div className="transit-detail-heading">
              <div>
                <span className="transit-detail-kicker">이동 순서</span>
                <h2>상세 경로</h2>
              </div>
            </div>
            <ol className="transit-leg-list kakao-transit-leg-list">
              {selectedAccessEvidence !== null && (
                <li className="mode-walking">
                  <span className="transit-leg-icon mode-walking">
                    <KakaoModeIcon mode="WALKING" />
                  </span>
                  <span className="transit-leg-content">
                    <strong>
                      {selectedAccessEvidence.endpointVerification === 'verified'
                        ? '출발 도보'
                        : '출발 추정 도보'}
                    </strong>
                    <span>
                      출발지 → {detail?.access?.status === 'ready'
                        ? detail.access.accessWalk.target.locationName
                        : '첫 승차 지점'}
                    </span>
                    <small>{formatDistance(selectedAccessEvidence.walkingRoute.distanceM)}</small>
                  </span>
                  <span className="transit-leg-duration">
                    {selectedAccessAdjustment === null
                      ? '시간 미확인'
                      : formatDuration(selectedAccessAdjustment.personalizedDurationSeconds)}
                  </span>
                </li>
              )}
              {selected.steps
                .filter((step) => !replacedWalkingStepIndexes.has(step.index))
                .map((step) => (
                <li className={`mode-${step.mode.toLowerCase()}`} key={step.index}>
                  <span className={`transit-leg-icon mode-${step.mode.toLowerCase()}`}>
                    <KakaoModeIcon mode={step.mode} />
                  </span>
                  <span className="transit-leg-content">
                    <strong>{stepLabel(step)}</strong>
                    <span>{endpointLabel(step)}</span>
                    <small>{formatDistance(step.distanceM)}</small>
                    {step.index !== firstTransitStepIndex && (step.mode === 'BUS' || step.mode === 'SUBWAY') && (
                      <small>환승 후 도착정보는 승차 시점에 다시 확인해 주세요.</small>
                    )}
                  </span>
                  <span className="transit-leg-duration">{formatDuration(step.durationSeconds)}</span>
                  {step.index === firstTransitStepIndex && (
                    <div className="kakao-leg-arrival">
                      <KakaoFirstBoardingSummary route={selected} access={detail?.access ?? null}
                        arrival={selectedArrival} speedModel={speedModel} now={firstBoardingNow} walkingContext={walkingContext} />
                      <button type="button" className="secondary-button"
                        disabled={detailStatus !== 'ready' || detail === null || arrivalStatus === 'loading' || arrivalRefreshPending}
                        onClick={() => void lookupRealtimeArrival()}>
                        {arrivalStatus === 'loading' || arrivalRefreshPending ? '도착정보 확인 중' : '도착정보 새로고침'}
                      </button>
                    </div>
                  )}
                </li>
                ))}
              {selectedEgressEvidence !== null && (
                <li className="mode-walking">
                  <span className="transit-leg-icon mode-walking">
                    <KakaoModeIcon mode="WALKING" />
                  </span>
                  <span className="transit-leg-content">
                    <strong>
                      {selectedEgressEvidence.endpointVerification === 'verified'
                        ? '하차 후 도보'
                        : '하차 후 추정 도보'}
                    </strong>
                    <span>
                      {detail?.egress?.status === 'ready'
                        ? detail.egress.egressWalk.alightingPoint.locationName
                        : '마지막 하차 지점'} → {destination.name}
                    </span>
                    <small>{formatDistance(selectedEgressEvidence.walkingRoute.distanceM)}</small>
                  </span>
                  <span className="transit-leg-duration">
                    {selectedEgressAdjustment === null
                      ? '시간 미확인'
                      : formatDuration(selectedEgressAdjustment.personalizedDurationSeconds)}
                  </span>
                </li>
              )}
            </ol>
            {detailStatus === 'ready' && (
              detail?.access?.status !== 'ready' || detail?.egress?.status !== 'ready'
            ) && (
              <p className="transit-estimate-note">일부 도보 구간은 추정값이거나 아직 확인되지 않았습니다.</p>
            )}
          </section>
          {comparisonItinerary !== null && (
          <section className="status-card">
            {comparisonItinerary !== null && (
              <details className="kakao-station-access-comparison transit-optional-details">
                <summary>같은 승차역까지 다른 방법과 비교</summary>
                {stationAccessContext?.status === 'ready' ? (
                  <>
                    <p className="auth-message">
                      선택 경로의 버스 하차 후 도보와 지하철 승차 시작점이 같은 위치인지 검증한 뒤,
                      현재 버스와 G8 직접 도보만 비교합니다. 카카오 전체 예상시간에는 합산하지 않습니다.
                    </p>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={directWalkStatus === 'loading' || busArrival === null}
                      onClick={() => void loadDirectWalkComparison()}
                    >
                      {directWalkStatus === 'loading'
                        ? 'G8 직접 도보 조회 중'
                        : '같은 승차역까지 직접 걷기와 비교'}
                    </button>
                  </>
                ) : (
                  <p className="warning-card">
                    {stationAccessContext?.status === 'endpoint_unavailable'
                      ? '같은 승차역까지의 연결 지점을 확인할 수 없어 비교하지 않습니다.'
                      : stationAccessContext?.status === 'endpoint_mismatch'
                        ? '버스와 지하철 사이의 도보 연결이 불확실해 비교하지 않습니다.'
                        : '이 경로는 같은 승차역까지의 버스·도보 비교를 지원하지 않습니다.'}
                  </p>
                )}
                {directWalkError !== null && (
                  <p className="error-message auth-message" role="alert">
                    {directWalkError}
                  </p>
                )}
                {stationAccessComparison?.status === 'available' && (
                  <div className="transit-comparison-card">
                    <dl className="transit-summary-grid">
                      <div>
                        <dt>버스 이용</dt>
                        <dd>{formatDuration(stationAccessComparison.comparison.busDurationSeconds)}</dd>
                        <small>
                          {stationAccessComparison.comparison.selectedBusOrder === 1 ? '첫 번째' : '두 번째'} 버스 · 실시간 대기 + 카카오 버스 구간 + G7 후속 도보
                        </small>
                      </div>
                      <div>
                        <dt>직접 도보</dt>
                        <dd>{formatDuration(stationAccessComparison.comparison.directWalkDurationSeconds)}</dd>
                        <small>
                          G8 {formatDistance(stationAccessComparison.comparison.directWalkDistanceM)} · {stationAccessComparison.comparison.directWalkSpeedProfile.source === 'personalized' ? 'G7 개인속도' : '기본속도 fallback'}
                        </small>
                      </div>
                    </dl>
                    <p>
                      {stationAccessComparison.comparison.outcome === 'similar'
                        ? '두 방법의 차이가 2분 이내여서 비슷한 것으로 봅니다.'
                        : stationAccessComparison.comparison.outcome === 'direct_walk_faster'
                          ? `승차역 접근점까지는 직접 걷는 편이 약 ${formatDuration(stationAccessComparison.comparison.differenceSeconds)} 빠를 것으로 예상됩니다.`
                          : `승차역 접근점까지는 버스를 이용하는 편이 약 ${formatDuration(stationAccessComparison.comparison.differenceSeconds)} 빠를 것으로 예상됩니다.`}
                    </p>
                    <small>버스 이동시간은 카카오 추정치이며, 역 내부 이동시간과 전체 목적지 ETA는 포함하지 않습니다.</small>
                  </div>
                )}
                {stationAccessComparison !== null && stationAccessComparison.status !== 'available' && (
                  <p className="warning-card">
                    {stationAccessComparison.status === 'live_data_stale'
                      ? '버스 실시간 정보가 만료되어 비교를 확정하지 않습니다.'
                      : stationAccessComparison.status === 'direct_route_endpoint_mismatch'
                        ? '직접 도보와 버스 경로의 도착 지점을 동일하게 확인할 수 없습니다.'
                        : stationAccessComparison.status === 'walking_estimate_unavailable'
                          ? '버스 하차 후 역까지의 G7 도보시간을 계산할 수 없습니다.'
                          : '출발대기·도착정보 없음·모순된 ETA 또는 탑승 불가 차량은 비교에 사용하지 않습니다.'}
                  </p>
                )}
              </details>
            )}
          </section>
          )}
          {import.meta.env.DEV && detail !== null && (
            <details className="transit-route-diagnostics kakao-development-diagnostics">
              <summary>개발 진단</summary>
              {selectedEta?.status === 'available' && (
                <div className="bus-arrival-diagnostics">
                  <p>
                    원본 totalTime {selected.totalDurationSeconds}초 · step 차이 {selectedEta.estimate.providerToStepDifferenceSeconds}초 ·
                    {' '}속도 출처 {selectedEta.estimate.speedProfile.source}
                  </p>
                  <ul>
                    {selectedEta.estimate.g8Adjustments.map((adjustment) => (
                      <li key={adjustment.scope}>
                        {adjustment.scope} · {adjustment.application} · 거리 {adjustment.walkingDistanceM}m ·
                        {' '}스냅 {adjustment.startGapM ?? '-'}m/{adjustment.destinationGapM ?? '-'}m ·
                        {' '}{adjustment.endpointVerification}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {selectedEtaCalculation?.status === 'unavailable' && (
                <p>개인화 ETA 제외 사유: {kakaoEtaUnavailableText(selectedEtaCalculation.reason)}</p>
              )}
              {requestStats !== null && (
                <p>
                  검색 세션 외부 요청: G8 {requestStats.walkingRouteRequests}회 ·
                  {' '}장소 {requestStats.placeSearchRequests}회 ·
                  {' '}정류장 {requestStats.nearbyStopRequests}회 ·
                  {' '}정류장 노선 {requestStats.routesAtStopRequests}회 ·
                  {' '}노선 경유 {requestStats.routeArrivalRequests}회
                  {' '}· 캐시 재사용 {requestStats.cacheHits}회 · 실패 {requestStats.failedRequests}회
                  {' '}(시간초과 {requestStats.timedOutRequests}회)
                </p>
              )}
              <p>
                단계별 시간: 카카오 경로 {performanceTiming.routeLookupMs?.toFixed(0) ?? '-'}ms ·
                {' '}목록 표시 {performanceTiming.listVisibleMs?.toFixed(0) ?? '-'}ms ·
                {' '}초기 후보 계산 {performanceTiming.initialPersonalizationMs?.toFixed(0) ?? '-'}ms ·
                {' '}G8 누적 {requestStats?.walkingRouteDurationMs.toFixed(0) ?? '-'}ms ·
                {' '}후보 탐색 누적 {requestStats?.candidateLookupDurationMs.toFixed(0) ?? '-'}ms ·
                {' '}ETA 계산 {performanceTiming.etaCalculationMs.toFixed(2)}ms
              </p>
              <KakaoDetailDiagnostics detail={detail} originSource={originSource} />
              {selectedArrival?.errorCode !== undefined && <p>첫 승차 조회 오류: {selectedArrival.errorCode}</p>}
            </details>
          )}
        </>
      )}
    </>
  )
}
