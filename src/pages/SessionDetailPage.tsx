import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { WalkAnalysis, WalkSessionDetail } from '../domain/history'
import type { MovementAnalysis } from '../domain/movementAnalysis'
import { useAuth } from '../features/auth/authContext'
import { SpeedTimelineChart } from '../features/analysis/SpeedTimelineChart'
import { walkHistoryService } from '../services/history/walkHistoryService'
import { analyzeMovement } from '../services/analysis/movementAnalysis'
import {
  formatDistance,
  formatDuration,
  formatKoreanDateTime,
  formatPace,
  formatSpeed,
} from '../utils/format'
import { reportDevelopmentError } from '../utils/developmentError'

interface LoadedSession {
  detail: WalkSessionDetail
  analysis: WalkAnalysis
  movement: MovementAnalysis
  savedLocally: boolean
  savedOnServer: boolean
}

const SessionRouteMap = lazy(async () => {
  const module = await import('../features/map/SessionRouteMap')
  return { default: module.SessionRouteMap }
})

export function SessionDetailPage() {
  const { sessionId } = useParams()
  const { user } = useAuth()
  const [loadedSession, setLoadedSession] = useState<LoadedSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let isCurrent = true

    async function loadSession() {
      if (user === null || sessionId === undefined) {
        if (isCurrent) {
          setNotFound(true)
          setIsLoading(false)
        }
        return
      }

      setIsLoading(true)
      setErrorMessage(null)
      try {
        const detail = await walkHistoryService.getSessionDetail(user.id, sessionId)
        if (detail === null) {
          if (isCurrent) setNotFound(true)
          return
        }

        const result = await walkHistoryService.analyzeAndSave(user.id, detail)
        const movement = analyzeMovement(
          detail.session,
          detail.points,
          result.analysis,
        )
        if (isCurrent) setLoadedSession({ detail, movement, ...result })
      } catch (error) {
        reportDevelopmentError('session detail load failed', error)
        if (isCurrent) {
          setErrorMessage('기록 상세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
        }
      } finally {
        if (isCurrent) setIsLoading(false)
      }
    }

    void loadSession()
    return () => {
      isCurrent = false
    }
  }, [sessionId, user])

  const session = loadedSession?.detail.session
  const metrics = loadedSession?.analysis.metrics

  return (
    <main className="page-shell session-detail-page">
      <p className="eyebrow">WalkLab</p>
      <h1>기록 상세</h1>
      {sessionId !== undefined && <p className="session-identifier">세션 ID: {sessionId}</p>}

      {isLoading && <p className="status-card" role="status">기록을 분석하는 중입니다.</p>}
      {errorMessage !== null && (
        <p className="auth-message error-message" role="alert">{errorMessage}</p>
      )}
      {!isLoading && notFound && errorMessage === null && (
        <section className="status-card">
          <h2>기록을 찾을 수 없습니다</h2>
          <p>완료된 본인 기록인지 확인해 주세요.</p>
        </section>
      )}

      {session !== undefined && metrics !== undefined && loadedSession !== null && (
        <>
          <section className="status-card" aria-labelledby="summary-title">
            <h2 id="summary-title">보행 요약</h2>
            <p className="page-description">
              평균 속도는 품질 기준을 통과한 이동거리와 전체 측정시간으로
              계산합니다. 멈춰 있던 시간도 전체 측정시간에 포함됩니다.
            </p>
            <dl className="measurement-grid detail-metrics">
              <div><dt>시작</dt><dd>{formatKoreanDateTime(session.startedAt)}</dd></div>
              <div><dt>종료</dt><dd>{session.endedAt === null ? '종료 정보 없음' : formatKoreanDateTime(session.endedAt)}</dd></div>
              <div><dt>전체 측정시간</dt><dd>{formatDuration(metrics.durationSeconds)}</dd></div>
              <div><dt>유효 이동거리</dt><dd>{formatDistance(metrics.filteredDistanceM)}</dd></div>
              <div><dt>원본 이동거리</dt><dd>{formatDistance(metrics.rawDistanceM)}</dd></div>
              <div><dt>평균 속도</dt><dd>{formatSpeed(metrics.averageSpeedMps)}</dd></div>
              <div><dt>평균 페이스</dt><dd>{formatPace(metrics.paceSecondsPerKm)}</dd></div>
              <div><dt>GPS 지점</dt><dd>{metrics.rawPointCount.toLocaleString('ko-KR')}개</dd></div>
              <div><dt>품질 통과 지점</dt><dd>{metrics.filteredPointCount.toLocaleString('ko-KR')}개</dd></div>
              <div><dt>고도 표본</dt><dd>{metrics.altitudeSampleCount.toLocaleString('ko-KR')}개</dd></div>
              <div>
                <dt>고도 범위</dt>
                <dd>
                  {metrics.altitudeMinM === null || metrics.altitudeMaxM === null
                    ? '계산할 수 없음'
                    : `${metrics.altitudeMinM.toFixed(1)}~${metrics.altitudeMaxM.toFixed(1)} m`}
                </dd>
              </div>
              <div><dt>측정 상태</dt><dd>완료</dd></div>
              <div>
                <dt>서버 동기화</dt>
                <dd>{loadedSession.detail.existsOnServer ? '서버 기록 확인됨' : '로컬 기록'}</dd>
              </div>
            </dl>
            <p className="analysis-version">
              분석 기준: {metrics.algorithmVersion} / {metrics.qualityAlgorithmVersion}
            </p>
            {loadedSession.detail.existsLocally && !loadedSession.savedLocally && (
              <p className="auth-message error-message" role="status">
                로컬 분석 결과를 저장하지 못했지만 이 화면의 계산 결과는 확인할 수 있습니다.
              </p>
            )}
            {loadedSession.detail.existsOnServer && !loadedSession.savedOnServer && (
              <p className="auth-message error-message" role="status">
                분석 결과를 서버에 저장하지 못했지만 이 화면의 계산 결과는 확인할 수 있습니다.
              </p>
            )}
          </section>

          <section className="status-card" aria-labelledby="movement-title">
            <h2 id="movement-title">이동·정지 구간 분석</h2>
            <p className="page-description">
              품질 기준을 통과한 GPS 구간의 속도를 주변 5개 구간 중앙값으로
              완화해 분류합니다. 10초를 넘는 수신 공백은 정지로 단정하지 않고
              판정 불가 시간에 포함합니다.
            </p>
            <dl className="measurement-grid detail-metrics">
              <div><dt>이동 시간</dt><dd>{formatDuration(loadedSession.movement.movingDurationSeconds)}</dd></div>
              <div><dt>정지 시간</dt><dd>{formatDuration(loadedSession.movement.stationaryDurationSeconds)}</dd></div>
              <div><dt>판정 불가</dt><dd>{formatDuration(loadedSession.movement.uncertainDurationSeconds)}</dd></div>
              <div><dt>이동 중 평균속도</dt><dd>{formatSpeed(loadedSession.movement.movingAverageSpeedMps)}</dd></div>
            </dl>
            <SpeedTimelineChart movement={loadedSession.movement} />
            <p className="analysis-version">
              구간 기준: {loadedSession.movement.algorithmVersion} · 정지 ≤ 0.35 m/s · 이동 ≥ 0.7 m/s
            </p>
          </section>

          <section className="status-card map-card" aria-labelledby="map-title">
            <h2 id="map-title">GPS 이동 경로</h2>
            <Suspense fallback={<p role="status">지도를 준비하는 중입니다.</p>}>
              <SessionRouteMap
                rawPoints={loadedSession.detail.points}
                filteredPoints={loadedSession.analysis.filteredPoints}
              />
            </Suspense>
          </section>
        </>
      )}

      <div className="button-row">
        <Link className="link-button secondary-button" to="/history">기록 목록으로</Link>
      </div>
    </main>
  )
}
