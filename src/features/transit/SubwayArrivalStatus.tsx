import type { SubwayArrivalInfo } from '../../domain/subwayArrival'
import { formatDuration } from '../../utils/format'

const STALE_AFTER_MS = 2 * 60 * 1_000

const TRAIN_ORDER_LABELS = ['첫 번째', '두 번째', '세 번째', '네 번째'] as const

const STATUS_MESSAGES: Readonly<Record<SubwayArrivalInfo['status'], string>> = {
  available: '',
  no_service: '현재 조건에 맞는 열차 도착정보가 없습니다.',
  no_arrival_data: '서울시 API에 현재 제공된 열차 도착정보가 없습니다. 운행 중단을 의미하지 않습니다.',
  unsupported_station: '서울시 실시간 도착정보를 제공하지 않는 역입니다.',
  station_match_failed: 'TMAP 역과 서울시 지하철역을 연결하지 못했습니다.',
  review_required: '노선 또는 열차 방향을 안전하게 확인할 수 없습니다.',
  api_error: '지하철 실시간 도착정보를 불러오지 못했습니다.',
}

function formatFetchedAt(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

export function SubwayArrivalStatus({
  arrival,
}: {
  arrival: SubwayArrivalInfo
}) {
  const newestGeneratedAt = arrival.estimates.reduce(
    (newest, estimate) => Math.max(newest, new Date(estimate.generatedAt).getTime()),
    0,
  )
  const fetchedAt = new Date(arrival.fetchedAt).getTime()
  const isStale = newestGeneratedAt > 0
    && fetchedAt >= newestGeneratedAt + STALE_AFTER_MS

  return (
    <section
      className="bus-arrival-status subway-arrival-status"
      aria-label={`${arrival.stationName} 지하철 도착정보`}
    >
      <strong>{arrival.lineName}</strong>
      <span>{arrival.stationName}</span>
      {arrival.status === 'available' && arrival.estimates.length > 0 ? (
        <ol className="bus-arrival-estimates">
          {arrival.estimates.map((estimate) => (
            <li key={estimate.order}>
              <b>{TRAIN_ORDER_LABELS[estimate.order - 1]} 열차</b>
              <span className="bus-arrival-estimate-facts">
                <span>{estimate.direction} · {estimate.destination}행</span>
                <strong>도착 예정 {formatDuration(estimate.arrivalSeconds)}</strong>
              </span>
              <small>
                {estimate.trainType === 'express' ? '급행' : '일반'} ·{' '}
                서울시 안내(생성 시각 기준): {estimate.statusMessage}
              </small>
            </li>
          ))}
        </ol>
      ) : (
        <span className="bus-arrival-unavailable">
          {STATUS_MESSAGES[arrival.status]}
        </span>
      )}
      <small>
        마지막 조회 {formatFetchedAt(arrival.fetchedAt)} · 서울시 지하철 실시간
      </small>
      {arrival.estimates[0] !== undefined && (
        <small>데이터 생성 {formatFetchedAt(arrival.estimates[0].generatedAt)}</small>
      )}
      {isStale && (
        <small className="bus-arrival-stale">
          서울시 데이터 생성 후 2분 이상 지나 최신 정보가 아닐 수 있습니다.
        </small>
      )}
    </section>
  )
}
