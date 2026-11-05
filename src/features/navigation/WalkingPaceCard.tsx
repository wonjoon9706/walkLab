import type { LiveNavigationState } from '../../domain/liveNavigation'
import { formatDistance, formatDuration, formatKoreanArrivalTime } from '../../utils/format'

export function WalkingPaceCard({ navigation, reference = navigation.isReferenceRoute }: {
  navigation: LiveNavigationState
  reference?: boolean
}) {
  const unavailable = ['stale', 'off_route', 'rerouting', 'error', 'starting', 'gps_unstable'].includes(navigation.status)
  const speed = unavailable ? null : navigation.recentSpeedMps
  const baseline = navigation.baselineSpeed
  const movingPace = !unavailable && navigation.status === 'moving' && speed !== null
  const pace = movingPace ? navigation.pace : 'checking'
  const comparisonLabel = baseline?.source === 'default' ? '기본속도' : '평소'
  const label = navigation.status === 'stationary' ? '잠시 멈춰 있어요'
    : pace === 'similar' ? `${comparisonLabel}와 비슷함`
      : pace === 'slower' ? `${comparisonLabel}보다 조금 느림`
        : pace === 'faster' ? `${comparisonLabel}보다 빠름` : '속도 확인 중'
  const hasEta = !['stale', 'off_route', 'rerouting', 'error'].includes(navigation.status)
    && navigation.remainingDurationSeconds !== null
  const message = navigation.status === 'stale' ? '위치 수신이 중단되었습니다. 화면을 켠 채 새 GPS를 기다려 주세요.'
    : navigation.status === 'off_route' || navigation.status === 'rerouting' ? '경로 연결을 확인하고 있어요. 현재 도착시간은 안내하지 않습니다.'
      : navigation.status === 'stationary' ? '정지시간은 느린 보행으로 판단하지 않습니다. 다시 걸을 때의 참고시간입니다.'
        : !movingPace ? '현재 위치와 속도를 확인하고 있어요.'
          : baseline?.source !== 'personalized' ? '기본 보행속도와 현재 페이스로 남은 시간을 계산합니다.'
            : pace === 'slower' ? '평소보다 조금 느리게 걷고 있어요. 안전한 속도를 유지해 주세요.'
              : pace === 'faster' ? '평소보다 빠르게 걷고 있어요. 주변을 살피며 이동해 주세요.' : '평소와 비슷한 속도로 걷고 있어요.'
  return (
    <section className="walking-pace-card" aria-label="실시간 도보 페이스">
      <div className="walking-pace-heading"><strong>도보 이동 안내</strong><small>현재 도보 구간</small></div>
      <dl className="walking-pace-grid">
        <div><dt>현재 보행속도</dt><dd>{speed === null ? '속도 확인 중' : `${(speed * 3.6).toFixed(1)} km/h`}</dd></div>
        <div><dt>{baseline?.source === 'personalized' ? '평소 보행속도 (G7)' : '기본 보행속도'}</dt>
          <dd>{baseline == null ? '확인 중' : `${(baseline.speedMps * 3.6).toFixed(1)} km/h`}</dd></div>
        <div><dt>남은 도보 예상시간</dt><dd className="walking-pace-eta">{hasEta ? formatDuration(navigation.remainingDurationSeconds) : '확인 중'}</dd></div>
        <div><dt>남은 도보 거리</dt><dd>{navigation.remainingDistanceM === null || !hasEta ? '확인 중' : formatDistance(navigation.remainingDistanceM)}</dd></div>
      </dl>
      <p className="walking-pace-status" role="status">{baseline?.source === 'default' && movingPace ? '기본속도 기준 · ' : ''}{label}</p>
      <p>{message}</p>
      {hasEta && navigation.arrivalAt !== null && <small>도보 도착 예상 {formatKoreanArrivalTime(navigation.arrivalAt, navigation.lastPositionAt === null ? new Date() : new Date(navigation.lastPositionAt))} · {navigation.speedSource === 'recent_blended' ? '현재 페이스와 평소·기본 속도를 함께 반영' : '평소·기본 속도 기준'}</small>}
      <small>신호 대기·역사 내부 이동시간은 포함하지 않은 참고값입니다.{reference ? ' 일부 도보 연결은 미확인입니다.' : ''}</small>
    </section>
  )
}
