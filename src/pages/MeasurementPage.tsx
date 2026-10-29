import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../features/auth/authContext'
import { useMeasurement } from '../features/measurement/measurementContext'
import { getAuthErrorMessage } from '../services/auth/authErrorMessage'
import { useSync } from '../features/sync/syncContext'

const statusLabels = {
  idle: '대기',
  starting: '시작 중',
  recording: '측정 중',
  completed: '완료',
  interrupted: '중단됨',
  error: '오류',
} as const

const gpsStatusLabels = {
  idle: '대기',
  waiting: '첫 위치 대기 중',
  receiving: '위치 수신 중',
  error: '수신 오류',
  stopped: '중지됨',
} as const

const localStatusLabels = {
  idle: '대기',
  saving: '저장 중',
  saved: '저장됨',
  failed: '저장 실패',
} as const

const syncStatusLabels = {
  idle: '대기',
  syncing: '동기화 중',
  synced: '동기화 완료',
  partial: '일부 대기',
  auth_required: '로그인 필요',
  offline: '오프라인',
  error: '동기화 오류',
} as const

function formatElapsedTime(startedAt: string | null, endTime: number): string {
  if (startedAt === null) {
    return '00:00:00'
  }

  const elapsedSeconds = Math.max(
    0,
    Math.floor((endTime - new Date(startedAt).getTime()) / 1000),
  )
  const hours = Math.floor(elapsedSeconds / 3600)
  const minutes = Math.floor((elapsedSeconds % 3600) / 60)
  const seconds = elapsedSeconds % 60

  return [hours, minutes, seconds]
    .map((value) => value.toString().padStart(2, '0'))
    .join(':')
}

export function MeasurementPage() {
  const { status: authStatus, user, signOut } = useAuth()
  const measurement = useMeasurement()
  const sync = useSync()
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!measurement.isActive) {
      return
    }

    const timerId = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timerId)
  }, [measurement.isActive])

  async function handleSignOut() {
    setSignOutError(null)

    if (measurement.isActive) {
      setSignOutError('측정 종료 버튼을 누른 뒤 로그아웃해 주세요.')
      return
    }

    try {
      await signOut()
    } catch (error) {
      setSignOutError(getAuthErrorMessage(error, 'signOut'))
    }
  }

  async function handleStart() {
    setNow(Date.now())
    await measurement.startMeasurement()
  }

  const elapsedEndTime =
    measurement.endedAt === null
      ? now
      : new Date(measurement.endedAt).getTime()

  return (
    <main className="page-shell measurement-page">
      <p className="eyebrow">WalkLab</p>
      <h1>측정 홈</h1>
      <p className="page-description">
        측정하는 동안 Safari 화면을 켜 두세요. 화면 잠금이나 다른 앱 전환 중에는
        GPS 수집이 계속된다고 보장할 수 없습니다.
      </p>

      <section
        className="status-card measurement-summary"
        aria-labelledby="measurement-title"
      >
        <h2 id="measurement-title">현재 측정</h2>
        <p className="measurement-state" aria-live="polite">
          {statusLabels[measurement.status]}
        </p>
        <dl className="measurement-grid">
          <div>
            <dt>경과 시간</dt>
            <dd>{formatElapsedTime(measurement.startedAt, elapsedEndTime)}</dd>
          </div>
          <div>
            <dt>저장 지점</dt>
            <dd>{measurement.savedPointCount}개</dd>
          </div>
          <div>
            <dt>GPS</dt>
            <dd>{gpsStatusLabels[measurement.gpsStatus]}</dd>
          </div>
          <div>
            <dt>로컬 저장</dt>
            <dd>{localStatusLabels[measurement.localSaveStatus]}</dd>
          </div>
          <div>
            <dt>네트워크</dt>
            <dd>{measurement.networkOnline ? '온라인' : '오프라인'}</dd>
          </div>
          <div>
            <dt>저장 실패</dt>
            <dd>{measurement.failedSaveCount}건</dd>
          </div>
        </dl>

        {measurement.message !== null && (
          <p
            className={`auth-message ${
              measurement.status === 'error' ||
              measurement.localSaveStatus === 'failed'
                ? 'error-message'
                : 'success-message'
            }`}
            role="status"
          >
            {measurement.message}
          </p>
        )}

        {authStatus !== 'authenticated' && measurement.isActive && (
          <p className="auth-message error-message" role="alert">
            로그인 세션이 만료됐지만 GPS와 로컬 저장은 계속됩니다. 측정을 종료한 뒤
            다시 로그인해 주세요.
          </p>
        )}

        <div className="button-row measurement-actions">
          {!measurement.isActive ? (
            <button type="button" onClick={handleStart}>
              측정 시작
            </button>
          ) : (
            <button type="button" onClick={measurement.stopMeasurement}>
              측정 종료
            </button>
          )}
        </div>
      </section>

      {import.meta.env.DEV && (
        <section className="status-card" aria-labelledby="diagnostic-title">
          <h2 id="diagnostic-title">개발용 로컬 진단</h2>
          <p>
            세션: {measurement.sessionId?.slice(0, 8) ?? '없음'} · sequence:{' '}
            {measurement.firstSavedSequenceNo ?? '-'}~
            {measurement.lastSavedSequenceNo ?? '-'}
          </p>
          <p>마지막 수신: {measurement.lastReceivedAt ?? '없음'}</p>
          <p>선택 GPS 필드의 null 누계: {measurement.nullOptionalFieldCount}개</p>
        </section>
      )}

      <section className="status-card" aria-labelledby="sync-title">
        <h2 id="sync-title">서버 동기화</h2>
        <p className="measurement-state">{syncStatusLabels[sync.status]}</p>
        <p>
          전송 대기 {sync.pendingCount}건 · 서버 확인 {sync.confirmedCount}건 · 문제{' '}
          {sync.failedCount}건
        </p>
        {sync.lastSyncedAt !== null && <p>마지막 확인: {sync.lastSyncedAt}</p>}
        {sync.message !== null && <p className="page-description">{sync.message}</p>}
      </section>

      <section
        className="status-card warning-card"
        aria-labelledby="storage-warning-title"
      >
        <h2 id="storage-warning-title">측정 전 확인</h2>
        <ul>
          <li>위치 권한은 측정 시작 버튼을 누를 때만 요청합니다.</li>
          <li>정지하거나 GPS가 흔들려도 측정은 자동 종료하지 않습니다.</li>
          <li>
            Safari 사이트 데이터 삭제나 저장공간 회수 시 미전송 기록이 사라질 수
            있습니다.
          </li>
        </ul>
      </section>

      <section className="status-card" aria-labelledby="account-title">
        <h2 id="account-title">로그인 계정</h2>
        <p>사용자 ID: {user?.id ?? '로그인 세션 만료'}</p>
        <div className="button-row">
          {measurement.isActive ? (
            <span className="disabled-link" aria-disabled="true">
              기록 목록
            </span>
          ) : (
            <Link className="link-button" to="/history">
              기록 목록
            </Link>
          )}
          <button
            className="secondary-button"
            type="button"
            onClick={handleSignOut}
          >
            로그아웃
          </button>
        </div>
        {signOutError !== null && (
          <p className="auth-message error-message" role="alert">
            {signOutError}
          </p>
        )}
      </section>
    </main>
  )
}
