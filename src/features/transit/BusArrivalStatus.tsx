import { useEffect, useState } from 'react'
import type { BusArrivalInfo } from '../../domain/busArrival'
import { formatDuration } from '../../utils/format'

const STATUS_MESSAGES: Readonly<Record<BusArrivalInfo['status'], string>> = {
  available: '',
  no_service: '현재 운행 중인 도착정보가 없습니다.',
  unsupported_region: 'TAGO 실시간 도착정보를 지원하지 않는 지역입니다.',
  stop_match_failed: '경로 정류장과 TAGO 정류장을 연결하지 못했습니다.',
  stop_match_review_required: '같은 이름의 정류장이 있어 정류장 확인이 필요합니다.',
  api_error: '실시간 도착정보를 불러오지 못했습니다.',
}

const STALE_AFTER_MS = 2 * 60 * 1_000

function formatFetchedAt(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

export function BusArrivalStatus({ arrival }: { arrival: BusArrivalInfo }) {
  const [isStale, setIsStale] = useState(false)
  useEffect(() => {
    const staleAt = new Date(arrival.fetchedAt).getTime() + STALE_AFTER_MS
    const delay = Math.max(0, staleAt - Date.now())
    const timeoutId = window.setTimeout(() => setIsStale(true), delay)
    return () => window.clearTimeout(timeoutId)
  }, [arrival.fetchedAt])
  const providerLabel = arrival.dataMode === 'mock'
    ? 'TAGO Mock'
    : arrival.provider === 'seoul'
      ? '서울시 버스 실시간'
      : 'TAGO 실시간'
  const upcomingArrivals = arrival.status === 'available'
    ? arrival.upcomingArrivals ?? []
    : []
  const departureWaiting = upcomingArrivals.some(
    (estimate) => estimate.serviceStatus === 'departure_waiting',
  )
  const activeArrivals = upcomingArrivals.filter(
    (estimate) => estimate.serviceStatus !== 'departure_waiting',
  )
  return (
    <section className="bus-arrival-status" aria-label={`${arrival.stopName} 버스 도착정보`}>
      <strong>{arrival.routeName}</strong>
      <span>{arrival.stopName}</span>
      {arrival.status === 'available' &&
      arrival.arrivalSeconds !== null ? (
        <>
          {upcomingArrivals.length > 0 ? (
            <>
              {activeArrivals.length > 0 && (
                <ol className="bus-arrival-estimates">
                  {activeArrivals.map((estimate) => (
                <li key={estimate.order}>
                  <b>
                    {estimate.order === 1 ? '첫 번째' : '두 번째'} 버스
                  </b>
                  <span className="bus-arrival-estimate-facts">
                    {estimate.remainingStops !== null && (
                      <span>{estimate.remainingStops}정거장 전</span>
                    )}
                    <strong>
                      {estimate.arrivalTimeStatus === 'review_required'
                        ? '도착시간 확인 필요'
                        : `도착 예정 ${formatDuration(estimate.arrivalSeconds)}`}
                    </strong>
                  </span>
                  {estimate.arrivalTimeStatus === 'review_required' && (
                    <small>
                      서울시 시간값과 남은 정류장 수가 일치하지 않습니다.
                      {estimate.message === null ? '' : ` 원본 안내: ${estimate.message}`}
                    </small>
                  )}
                </li>
                  ))}
                </ol>
              )}
              {departureWaiting && (
                <span className="bus-arrival-unavailable">
                  출발 대기 중 · 도착 예정시간 미확정
                </span>
              )}
            </>
          ) : (
            <>
              <b>도착 예정 {formatDuration(arrival.arrivalSeconds)}</b>
              {arrival.remainingStops !== null && (
                <span>{arrival.remainingStops}정거장 전</span>
              )}
            </>
          )}
        </>
      ) : (
        <span className="bus-arrival-unavailable">{STATUS_MESSAGES[arrival.status]}</span>
      )}
      <small>
        마지막 조회 {formatFetchedAt(arrival.fetchedAt)} · {providerLabel}
      </small>
      {arrival.dataMode === 'live' && isStale && (
        <small className="bus-arrival-stale">조회 후 2분이 지나 최신 정보가 아닐 수 있습니다.</small>
      )}
      {arrival.diagnostics !== undefined && (
        <details className="bus-arrival-diagnostics">
          <summary>로컬 TAGO 매칭 진단</summary>
          <dl>
            <dt>마지막 단계</dt>
            <dd>{arrival.diagnostics.lastStage}</dd>
            <dt>판정</dt>
            <dd>{arrival.diagnostics.outcomeReason}</dd>
            <dt>경로 승차 정류장</dt>
            <dd>
              {arrival.diagnostics.route.boardingStopName}
              {' · '}
              {arrival.diagnostics.route.boardingCoordinate.latitude.toFixed(6)},
              {' '}
              {arrival.diagnostics.route.boardingCoordinate.longitude.toFixed(6)}
            </dd>
            <dt>조회 건수</dt>
            <dd>
              도시코드 {arrival.diagnostics.cityCodeCount} · 인근 정류장{' '}
              {arrival.diagnostics.nearbyStopCount} · 1차 후보{' '}
              {arrival.diagnostics.routeLookupCandidateCount}
            </dd>
          </dl>
          {arrival.diagnostics.candidates.length > 0 && (
            <ul>
              {arrival.diagnostics.candidates.map((candidate) => (
                <li key={`${candidate.cityCode}:${candidate.nodeId}`}>
                  <strong>{candidate.name}</strong>
                  {' · '}{candidate.distanceM.toFixed(1)}m
                  {' · 이름 '}{candidate.nameMatched ? '일치' : '불일치'}
                  {' · 노선 '}
                  {candidate.routeNames.length > 0
                    ? candidate.routeNames.join(', ')
                    : '조회 전/없음'}
                  {candidate.directionChecks.map((check) => (
                    <small key={`${check.routeId}:${check.routeName}`}>
                      방향 {check.routeName}: {check.status}
                      {check.reason === null ? '' : ` (${check.reason})`}
                      {' · 경유 '}{check.routeStopCount}곳
                    </small>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </section>
  )
}
