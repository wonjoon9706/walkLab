import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { WalkHistoryItem } from '../domain/history'
import type {
  AnalysisExclusionReason,
  PersonalWalkingSummary,
} from '../domain/movementAnalysis'
import { useAuth } from '../features/auth/authContext'
import { useSync } from '../features/sync/syncContext'
import { walkHistoryService } from '../services/history/walkHistoryService'
import { analyzePersonalWalkingHistory } from '../services/analysis/personalWalkingStats'
import {
  formatDistance,
  formatDuration,
  formatKoreanDateTime,
  formatSpeed,
} from '../utils/format'

const exclusionReasonLabels: Record<AnalysisExclusionReason, string> = {
  too_short: '측정시간 1분 미만',
  too_little_distance: '유효거리 100m 미만',
  too_few_points: 'GPS 지점 20개 미만',
  low_quality: '품질 통과 지점 70% 미만',
}

export function HistoryPage() {
  const { user } = useAuth()
  const { lastSyncedAt } = useSync()
  const [records, setRecords] = useState<WalkHistoryItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [personalSummary, setPersonalSummary] =
    useState<PersonalWalkingSummary | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [isSummaryLoading, setIsSummaryLoading] = useState(false)

  useEffect(() => {
    let isCurrent = true

    async function loadRecords() {
      if (user === null) return

      setIsLoading(true)
      setErrorMessage(null)
      setSummaryError(null)
      try {
        const completedSessions = await walkHistoryService.listCompletedSessions(user.id)
        if (isCurrent) {
          setRecords(completedSessions)
          setPersonalSummary(null)
          setIsLoading(false)
        }

        if (completedSessions.length > 0) {
          if (isCurrent) setIsSummaryLoading(true)
          try {
            const summary = await analyzePersonalWalkingHistory(
              user.id,
              completedSessions,
              walkHistoryService,
            )
            if (isCurrent) setPersonalSummary(summary)
          } catch {
            if (isCurrent) {
              setSummaryError('여러 기록의 기초 통계를 계산하지 못했습니다.')
            }
          } finally {
            if (isCurrent) setIsSummaryLoading(false)
          }
        }
      } catch {
        if (isCurrent) {
          setErrorMessage('기록을 불러오지 못했습니다. 네트워크 연결을 확인해 주세요.')
        }
      } finally {
        if (isCurrent) setIsLoading(false)
      }
    }

    void loadRecords()
    return () => {
      isCurrent = false
    }
  }, [lastSyncedAt, user])

  return (
    <main className="page-shell">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">WalkLab</p>
          <h1>내 보행 기록</h1>
        </div>
        <Link className="link-button secondary-button" to="/history/summary">
          요약 보기
        </Link>
      </div>

      {isLoading && <p className="status-card" role="status">기록을 불러오는 중입니다.</p>}
      {errorMessage !== null && (
        <p className="auth-message error-message" role="alert">{errorMessage}</p>
      )}
      {!isLoading && errorMessage === null && records.length === 0 && (
        <section className="status-card empty-history">
          <h2>아직 완료된 기록이 없습니다</h2>
          <p>길찾기 안내를 시작하면 보행 기록이 자동으로 저장됩니다.</p>
        </section>
      )}
      {!isLoading && records.length > 0 && (
        <>
          {isSummaryLoading && <p className="page-description" role="status">거리와 속도를 계산하는 중입니다.</p>}
          {summaryError !== null && <p className="auth-message error-message">{summaryError}</p>}

          <ol className="history-list" aria-label="완료된 보행 기록">
          {records.map((record) => {
            const comparison = personalSummary?.comparisons.find(
              (item) => item.sessionId === record.id,
            )
            return (
              <li key={record.id}>
                <Link className="history-card" to={`/sessions/${record.id}`}>
                  <strong>{formatKoreanDateTime(record.startedAt)}</strong>
                  <span>
                    {comparison === undefined
                      ? `소요시간 ${formatDuration(record.durationSeconds)}`
                      : `${formatDistance(comparison.metrics.filteredDistanceM)} · ${formatDuration(comparison.metrics.durationSeconds)} · ${formatSpeed(comparison.metrics.averageSpeedMps)}`}
                  </span>
                  <span className={comparison?.eligible === false ? 'excluded-label' : 'eligible-label'}>
                    {comparison === undefined
                      ? '분석 확인 중'
                      : comparison.eligible
                        ? '분석 가능'
                        : comparison.exclusionReasons
                            .map((reason) => exclusionReasonLabels[reason])
                            .join(', ')}
                  </span>
                </Link>
              </li>
            )
          })}
          </ol>
        </>
      )}

    </main>
  )
}
