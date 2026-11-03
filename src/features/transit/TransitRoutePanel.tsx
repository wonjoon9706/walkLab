import { useEffect, useRef, useState, type CSSProperties } from 'react'
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
        <section className="transit-results-section" aria-labelledby="transit-results-title">
          <div className="transit-section-heading">
            <h2 id="transit-results-title">추천 경로</h2>
            <span>총 {result.itineraries.length}개 경로</span>
          </div>
          <div className="transit-route-list">
            {result.itineraries.map((itinerary, index) => {
              const eta = calculateTransitEta(itinerary, speedModel, new Date(result.requestedAt))
              const transitLegs = itinerary.legs.filter(
                (leg) => leg.mode !== 'WALK' && isVisibleLeg(leg),
              )
              return (
                <button key={itinerary.id} type="button" className={`transit-route-option ${selectedId === itinerary.id ? 'selected' : ''}`} aria-pressed={selectedId === itinerary.id} onClick={() => { setSelectedId(itinerary.id); changeMapVisibility(false) }}>
                  <span className="transit-option-heading">
                    <span>추천 {index + 1}</span>
                    {selectedId === itinerary.id && <span className="selected-route-mark">선택됨</span>}
                  </span>
                  <span className="transit-option-time">
                    {formatDuration(eta.appliedDurationSeconds)}
                    <small>{eta.speedProfile.source === 'personalized' ? '개인화 예상' : 'TMAP 예상'}</small>
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
              <div className="primary-summary"><dt>{selectedEta.speedProfile.source === 'personalized' ? '개인화 예상' : 'TMAP 예상'}</dt><dd>{formatDuration(selectedEta.appliedDurationSeconds)}</dd></div>
              <div><dt>TMAP 기본</dt><dd>{formatDuration(selectedEta.providerDurationSeconds)}</dd></div>
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
            <h2 id="transit-legs-title">상세 이동 경로</h2>
            <p className="page-description">아래 구간 시간은 개인화 보정 전 TMAP 원본입니다.</p>
            <ol className="transit-leg-list">
              {selected.legs.filter(isVisibleLeg).map((leg, index) => (
                <li key={`${leg.mode}-${index}-${leg.startName}`}>
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
