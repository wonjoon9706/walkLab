import { useEffect, useRef, useState } from 'react'
import type {
  TransitItinerary,
  TransitMode,
  TransitRouteResult,
} from '../../domain/transitRoute'
import { TransitRouteError } from '../../domain/transitRoute'
import type { GeoCoordinate, PlaceSearchResult } from '../../domain/walkingRoute'
import type { WalkingSpeedModel } from '../../domain/walkingSpeedModel'
import { formatDistance, formatDuration, formatKoreanArrivalTime } from '../../utils/format'
import { TransitRouteMap } from '../map/TransitRouteMap'
import { auditTransitDurations, calculateTransitEta } from '../../services/routing/transitEta'
import { transitRouteClient } from '../../services/routing/transitRouteClient'

interface TransitRoutePanelProps {
  active: boolean
  origin: GeoCoordinate
  destination: PlaceSearchResult
  speedModel: WalkingSpeedModel | null
  onMapVisibilityChange?: (isVisible: boolean) => void
  onResultAvailabilityChange?: (hasResult: boolean) => void
}

function getModeLabel(mode: TransitMode): string {
  const labels: Record<TransitMode, string> = {
    WALK: '도보', BUS: '버스', SUBWAY: '지하철', EXPRESSBUS: '고속·시외버스',
    TRAIN: '기차', AIRPLANE: '항공', FERRY: '해운',
  }
  return labels[mode]
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

function getTransitSummary(itinerary: TransitItinerary): string {
  return itinerary.legs
    .filter((leg) => leg.mode !== 'WALK' && isVisibleLeg(leg))
    .map((leg) => leg.routeName ?? getModeLabel(leg.mode))
    .join(' → ')
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
  const requestInProgressRef = useRef(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<TransitRouteResult | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isMapVisible, setIsMapVisible] = useState(false)

  useEffect(() => () => {
    requestIdRef.current += 1
    onMapVisibilityChange?.(false)
    onResultAvailabilityChange?.(false)
  }, [onMapVisibilityChange, onResultAvailabilityChange])

  function changeMapVisibility(isVisible: boolean) {
    setIsMapVisible(isVisible)
    onMapVisibilityChange?.(isVisible)
  }

  if (!active) return null

  const selected = result?.itineraries.find((item) => item.id === selectedId) ?? null
  const selectedEta = selected === null || result === null
    ? null
    : calculateTransitEta(selected, speedModel, new Date(result.requestedAt))

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
        <section className="status-card" aria-labelledby="transit-results-title">
          <h2 id="transit-results-title">추천 경로</h2>
          <div className="transit-route-list">
            {result.itineraries.map((itinerary, index) => {
              const eta = calculateTransitEta(itinerary, speedModel, new Date(result.requestedAt))
              return (
                <button key={itinerary.id} type="button" className={`transit-route-option ${selectedId === itinerary.id ? 'selected' : ''}`} aria-pressed={selectedId === itinerary.id} onClick={() => { setSelectedId(itinerary.id); changeMapVisibility(false) }}>
                  <strong>추천 {index + 1} · {eta.speedProfile.source === 'personalized' ? '개인화 예상 ' : 'TMAP 예상 '}{formatDuration(eta.appliedDurationSeconds)}</strong>
                  <span>{getTransitSummary(itinerary) || '도보 이동'}</span>
                  <small>환승 {itinerary.transferCount}회 · 도보 {formatDistance(itinerary.totalWalkDistanceM)} · {itinerary.fareKrw === null ? '요금 정보 없음' : `${itinerary.fareKrw.toLocaleString('ko-KR')}원`}</small>
                  {eta.speedProfile.source === 'personalized' && <small>TMAP 기본 {formatDuration(eta.providerDurationSeconds)}</small>}
                </button>
              )
            })}
          </div>
        </section>
      )}

      {result !== null && selected !== null && selectedEta !== null && (
        <>
          <section className="status-card transit-eta-card" aria-labelledby="transit-eta-title">
            <p className="eta-label">{selectedEta.speedProfile.source === 'personalized' ? '개인화 예상 이동시간' : 'TMAP 예상 이동시간'}</p>
            <h2 id="transit-eta-title" className="hero-metric">{formatDuration(selectedEta.appliedDurationSeconds)}</h2>
            <dl className="eta-key-facts">
              <div><dt>TMAP 기본 예상시간</dt><dd>{formatDuration(selectedEta.providerDurationSeconds)}</dd></div>
              <div><dt>예상 도착</dt><dd>{formatKoreanArrivalTime(selectedEta.arrivalAt, new Date(result.requestedAt))}</dd></div>
            </dl>
            <p className="auth-message">{selectedEta.speedProfile.source === 'personalized' ? '대중교통 시간은 유지하고 도보 구간만 개인 보행속도로 보정했습니다.' : '학습 데이터가 부족해 TMAP 기본 예상시간을 표시합니다.'} 실제 도착정보나 탑승 가능 여부를 보장하지 않습니다.</p>
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
          <section className="status-card" aria-labelledby="transit-legs-title">
            <h2 id="transit-legs-title">TMAP 원본 이동 순서</h2>
            <p className="page-description">아래 구간 시간은 개인화 보정 전 TMAP 원본입니다.</p>
            <ol className="transit-leg-list">
              {selected.legs.filter(isVisibleLeg).map((leg, index) => (
                <li key={`${leg.mode}-${index}-${leg.startName}`}><strong>{leg.routeName ?? getModeLabel(leg.mode)}</strong><span>{leg.startName} → {leg.endName}</span><small>{formatDuration(leg.durationSeconds)} · {formatDistance(leg.distanceM)}</small></li>
              ))}
            </ol>
          </section>
        </>
      )}
    </>
  )
}
