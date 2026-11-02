import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PersonalWalkingSummary } from '../domain/movementAnalysis'
import { useAuth } from '../features/auth/authContext'
import { WalkingSpeedModelCard } from '../features/learning/WalkingSpeedModelCard'
import { useSync } from '../features/sync/syncContext'
import { analyzePersonalWalkingHistory } from '../services/analysis/personalWalkingStats'
import { walkHistoryService } from '../services/history/walkHistoryService'
import { trainWalkingSpeedModel } from '../services/learning/walkingSpeedModel'
import { formatDistance, formatDuration, formatSpeed } from '../utils/format'

export function WalkingAnalysisPage() {
  const { user } = useAuth()
  const { lastSyncedAt } = useSync()
  const [summary, setSummary] = useState<PersonalWalkingSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const model = useMemo(
    () => (summary === null ? null : trainWalkingSpeedModel(summary.comparisons)),
    [summary],
  )
  const recentSpeedChangeMps = useMemo(() => {
    if (summary === null) return null
    const recent = summary.comparisons
      .filter(
        (item) =>
          item.eligible && item.movement.movingAverageSpeedMps !== null,
      )
      .sort(
        (first, second) =>
          Date.parse(second.startedAt) - Date.parse(first.startedAt),
      )
      .slice(0, 2)
    if (recent.length < 2) return null
    return (
      (recent[0].movement.movingAverageSpeedMps ?? 0) -
      (recent[1].movement.movingAverageSpeedMps ?? 0)
    )
  }, [summary])

  useEffect(() => {
    let isCurrent = true

    async function loadSummary() {
      if (user === null) return
      setIsLoading(true)
      setErrorMessage(null)
      try {
        const sessions = await walkHistoryService.listCompletedSessions(user.id)
        const nextSummary = await analyzePersonalWalkingHistory(
          user.id,
          sessions,
          walkHistoryService,
        )
        if (isCurrent) setSummary(nextSummary)
      } catch {
        if (isCurrent) {
          setErrorMessage('보행 분석을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
        }
      } finally {
        if (isCurrent) setIsLoading(false)
      }
    }

    void loadSummary()
    return () => {
      isCurrent = false
    }
  }, [lastSyncedAt, user])

  return (
    <main className="page-shell">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">내 보행 기록</p>
          <h1>나의 보행 분석</h1>
        </div>
        <Link className="link-button secondary-button" to="/history">
          기록 목록
        </Link>
      </div>

      {isLoading && <p className="status-card" role="status">분석을 불러오는 중입니다.</p>}
      {errorMessage !== null && (
        <p className="auth-message error-message" role="alert">{errorMessage}</p>
      )}
      {!isLoading && summary !== null && model !== null && (
        <>
          <section className="status-card analysis-highlight" aria-labelledby="analysis-summary-title">
            <h2 id="analysis-summary-title">현재 보행 특성</h2>
            <p className="hero-metric">{formatSpeed(model.estimatedSpeedMps)}</p>
            <p className="page-description">최근 기록을 반영한 개인 추정 보행속도</p>
            <dl className="measurement-grid detail-metrics">
              <div><dt>유효 학습 기록</dt><dd>{model.validSessionCount}개</dd></div>
              <div><dt>전체 완료 기록</dt><dd>{summary.totalSessionCount}개</dd></div>
              <div><dt>분석 가능 거리</dt><dd>{formatDistance(summary.totalDistanceM)}</dd></div>
              <div><dt>1km 예상시간</dt><dd>{formatDuration(model.estimatedOneKilometerSeconds)}</dd></div>
              <div>
                <dt>최근 기록 변화</dt>
                <dd>
                  {recentSpeedChangeMps === null
                    ? '비교할 기록 부족'
                    : `${recentSpeedChangeMps >= 0 ? '+' : ''}${(recentSpeedChangeMps * 3.6).toFixed(2)} km/h`}
                </dd>
              </div>
            </dl>
            <p className={`auth-message ${model.status === 'ready' ? 'success-message' : 'warning-card'}`}>
              {model.status === 'ready'
                ? '충분한 최근 기록을 바탕으로 계산한 개인 추정값입니다.'
                : '학습 기록이 부족해 현재 값은 참고용 추정입니다.'}
            </p>
          </section>

          <details className="status-card detail-disclosure">
            <summary>상세 분석 보기</summary>
            <WalkingSpeedModelCard summary={summary} />
          </details>
        </>
      )}
    </main>
  )
}
