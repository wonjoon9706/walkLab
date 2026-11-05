import type { TransitBoardingTarget } from '../../services/navigation/transitAccessArrival'
import type { TransitAccessRecordingState } from '../../services/navigation/transitAccessRecording'
import { formatDistance } from '../../utils/format'
import type { LiveNavigationState } from '../../domain/liveNavigation'
import { WalkingPaceCard } from '../navigation/WalkingPaceCard'

export function TransitAccessRecordingStatus({ state, target, active, onStart, onStop, canStart, navigation }: {
  state: TransitAccessRecordingState
  target: TransitBoardingTarget | null
  active: boolean
  canStart: boolean
  navigation?: LiveNavigationState
  onStart(): void
  onStop(): void
}) {
  const displayedTarget = active || state.phase === 'saved' ? state.target : target
  return (
    <section className="status-card" aria-label="첫 승차 도보 기록 안내">
      <h2>첫 승차 지점까지 도보 안내</h2>
      <p>{displayedTarget?.name ?? '탑승 지점 좌표 확인 필요'}</p>
      {displayedTarget === null && (
        <p className="warning-card">검증된 좌표가 없어 자동 도착 감지는 사용하지 않습니다. 도착하면 안내를 직접 종료해 주세요.</p>
      )}
      {displayedTarget?.mode === 'SUBWAY' && <small>역 출입구 도착 기준입니다. 승강장 도착이나 열차 탑승을 판정하지 않습니다.</small>}
      <p role="status">
        {state.phase === 'starting' ? '보행 기록과 GPS를 시작하고 있습니다.'
          : state.phase === 'recording' ? '안내 중 · GPS 보행 기록 수집 중'
            : state.phase === 'stopping' ? '기록 종료·로컬 저장 확인 중'
              : state.phase === 'saved' && state.savedPointCount > 0
                ? state.stopReason === 'arrival'
                  ? '탑승 지점에 도착했습니다. 도보 기록을 저장했습니다.'
                  : '안내를 종료하고 도보 기록을 저장했습니다.'
                : state.phase === 'error' ? '기록 상태 확인 필요' : '안내 시작 전에는 GPS 기록을 수집하지 않습니다.'}
      </p>
      {active && <p>탑승 지점까지 {state.distanceM === null ? '거리 확인 중' : `직선거리 약 ${formatDistance(state.distanceM)}`}</p>}
      {active && navigation?.isActive && <WalkingPaceCard navigation={navigation} reference={displayedTarget === null || navigation.isReferenceRoute} />}
      {active && !navigation?.isActive && <small>남은 도보 경로를 확인하지 못해 실시간 보행 ETA는 안내하지 않습니다. GPS 기록은 계속 저장합니다.</small>}
      {active && state.gps !== 'receiving' && <p className="warning-card">
        {state.gps === 'inaccurate' ? 'GPS 정확도가 부족하거나 위치가 불안정해 도착 판정을 보류합니다.'
          : state.gps === 'stale' || state.gps === 'waiting' ? '새 GPS 위치를 기다리고 있습니다. 도착 판정은 보류됩니다.'
            : state.gps === 'hidden' ? '화면이 숨겨져 도착 판정을 보류합니다.' : 'GPS 오류로 자동 도착 판정을 보류합니다.'}
      </p>}
      {state.message !== null && <p className="warning-card">{state.message}</p>}
      {state.phase === 'saved' && <p>
        이 기기에 GPS {state.savedPointCount}개 저장 확인 · {state.serverSync === 'confirmed' ? '해당 기록 서버 동기화 확인 완료' : '서버 동기화 대기 중'}
      </p>}
      <small>화면을 끄거나 Safari가 백그라운드에 있으면 GPS 수집이 중단될 수 있습니다.</small>
      {active ? (
        <button type="button" className="secondary-button" disabled={state.phase === 'stopping'} onClick={onStop}>안내 종료</button>
      ) : (
        <button type="button" className="primary-action" disabled={!canStart} onClick={onStart}>안내 시작</button>
      )}
    </section>
  )
}
