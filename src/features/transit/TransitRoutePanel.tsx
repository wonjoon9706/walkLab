import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type {
  TransitItinerary,
  TransitMode,
  TransitRouteResult,
} from '../../domain/transitRoute'
import { BusArrivalError, type BusArrivalInfo } from '../../domain/busArrival'
import {
  SubwayArrivalError,
  type SubwayArrivalInfo,
} from '../../domain/subwayArrival'
import { TransitRouteError } from '../../domain/transitRoute'
import {
  WalkingRouteError,
  type GeoCoordinate,
  type PlaceSearchResult,
  type WalkingRoute,
} from '../../domain/walkingRoute'
import type { WalkingSpeedModel } from '../../domain/walkingSpeedModel'
import { formatDistance, formatDuration, formatKoreanArrivalTime } from '../../utils/format'
import { TransitRouteMap } from '../map/TransitRouteMap'
import { WalkingRouteMap } from '../map/WalkingRouteMap'
import { auditTransitDurations, calculateTransitEta } from '../../services/routing/transitEta'
import { transitRouteClient } from '../../services/routing/transitRouteClient'
import {
  busArrivalClient,
  createBusArrivalRequest,
} from '../../services/transitArrival/busArrivalClient'
import { BusArrivalStatus } from './BusArrivalStatus'
import { SubwayArrivalStatus } from './SubwayArrivalStatus'
import { TransitBoardingAssessment } from './TransitBoardingAssessment'
import {
  createSubwayArrivalRequest,
  subwayArrivalClient,
} from '../../services/transitArrival/subwayArrivalClient'
import { composeTransitBoardingPlan } from '../../services/routing/transitBoarding'
import { walkingRouteClient } from '../../services/routing/walkingRouteClient'
import {
  compareStationAccessOptions,
  findStationAccessComparisonContext,
} from '../../services/routing/stationAccessComparison'
import { getLastWalkingLegDiagnostic } from '../../services/routing/transitRouteDiagnostics'
import { calculateWalkingRouteEndpointGaps } from '../../services/routing/walkingRouteDiagnostics'
import {
  compareLastBusWithDirectWalk,
  findLastBusAlternativeContext,
} from '../../services/routing/lastBusAlternativeComparison'
import {
  getTransitRouteLabel,
  normalizeTmapRouteColor,
} from './transitRoutePresentation'

interface TransitRoutePanelProps {
  active: boolean
  origin: GeoCoordinate
  destination: PlaceSearchResult
  speedModel: WalkingSpeedModel | null
  onMapVisibilityChange?: (isVisible: boolean) => void
  onResultAvailabilityChange?: (hasResult: boolean) => void
}

function getRouteErrorMessage(error: unknown): string {
  if (!(error instanceof TransitRouteError)) return '대중교통 경로를 불러오지 못했습니다.'
  if (error.code === 'USER_NOT_ALLOWED') return '이 계정은 대중교통 API를 사용할 수 없습니다.'
  if (error.code === 'PRODUCTION_DISABLED') return 'Production 대중교통 조회가 비활성화되어 있습니다.'
  return error.message
}

function isVisibleLeg(leg: TransitItinerary['legs'][number]): boolean {
  return leg.durationSeconds > 0 || leg.distanceM > 0
}

function TransitModeIcon({ mode }: { mode: TransitMode }) {
  if (mode === 'WALK') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <ellipse cx="8" cy="7" rx="2.5" ry="4" />
        <ellipse cx="16" cy="15" rx="2.5" ry="4" />
        <circle cx="6" cy="12" r="1.3" />
        <circle cx="18" cy="10" r="1.3" />
      </svg>
    )
  }
  if (mode === 'BUS' || mode === 'EXPRESSBUS') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="3" width="14" height="16" rx="3" />
        <path d="M7 8h10M8 19v2m8-2v2" />
        <circle cx="8.5" cy="15.5" r="1" />
        <circle cx="15.5" cy="15.5" r="1" />
      </svg>
    )
  }
  if (mode === 'TRAIN') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 16h16M6 16V7c0-3 12-3 12 0v9M8 8h8" />
        <path d="M7 16l-2 4m12-4 2 4M8 20h8" />
        <circle cx="9" cy="13" r="1" />
        <circle cx="15" cy="13" r="1" />
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

function RouteBadge({
  mode,
  label,
  routeColor,
}: {
  mode: TransitMode
  label: string
  routeColor: string | null
}) {
  const color = normalizeTmapRouteColor(routeColor)
  const colorStyle = color === null
    ? undefined
    : ({ '--transit-route-color': color } as CSSProperties)
  return (
    <span
      className={`transit-route-badge mode-${mode.toLowerCase()} ${color === null ? '' : 'has-route-color'}`}
      style={colorStyle}
    >
      <span className="transit-mode-icon">
        <TransitModeIcon mode={mode} />
      </span>
      {label}
    </span>
  )
}

export function TransitRoutePanel({
  active,
  origin,
  destination,
  speedModel,
  onMapVisibilityChange,
  onResultAvailabilityChange,
}: TransitRoutePanelProps) {
  const requestIdRef = useRef(0)
  const arrivalRequestIdRef = useRef(0)
  const directWalkRequestIdRef = useRef(0)
  const lastWalkG8RequestIdRef = useRef(0)
  const lastBusAlternativeRequestIdRef = useRef(0)
  const requestInProgressRef = useRef(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<TransitRouteResult | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isMapVisible, setIsMapVisible] = useState(false)
  const [arrivals, setArrivals] = useState<Array<{
    legIndex: number
    arrival: BusArrivalInfo
  }>>([])
  const [subwayArrivals, setSubwayArrivals] = useState<Array<{
    legIndex: number
    arrival: SubwayArrivalInfo
  }>>([])
  const [arrivalLoadingLegs, setArrivalLoadingLegs] = useState<number[]>([])
  const [arrivalErrors, setArrivalErrors] = useState<Record<number, string>>({})
  const [boardingCalculatedAt, setBoardingCalculatedAt] = useState<string | null>(null)
  const [directWalkStatus, setDirectWalkStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle')
  const [directWalkError, setDirectWalkError] = useState<string | null>(null)
  const [directWalkResult, setDirectWalkResult] = useState<{
    itineraryId: string
    route: WalkingRoute
  } | null>(null)
  const [isDirectWalkMapVisible, setIsDirectWalkMapVisible] = useState(false)
  const [lastWalkG8Status, setLastWalkG8Status] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle')
  const [lastWalkG8Error, setLastWalkG8Error] = useState<string | null>(null)
  const [lastWalkG8Result, setLastWalkG8Result] = useState<{
    itineraryId: string
    route: WalkingRoute
  } | null>(null)
  const [lastBusAlternativeStatus, setLastBusAlternativeStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle')
  const [lastBusAlternativeError, setLastBusAlternativeError] = useState<
    string | null
  >(null)
  const [lastBusDirectRoute, setLastBusDirectRoute] = useState<{
    itineraryId: string
    route: WalkingRoute
  } | null>(null)

  useEffect(() => () => {
    requestIdRef.current += 1
    arrivalRequestIdRef.current += 1
    directWalkRequestIdRef.current += 1
    lastWalkG8RequestIdRef.current += 1
    lastBusAlternativeRequestIdRef.current += 1
    onMapVisibilityChange?.(false)
    onResultAvailabilityChange?.(false)
  }, [onMapVisibilityChange, onResultAvailabilityChange])

  useEffect(() => {
    if (arrivals.length === 0 && subwayArrivals.length === 0) return
    // 외부 API를 다시 호출하지 않고, 이미 받은 절대시각 기준 판정만 만료시킨다.
    const intervalId = window.setInterval(() => {
      setBoardingCalculatedAt(new Date().toISOString())
    }, 30_000)
    return () => window.clearInterval(intervalId)
  }, [arrivals.length, subwayArrivals.length])

  function changeMapVisibility(isVisible: boolean) {
    setIsMapVisible(isVisible)
    onMapVisibilityChange?.(isVisible)
  }

  if (!active) return null

  const selected = result?.itineraries.find((item) => item.id === selectedId) ?? null
  const selectedEta = selected === null || result === null
    ? null
    : calculateTransitEta(selected, speedModel, new Date(result.requestedAt))
  const boardingPlan = selected === null || result === null
    ? null
    : composeTransitBoardingPlan(
      selected,
      speedModel,
      {
        bus: new Map(arrivals.map((item) => [item.legIndex, item.arrival])),
        subway: new Map(
          subwayArrivals.map((item) => [item.legIndex, item.arrival]),
        ),
      },
      new Date(boardingCalculatedAt ?? result.requestedAt),
    )
  const stationAccessContext = selected === null
    ? null
    : findStationAccessComparisonContext(selected)
  const lastWalkingDiagnostic = selected === null
    ? null
    : getLastWalkingLegDiagnostic(selected, destination.coordinate)
  const selectedLastWalkG8Route =
    selected !== null && lastWalkG8Result?.itineraryId === selected.id
      ? lastWalkG8Result.route
      : null
  const lastWalkG8EndpointGaps =
    lastWalkingDiagnostic?.startCoordinate != null &&
    lastWalkingDiagnostic.endCoordinate != null &&
    selectedLastWalkG8Route !== null
      ? calculateWalkingRouteEndpointGaps(
        selectedLastWalkG8Route,
        lastWalkingDiagnostic.startCoordinate,
        lastWalkingDiagnostic.endCoordinate,
      )
      : null
  const lastBusAlternativeContext = selected === null
    ? null
    : findLastBusAlternativeContext(
      selected,
      destination.coordinate,
      destination.name,
    )
  const lastBusAlternativeComparison =
    selected !== null &&
    lastBusAlternativeContext?.status === 'ready' &&
    lastBusDirectRoute?.itineraryId === selected.id
      ? compareLastBusWithDirectWalk(
        selected,
        lastBusAlternativeContext.context,
        lastBusDirectRoute.route,
        speedModel,
      )
      : null
  const stationAccessComparison =
    selected !== null &&
    boardingPlan !== null &&
    stationAccessContext?.status === 'ready' &&
    directWalkResult?.itineraryId === selected.id
      ? compareStationAccessOptions(
        selected,
        stationAccessContext.context,
        boardingPlan,
        directWalkResult.route,
        speedModel,
      )
      : null

  function resetDirectWalkComparison() {
    directWalkRequestIdRef.current += 1
    setDirectWalkStatus('idle')
    setDirectWalkError(null)
    setDirectWalkResult(null)
    setIsDirectWalkMapVisible(false)
  }

  function resetLastWalkG8Diagnostic() {
    lastWalkG8RequestIdRef.current += 1
    setLastWalkG8Status('idle')
    setLastWalkG8Error(null)
    setLastWalkG8Result(null)
  }

  function resetLastBusAlternative() {
    lastBusAlternativeRequestIdRef.current += 1
    setLastBusAlternativeStatus('idle')
    setLastBusAlternativeError(null)
    setLastBusDirectRoute(null)
  }

  function resetArrivals() {
    arrivalRequestIdRef.current += 1
    setArrivals([])
    setSubwayArrivals([])
    setArrivalLoadingLegs([])
    setArrivalErrors({})
    setBoardingCalculatedAt(null)
    resetDirectWalkComparison()
    resetLastWalkG8Diagnostic()
    resetLastBusAlternative()
  }

  async function loadLastBusDirectAlternative() {
    if (
      selected === null ||
      lastBusAlternativeContext?.status !== 'ready' ||
      lastBusAlternativeStatus !== 'idle'
    ) {
      return
    }
    const requestId = lastBusAlternativeRequestIdRef.current + 1
    lastBusAlternativeRequestIdRef.current = requestId
    setLastBusAlternativeStatus('loading')
    setLastBusAlternativeError(null)
    try {
      const route = await walkingRouteClient.getWalkingRoute({
        start: lastBusAlternativeContext.context.startCoordinate,
        destination: lastBusAlternativeContext.context.destinationCoordinate,
      })
      if (lastBusAlternativeRequestIdRef.current !== requestId) return
      setLastBusDirectRoute({ itineraryId: selected.id, route })
      setLastBusAlternativeStatus('ready')
    } catch (nextError) {
      if (lastBusAlternativeRequestIdRef.current !== requestId) return
      setLastBusAlternativeStatus('error')
      setLastBusAlternativeError(
        nextError instanceof WalkingRouteError
          ? nextError.message
          : '지하철 하차 지점부터 목적지까지의 G8 경로를 불러오지 못했습니다.',
      )
    }
  }

  async function loadLastWalkG8Diagnostic() {
    if (
      selected === null ||
      lastWalkingDiagnostic?.startCoordinate == null ||
      lastWalkingDiagnostic.endCoordinate == null ||
      lastWalkG8Status !== 'idle'
    ) {
      return
    }
    const requestId = lastWalkG8RequestIdRef.current + 1
    lastWalkG8RequestIdRef.current = requestId
    setLastWalkG8Status('loading')
    setLastWalkG8Error(null)
    try {
      const route = await walkingRouteClient.getWalkingRoute({
        start: lastWalkingDiagnostic.startCoordinate,
        destination: lastWalkingDiagnostic.endCoordinate,
      })
      if (lastWalkG8RequestIdRef.current !== requestId) return
      setLastWalkG8Result({ itineraryId: selected.id, route })
      setLastWalkG8Status('ready')
    } catch (nextError) {
      if (lastWalkG8RequestIdRef.current !== requestId) return
      setLastWalkG8Status('error')
      setLastWalkG8Error(
        nextError instanceof WalkingRouteError
          ? nextError.message
          : '동일 좌표의 G8 도보 경로를 불러오지 못했습니다.',
      )
    }
  }

  async function loadDirectWalkAlternative() {
    if (
      selected === null ||
      boardingPlan === null ||
      stationAccessContext?.status !== 'ready' ||
      directWalkStatus === 'loading'
    ) {
      return
    }
    const busAssessment = boardingPlan.boardings.find(
      (item) => item.legIndex === stationAccessContext.context.busLegIndex,
    )
    if (busAssessment?.dataFreshness === 'stale') {
      setDirectWalkError('버스 실시간 정보가 2분 이상 지나 다시 조회해야 비교할 수 있습니다.')
      return
    }
    if (
      busAssessment?.selectedOrder === null ||
      (busAssessment?.status !== 'likely' && busAssessment?.status !== 'tight')
    ) {
      setDirectWalkError('먼저 버스 도착정보를 조회해 탑승 가능한 차량을 확인해 주세요.')
      return
    }

    const requestId = directWalkRequestIdRef.current + 1
    directWalkRequestIdRef.current = requestId
    // 두 대안은 버튼을 누른 같은 출발시각을 기준으로 다시 계산한다.
    setBoardingCalculatedAt(new Date().toISOString())
    setDirectWalkStatus('loading')
    setDirectWalkError(null)
    try {
      const route = await walkingRouteClient.getWalkingRoute({
        start: origin,
        destination: stationAccessContext.context.targetCoordinate,
      })
      if (directWalkRequestIdRef.current !== requestId) return
      setDirectWalkResult({ itineraryId: selected.id, route })
      setDirectWalkStatus('ready')
    } catch (nextError) {
      if (directWalkRequestIdRef.current !== requestId) return
      setDirectWalkStatus('error')
      setDirectWalkError(
        nextError instanceof WalkingRouteError
          ? nextError.message
          : '역 접근 비교 지점까지의 도보 경로를 불러오지 못했습니다.',
      )
    }
  }

  async function loadSubwayArrival(
    leg: TransitItinerary['legs'][number],
    legIndex: number,
  ) {
    if (arrivalLoadingLegs.length > 0) return
    const arrivalRequestId = arrivalRequestIdRef.current + 1
    arrivalRequestIdRef.current = arrivalRequestId
    setArrivalLoadingLegs((current) => [...current, legIndex])
    setArrivalErrors((current) => {
      const next = { ...current }
      delete next[legIndex]
      return next
    })
    try {
      const request = createSubwayArrivalRequest(leg)
      const arrival = await subwayArrivalClient.getSubwayArrival(request)
      if (arrivalRequestIdRef.current !== arrivalRequestId) return
      setSubwayArrivals((current) => [
        ...current.filter((item) => item.legIndex !== legIndex),
        { legIndex, arrival },
      ])
      setBoardingCalculatedAt(new Date().toISOString())
    } catch (nextError) {
      if (arrivalRequestIdRef.current !== arrivalRequestId) return
      const message = nextError instanceof SubwayArrivalError
        ? nextError.message
        : '지하철 도착정보를 불러오지 못했습니다.'
      setSubwayArrivals((current) => [
        ...current.filter((item) => item.legIndex !== legIndex),
        {
          legIndex,
          arrival: {
            lineName: leg.routeName ?? '지하철 노선 정보 없음',
            stationName: leg.stops?.[0]?.name ?? leg.startName,
            status: 'api_error',
            estimates: [],
            fetchedAt: new Date().toISOString(),
            provider: 'seoul-subway',
            dataMode: 'live',
          },
        },
      ])
      setArrivalErrors((current) => ({ ...current, [legIndex]: message }))
      setBoardingCalculatedAt(new Date().toISOString())
    } finally {
      if (arrivalRequestIdRef.current === arrivalRequestId) {
        setArrivalLoadingLegs((current) =>
          current.filter((value) => value !== legIndex),
        )
      }
    }
  }

  async function loadBusArrival(
    leg: TransitItinerary['legs'][number],
    legIndex: number,
  ) {
    if (arrivalLoadingLegs.length > 0) return
    const arrivalRequestId = arrivalRequestIdRef.current + 1
    arrivalRequestIdRef.current = arrivalRequestId
    setArrivalLoadingLegs((current) => [...current, legIndex])
    setArrivalErrors((current) => {
      const next = { ...current }
      delete next[legIndex]
      return next
    })
    try {
      const request = createBusArrivalRequest(leg)
      const arrival = await busArrivalClient.getBusArrival(request)
      if (arrivalRequestIdRef.current !== arrivalRequestId) return
      setArrivals((current) => [
        ...current.filter((item) => item.legIndex !== legIndex),
        { legIndex, arrival },
      ])
      setBoardingCalculatedAt(new Date().toISOString())
    } catch (nextError) {
      if (arrivalRequestIdRef.current !== arrivalRequestId) return
      const message = nextError instanceof BusArrivalError
        ? nextError.message
        : '버스 도착정보를 불러오지 못했습니다.'
      setArrivals((current) => [
        ...current.filter((item) => item.legIndex !== legIndex),
        {
          legIndex,
          arrival: {
            routeName: leg.routeName ?? '노선 정보 없음',
            stopName: leg.stops?.[0]?.name ?? leg.startName,
            stopId: null,
            arrivalSeconds: null,
            remainingStops: null,
            fetchedAt: new Date().toISOString(),
            provider: 'tago',
            dataMode: 'live',
            status: 'api_error',
            walkingTimeToStopSeconds: null,
          },
        },
      ])
      setArrivalErrors((current) => ({ ...current, [legIndex]: message }))
      setBoardingCalculatedAt(new Date().toISOString())
    } finally {
      if (arrivalRequestIdRef.current === arrivalRequestId) {
        setArrivalLoadingLegs((current) =>
          current.filter((value) => value !== legIndex),
        )
      }
    }
  }

  async function searchRoutes() {
    if (requestInProgressRef.current) return
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    requestInProgressRef.current = true
    setStatus('loading')
    setError(null)
    try {
      const nextResult = await transitRouteClient.getTransitRoutes({
        start: origin,
        destination: destination.coordinate,
      })
      if (requestIdRef.current !== requestId) return
      setResult(nextResult)
      onResultAvailabilityChange?.(true)
      setSelectedId(nextResult.itineraries[0].id)
      resetArrivals()
      changeMapVisibility(false)
      setStatus('ready')
    } catch (nextError) {
      if (requestIdRef.current !== requestId) return
      setStatus('error')
      setError(getRouteErrorMessage(nextError))
    } finally {
      if (requestIdRef.current === requestId) requestInProgressRef.current = false
    }
  }

  return (
    <>
      <button type="button" className="primary-action" disabled={status === 'loading'} onClick={() => void searchRoutes()}>
        {status === 'loading' ? '대중교통 경로 검색 중' : '대중교통 경로 검색'}
      </button>
      <p className="page-description">검색 버튼을 누를 때만 유료 TMAP API를 호출합니다.</p>
      {error !== null && <p className="error-message auth-message" role="alert">{error}</p>}

      {result !== null && (
        <section className="transit-results-section" aria-labelledby="transit-results-title">
          <div className="transit-section-heading">
            <h2 id="transit-results-title">TMAP 경로 후보</h2>
            <span>총 {result.itineraries.length}개 경로</span>
          </div>
          <div className="transit-route-list">
            {result.itineraries.map((itinerary, index) => {
              const eta = calculateTransitEta(itinerary, speedModel, new Date(result.requestedAt))
              const transitLegs = itinerary.legs.filter(
                (leg) => leg.mode !== 'WALK' && isVisibleLeg(leg),
              )
              return (
                <button key={itinerary.id} type="button" className={`transit-route-option ${selectedId === itinerary.id ? 'selected' : ''}`} aria-pressed={selectedId === itinerary.id} onClick={() => { setSelectedId(itinerary.id); resetArrivals(); changeMapVisibility(false) }}>
                  <span className="transit-option-heading">
                    <span>TMAP 경로 {index + 1}</span>
                    {selectedId === itinerary.id && <span className="selected-route-mark">선택됨</span>}
                  </span>
                  <span className="transit-option-time">
                    {formatDuration(eta.appliedDurationSeconds)}
                    <small>{eta.speedProfile.source === 'personalized' ? 'G7 도보 치환 참고' : 'TMAP 기본 예상'}</small>
                  </span>
                  <span className="transit-badge-row">
                    {transitLegs.length > 0 ? transitLegs.map((leg, legIndex) => (
                      <span className="transit-route-segment" key={`${leg.mode}-${legIndex}-${leg.routeName}`}>
                        {legIndex > 0 && (
                          <span className="transit-transfer-icon" title="환승">
                            <svg viewBox="0 0 20 20" aria-hidden="true">
                              <path d="M3 6h12l-3-3m3 3-3 3M17 14H5l3 3m-3-3 3-3" />
                            </svg>
                          </span>
                        )}
                        <RouteBadge
                          mode={leg.mode}
                          label={getTransitRouteLabel(leg)}
                          routeColor={leg.routeColor}
                        />
                      </span>
                    )) : (
                      <RouteBadge mode="WALK" label="도보 이동" routeColor={null} />
                    )}
                  </span>
                  <small className="transit-option-facts">
                    환승 {itinerary.transferCount}회 · 도보 {formatDistance(itinerary.totalWalkDistanceM)} · {itinerary.fareKrw === null ? '요금 정보 없음' : `${itinerary.fareKrw.toLocaleString('ko-KR')}원`}
                  </small>
                  <small className="transit-provider-time">TMAP 기본 예상 {formatDuration(eta.providerDurationSeconds)}</small>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {result !== null && selected !== null && selectedEta !== null && (
        <>
          <section className="status-card transit-eta-card" aria-labelledby="transit-eta-title">
            <h2 id="transit-eta-title">선택한 경로 상세</h2>
            <dl className="transit-summary-grid">
              <div className="primary-summary"><dt>{selectedEta.speedProfile.source === 'personalized' ? 'G7 도보 치환 참고시간' : 'TMAP 기본 예상시간'}</dt><dd>{formatDuration(selectedEta.appliedDurationSeconds)}</dd></div>
              <div><dt>TMAP 기본 예상시간</dt><dd>{formatDuration(selectedEta.providerDurationSeconds)}</dd></div>
              <div><dt>{selectedEta.speedProfile.source === 'personalized' ? '참고 도착' : '예상 도착'}</dt><dd>{formatKoreanArrivalTime(selectedEta.arrivalAt, new Date(result.requestedAt))}</dd></div>
            </dl>
            <p className="auth-message">{selectedEta.speedProfile.source === 'personalized' ? 'TMAP 전체시간에서 TMAP 도보시간을 빼고, 도보 거리를 G7 속도로 환산한 순수 보행시간을 넣은 참고값입니다. 신호·계단·접근 대기는 별도로 확인되지 않았습니다.' : '학습 데이터가 부족해 TMAP 기본 예상시간을 표시합니다.'} 실시간 버스 대기시간은 이 상단 시간에 반영되지 않으며, 표시 순서는 TMAP 반환 순서입니다.</p>
            {Math.abs(auditTransitDurations(selected, selectedEta).providerToLegDifferenceSeconds) >= 1 && <p className="auth-message warning-card">TMAP 전체시간과 구간 합계가 다릅니다. 공급자 원본 값을 그대로 표시합니다.</p>}
            <button type="button" className="secondary-button route-map-toggle" onClick={() => changeMapVisibility(!isMapVisible)}>
              {isMapVisible ? '지도 접기' : '지도 보기'}
            </button>
          </section>
          {isMapVisible && (
            <section className="status-card map-card" aria-labelledby="transit-map-title">
              <h2 id="transit-map-title">선택한 대중교통 경로</h2>
              <TransitRouteMap itinerary={selected} start={origin} destination={destination.coordinate} />
            </section>
          )}
          {import.meta.env.DEV && lastWalkingDiagnostic !== null && (
            <details className="bus-arrival-diagnostics transit-route-diagnostics">
              <summary>로컬 TMAP 마지막 도보 진단</summary>
              <dl>
                <dt>공급자</dt>
                <dd>{lastWalkingDiagnostic.provider}</dd>
                <dt>선택 목적지</dt>
                <dd>
                  {destination.name}{' · '}
                  {lastWalkingDiagnostic.destinationCoordinate.latitude.toFixed(6)},{' '}
                  {lastWalkingDiagnostic.destinationCoordinate.longitude.toFixed(6)}
                </dd>
                <dt>TMAP 요청 목적지</dt>
                <dd>
                  {lastWalkingDiagnostic.destinationCoordinate.latitude.toFixed(6)},{' '}
                  {lastWalkingDiagnostic.destinationCoordinate.longitude.toFixed(6)}
                </dd>
                <dt>직전 하차 지점</dt>
                <dd>
                  {lastWalkingDiagnostic.previousTransitStopName ?? '정보 없음'}{' · '}
                  {lastWalkingDiagnostic.previousTransitStopCoordinate === null
                    ? '좌표 없음'
                    : `${lastWalkingDiagnostic.previousTransitStopCoordinate.latitude.toFixed(6)}, ${lastWalkingDiagnostic.previousTransitStopCoordinate.longitude.toFixed(6)}`}
                </dd>
                <dt>WALK 시작</dt>
                <dd>
                  {lastWalkingDiagnostic.startName}{' · '}
                  {lastWalkingDiagnostic.startCoordinate === null
                    ? '좌표 없음'
                    : `${lastWalkingDiagnostic.startCoordinate.latitude.toFixed(6)}, ${lastWalkingDiagnostic.startCoordinate.longitude.toFixed(6)}`}
                </dd>
                <dt>WALK 종료</dt>
                <dd>
                  {lastWalkingDiagnostic.endName}{' · '}
                  {lastWalkingDiagnostic.endCoordinate === null
                    ? '좌표 없음'
                    : `${lastWalkingDiagnostic.endCoordinate.latitude.toFixed(6)}, ${lastWalkingDiagnostic.endCoordinate.longitude.toFixed(6)}`}
                </dd>
                <dt>TMAP 원본</dt>
                <dd>
                  {formatDistance(lastWalkingDiagnostic.distanceM)}{' · '}
                  {formatDuration(lastWalkingDiagnostic.durationSeconds)}
                </dd>
                <dt>파싱 경로점</dt>
                <dd>
                  {lastWalkingDiagnostic.parsedPathPointCount}개{' · '}
                  {lastWalkingDiagnostic.parsedPathDistanceM === null
                    ? '경로 길이 계산 불가'
                    : `약 ${formatDistance(lastWalkingDiagnostic.parsedPathDistanceM)}`}
                </dd>
                <dt>양 끝점 직선거리</dt>
                <dd>
                  {lastWalkingDiagnostic.straightLineDistanceM === null
                    ? '계산 불가'
                    : `약 ${formatDistance(lastWalkingDiagnostic.straightLineDistanceM)}`}
                </dd>
                <dt>요청 목적지 오차</dt>
                <dd>
                  {lastWalkingDiagnostic.destinationGapM === null
                    ? '계산 불가'
                    : `약 ${formatDistance(lastWalkingDiagnostic.destinationGapM)}`}
                </dd>
              </dl>
              <p>키·인증정보·원본 요청 URL은 표시하지 않습니다. 이 값은 새 TMAP 호출 없이 현재 검색 응답에서 계산됩니다.</p>
              {lastWalkingDiagnostic.startCoordinate !== null &&
              lastWalkingDiagnostic.endCoordinate !== null && (
                <button
                  type="button"
                  className="secondary-button station-access-comparison-button"
                  disabled={lastWalkG8Status === 'loading' || lastWalkG8Status === 'ready'}
                  onClick={() => void loadLastWalkG8Diagnostic()}
                >
                  {lastWalkG8Status === 'loading'
                    ? '동일 좌표 G8 조회 중'
                    : lastWalkG8Status === 'ready'
                      ? '동일 좌표 G8 조회 완료'
                      : '동일 좌표로 G8 도보 경로 1회 조회'}
                </button>
              )}
              {lastWalkG8Error !== null && (
                <p className="error-message" role="alert">{lastWalkG8Error}</p>
              )}
              {lastWalkG8Result?.itineraryId === selected.id && (
                <div className="station-access-comparison-result">
                  <strong>TMAP과 G8 동일 좌표 비교</strong>
                  <span>
                    TMAP {formatDistance(lastWalkingDiagnostic.distanceM)} ·{' '}
                    {formatDuration(lastWalkingDiagnostic.durationSeconds)}
                  </span>
                  <span>
                    G8 실제 경로 {formatDistance(lastWalkG8Result.route.distanceM)} ·{' '}
                    카카오 예상 {formatDuration(lastWalkG8Result.route.providerDurationSeconds)} ·{' '}
                    경로점 {lastWalkG8Result.route.coordinates.length}개
                  </span>
                  <span>
                    거리 차이 {formatDistance(Math.abs(
                      lastWalkingDiagnostic.distanceM - lastWalkG8Result.route.distanceM,
                    ))}
                  </span>
                  {lastWalkG8EndpointGaps !== null && (
                    <small>
                      G8 반환 경로점 오차: 시작 약 {formatDistance(lastWalkG8EndpointGaps.startGapM)} · 종료 약 {formatDistance(lastWalkG8EndpointGaps.destinationGapM)}
                    </small>
                  )}
                  <small>G8이 짧아도 실제 횡단·출입 가능 여부를 확인하기 전에는 TMAP 값을 대체하지 않습니다.</small>
                  <WalkingRouteMap
                    coordinates={lastWalkG8Result.route.coordinates}
                    comparisonCoordinates={selected.legs.at(-1)?.coordinates}
                    start={lastWalkingDiagnostic.startCoordinate}
                    destination={lastWalkingDiagnostic.endCoordinate}
                  />
                </div>
              )}
            </details>
          )}
          {stationAccessContext !== null &&
          stationAccessContext.status !== 'unsupported_structure' && (
            <section className="status-card station-access-comparison" aria-labelledby="station-access-comparison-title">
              <h2 id="station-access-comparison-title">역까지 직접 걷기와 비교</h2>
              {stationAccessContext.status === 'endpoint_unavailable' && (
                <p className="auth-message">TMAP 응답에서 동일한 역 접근 비교 지점 좌표를 확보하지 못해 비교할 수 없습니다.</p>
              )}
              {stationAccessContext.status === 'endpoint_mismatch' && (
                <p className="auth-message">버스 후 도보 종료점과 지하철 시작점이 30m보다 멀어 같은 도착 지점으로 확인할 수 없습니다.</p>
              )}
              {stationAccessContext.status === 'ready' && (
                <>
                  <p className="page-description">
                    비교 지점: TMAP {stationAccessContext.context.targetName} 접근점
                    {' · '}두 구간 좌표 차이 {Math.round(stationAccessContext.context.endpointGapM)}m
                  </p>
                  <p className="search-status">실제 출입구 번호는 확인되지 않았습니다. 버튼을 누를 때만 이 동일 지점까지 카카오 도보 경로를 조회합니다.</p>
                  <button
                    type="button"
                    className="secondary-button station-access-comparison-button"
                    disabled={directWalkStatus === 'loading'}
                    onClick={() => void loadDirectWalkAlternative()}
                  >
                    {directWalkStatus === 'loading'
                      ? '직접 도보 경로 조회 중'
                      : '역까지 직접 걷기와 비교'}
                  </button>
                  {directWalkError !== null && (
                    <p className="error-message auth-message" role="alert">{directWalkError}</p>
                  )}
                  {stationAccessComparison?.status === 'available' && (
                    <div className="station-access-comparison-result" role="status">
                      <dl>
                        <div>
                          <dt>버스 이용</dt>
                          <dd>{formatDuration(stationAccessComparison.comparison.busDurationSeconds)}</dd>
                          <small>
                            {stationAccessComparison.comparison.selectedBusOrder === 1 ? '첫 번째' : '두 번째'}{' '}
                            {getTransitRouteLabel(selected.legs[stationAccessContext.context.busLegIndex])} 기준
                          </small>
                          <small>
                            접근점 도착 {formatKoreanArrivalTime(
                              stationAccessComparison.comparison.busArrivalAt,
                              new Date(stationAccessComparison.comparison.calculatedAt),
                            )}
                          </small>
                        </div>
                        <div>
                          <dt>직접 도보</dt>
                          <dd>{formatDuration(stationAccessComparison.comparison.directWalkDurationSeconds)}</dd>
                          <small>
                            {stationAccessComparison.comparison.directWalkSpeedProfile.source === 'personalized'
                              ? 'G7 순수 보행시간'
                              : 'G7 미학습 · 기본속도'}
                          </small>
                          <small>
                            접근점 도착 {formatKoreanArrivalTime(
                              stationAccessComparison.comparison.directWalkArrivalAt,
                              new Date(stationAccessComparison.comparison.calculatedAt),
                            )}
                          </small>
                        </div>
                      </dl>
                      <strong className="station-access-comparison-conclusion">
                        {stationAccessComparison.comparison.outcome === 'similar'
                          ? '두 방법의 차이가 2분 이내여서 비슷할 것으로 예상됩니다.'
                          : stationAccessComparison.comparison.outcome === 'direct_walk_faster'
                            ? `역 접근점까지는 직접 걷는 편이 약 ${formatDuration(stationAccessComparison.comparison.differenceSeconds)} 빠를 것으로 예상됩니다.`
                            : `역 접근점까지는 버스를 이용하는 편이 약 ${formatDuration(stationAccessComparison.comparison.differenceSeconds)} 빠를 것으로 예상됩니다.`}
                      </strong>
                      <small>카카오 공급자 예상 {formatDuration(stationAccessComparison.comparison.kakaoProviderDurationSeconds)} · 실제 도보 {formatDistance(stationAccessComparison.comparison.directWalkDistanceM)}</small>
                      <small>버스 시간은 실시간 차량 도착시각 + TMAP 버스 구간시간 + 후속 G7 순수 보행시간입니다. 신호 대기, 교통 지연, 역사 내부 이동은 제외되어 최적 경로를 확정하지 않습니다.</small>
                      <button
                        type="button"
                        className="secondary-button route-map-toggle"
                        onClick={() => setIsDirectWalkMapVisible((current) => !current)}
                      >
                        {isDirectWalkMapVisible ? '직접 도보 지도 접기' : '직접 도보 경로 지도 보기'}
                      </button>
                    </div>
                  )}
                  {stationAccessComparison !== null &&
                  stationAccessComparison.status !== 'available' && (
                    <p className="auth-message">
                      {stationAccessComparison.status === 'direct_route_endpoint_mismatch'
                        ? '카카오 도보 경로의 실제 끝점이 TMAP 비교 지점과 일치하지 않아 비교할 수 없습니다.'
                        : stationAccessComparison.status === 'live_data_stale'
                          ? '버스 실시간 정보가 2분 이상 지나 다시 조회해야 비교할 수 있습니다.'
                          : '현재 탑승 가능한 최신 버스 정보가 없어 비교 결과를 확정할 수 없습니다.'}
                    </p>
                  )}
                  {isDirectWalkMapVisible && directWalkResult?.itineraryId === selected.id && (
                    <div className="station-access-map">
                      <WalkingRouteMap
                        coordinates={directWalkResult.route.coordinates}
                        start={origin}
                        destination={stationAccessContext.context.targetCoordinate}
                      />
                    </div>
                  )}
                </>
              )}
            </section>
          )}
          {lastBusAlternativeContext !== null &&
          lastBusAlternativeContext.status !== 'unsupported_structure' && (
            <section className="status-card station-access-comparison" aria-labelledby="last-bus-alternative-title">
              <h2 id="last-bus-alternative-title">목적지까지 직접 걷기와 비교</h2>
              {lastBusAlternativeContext.status === 'coordinate_unavailable' && (
                <p className="auth-message">지하철 하차·버스 승하차·목적지 좌표가 모두 확보되지 않아 비교할 수 없습니다.</p>
              )}
              {lastBusAlternativeContext.status === 'coordinate_mismatch' && (
                <p className="auth-message">TMAP 구간 연결 좌표 또는 선택 목적지 좌표가 일치하지 않아 비교할 수 없습니다.</p>
              )}
              {lastBusAlternativeContext.status === 'ready' && (
                <>
                  <p className="page-description">
                    시작: {lastBusAlternativeContext.context.startName}{' · '}
                    종료: {lastBusAlternativeContext.context.destinationName}
                  </p>
                  <p className="search-status">지하철 하차 후 실제 도보가 시작되는 TMAP 좌표부터 선택 목적지 좌표까지 비교합니다.</p>
                  <button
                    type="button"
                    className="secondary-button station-access-comparison-button"
                    disabled={lastBusAlternativeStatus === 'loading' || lastBusAlternativeStatus === 'ready'}
                    onClick={() => void loadLastBusDirectAlternative()}
                  >
                    {lastBusAlternativeStatus === 'loading'
                      ? '직접 도보 경로 조회 중'
                      : lastBusAlternativeStatus === 'ready'
                        ? '직접 도보 비교 완료'
                        : '목적지까지 직접 걷기와 비교'}
                  </button>
                  {lastBusAlternativeError !== null && (
                    <p className="error-message auth-message" role="alert">{lastBusAlternativeError}</p>
                  )}
                  {lastBusAlternativeComparison !== null && (
                    <div className="station-access-comparison-result" role="status">
                      <dl>
                        <div>
                          <dt>목적지까지 직접 도보</dt>
                          <dd>{formatDuration(lastBusAlternativeComparison.directWalkDurationSeconds)}</dd>
                          <small>
                            G8 {formatDistance(lastBusAlternativeComparison.directWalkDistanceM)} · 카카오 예상 {formatDuration(lastBusAlternativeComparison.kakaoProviderDurationSeconds)}
                          </small>
                        </div>
                        <div>
                          <dt>버스 이용 기본 이동</dt>
                          <dd>{formatDuration(lastBusAlternativeComparison.busBaseDurationSeconds)}</dd>
                          <small>버스 대기시간 미확인</small>
                        </div>
                      </dl>
                      <small>
                        버스정류장까지 G7 {formatDuration(lastBusAlternativeComparison.busAccessWalkDurationSeconds)} + TMAP 버스 {formatDuration(lastBusAlternativeComparison.busRideDurationSeconds)} + 하차 후 G7 {formatDuration(lastBusAlternativeComparison.finalWalkDurationSeconds)}
                      </small>
                      {lastBusAlternativeComparison.outcome === 'bus_faster_if_wait_below_threshold' && (
                        <strong className="station-access-comparison-conclusion">
                          버스 대기시간이 {formatDuration(lastBusAlternativeComparison.breakEvenWaitSeconds)}보다 길어지면 직접 걷는 편이 빠를 수 있습니다.
                        </strong>
                      )}
                      {lastBusAlternativeComparison.outcome === 'direct_walk_faster_even_without_wait' && (
                        <strong className="station-access-comparison-conclusion">
                          계산상 버스를 바로 타더라도 직접 도보가 더 짧지만, 실제 보행 가능 여부 확인 전에는 추천을 확정하지 않습니다.
                        </strong>
                      )}
                      {lastBusAlternativeComparison.outcome === 'review_required' && (
                        <strong className="station-access-comparison-conclusion">
                          G8 경로의 시작·종료점 스냅 오차가 30m를 넘어 참고용으로만 표시합니다.
                        </strong>
                      )}
                      <small>
                        좌표 검증: 시작 오차 약 {formatDistance(lastBusAlternativeComparison.directRouteStartGapM)} · 종료 오차 약 {formatDistance(lastBusAlternativeComparison.directRouteDestinationGapM)} · {lastBusAlternativeComparison.directRouteValidation === 'verified' ? '비교 가능' : '확인 필요'}
                      </small>
                      <small>현재 조회한 버스 도착정보는 미래 환승 대기시간으로 사용하지 않습니다. 실제 버스정류장 도착 시 다시 조회해야 합니다.</small>
                      <small>신호·계단·역사 접근시간과 교통 지연은 확인되지 않았으며, 전체 경로를 최적이라고 확정하지 않습니다.</small>
                      {lastBusDirectRoute?.itineraryId === selected.id && (
                        <WalkingRouteMap
                          coordinates={lastBusDirectRoute.route.coordinates}
                          start={lastBusAlternativeContext.context.startCoordinate}
                          destination={lastBusAlternativeContext.context.destinationCoordinate}
                        />
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          )}
          <section className="status-card" aria-labelledby="transit-legs-title">
            <h2 id="transit-legs-title">상세 이동 경로</h2>
            <p className="page-description">TMAP 원본시간과 G7 거리 기반 순수 보행시간을 분리해 표시합니다.</p>
            <p className="search-status">버스·지하철 구간별 조회 버튼을 누를 때만 실시간 정보를 조회하며 자동 갱신하지 않습니다.</p>
            <ol className="transit-leg-list">
              {selected.legs
                .map((leg, legIndex) => ({
                  leg,
                  legIndex,
                  arrival:
                    arrivals.find((item) => item.legIndex === legIndex)
                      ?.arrival ?? null,
                  subwayArrival:
                    subwayArrivals.find((item) => item.legIndex === legIndex)
                      ?.arrival ?? null,
                  arrivalError: arrivalErrors[legIndex] ?? null,
                  walkingEstimate:
                    boardingPlan?.walkingLegs.find(
                      (item) => item.legIndex === legIndex,
                    ) ?? null,
                  boardingAssessment:
                    boardingPlan?.boardings.find(
                      (item) => item.legIndex === legIndex,
                    ) ?? null,
                }))
                .filter(({ leg }) => isVisibleLeg(leg))
                .map(({ leg, legIndex, arrival, subwayArrival, arrivalError, walkingEstimate, boardingAssessment }) => (
                <li key={`${leg.mode}-${legIndex}-${leg.startName}`}>
                  <span
                    className={`transit-leg-icon mode-${leg.mode.toLowerCase()} ${normalizeTmapRouteColor(leg.routeColor) === null ? '' : 'has-route-color'}`}
                    style={normalizeTmapRouteColor(leg.routeColor) === null ? undefined : ({ '--transit-route-color': normalizeTmapRouteColor(leg.routeColor) } as CSSProperties)}
                  >
                    <TransitModeIcon mode={leg.mode} />
                  </span>
                  <span className="transit-leg-content">
                    <strong>{getTransitRouteLabel(leg)}</strong>
                    <span>{leg.startName} → {leg.endName}</span>
                    <small>{formatDistance(leg.distanceM)}</small>
                    {walkingEstimate !== null && (
                      <span className="transit-walking-comparison">
                        <small>TMAP 기본 {formatDuration(walkingEstimate.tmapDurationSeconds)}</small>
                        <strong>
                          {walkingEstimate.speedProfile.source === 'personalized'
                            ? 'G7 순수 보행'
                            : '기본속도 순수 보행'}{' '}
                          {formatDuration(walkingEstimate.pureWalkingDurationSeconds)}
                        </strong>
                        <small>
                          {walkingEstimate.speedProfile.source === 'personalized'
                            ? `최근 유효 기록 ${walkingEstimate.speedProfile.validSessionCount}개 기반 참고값`
                            : 'G7 표본 부족 · 기본속도 참고값'}
                        </small>
                        <small>신호·계단·접근 대기 포함 여부 미확인</small>
                      </span>
                    )}
                    {leg.mode === 'BUS' && (
                      <button
                        type="button"
                        className="secondary-button bus-arrival-button"
                        disabled={arrivalLoadingLegs.length > 0}
                        onClick={() => void loadBusArrival(leg, legIndex)}
                      >
                        {arrivalLoadingLegs.includes(legIndex)
                          ? '도착정보 조회 중'
                          : '실시간 도착정보 조회'}
                      </button>
                    )}
                    {leg.mode === 'SUBWAY' && (
                      <button
                        type="button"
                        className="secondary-button bus-arrival-button"
                        disabled={arrivalLoadingLegs.length > 0}
                        onClick={() => void loadSubwayArrival(leg, legIndex)}
                      >
                        {arrivalLoadingLegs.includes(legIndex)
                          ? '도착정보 조회 중'
                          : '실시간 열차 도착정보 조회'}
                      </button>
                    )}
                    {arrival !== null && <BusArrivalStatus arrival={arrival} />}
                    {subwayArrival !== null && (
                      <SubwayArrivalStatus arrival={subwayArrival} />
                    )}
                    {boardingAssessment !== null &&
                    (arrival !== null || subwayArrival !== null) && (
                      <TransitBoardingAssessment assessment={boardingAssessment} />
                    )}
                    {arrivalError !== null && (
                      <span className="error-message auth-message" role="alert">
                        {arrivalError}
                      </span>
                    )}
                  </span>
                  <strong className="transit-leg-duration">{formatDuration(leg.durationSeconds)}</strong>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </>
  )
}
