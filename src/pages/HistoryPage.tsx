import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { WalkHistoryItem } from '../domain/history'
import type {
  AnalysisExclusionReason,
  PersonalWalkingSummary,
} from '../domain/movementAnalysis'
import { useAuth } from '../features/auth/authContext'
import { useSync } from '../features/sync/syncContext'
import { WalkingSpeedModelCard } from '../features/learning/WalkingSpeedModelCard'
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
      <p className="eyebrow">WalkLab</p>
      <h1>기록 목록</h1>
      <p className="page-description">
        완료된 보행 기록을 최근 측정 순서로 표시합니다. 화면의 시간은 한국
        시간(Asia/Seoul)입니다.
      </p>

      {isLoading && <p className="status-card" role="status">기록을 불러오는 중입니다.</p>}
      {errorMessage !== null && (
        <p className="auth-message error-message" role="alert">{errorMessage}</p>
      )}
      {!isLoading && errorMessage === null && records.length === 0 && (
        <section className="status-card empty-history">
          <h2>아직 완료된 기록이 없습니다</h2>
          <p>측정 홈에서 첫 보행을 측정하면 여기에 표시됩니다.</p>
        </section>
      )}
      {!isLoading && records.length > 0 && (
        <>
          <section className="status-card" aria-labelledby="personal-stats-title">
            <h2 id="personal-stats-title">개인 보행 기초 통계</h2>
            {isSummaryLoading && <p role="status">기록별 GPS를 분석하는 중입니다.</p>}
            {summaryError !== null && <p className="auth-message error-message">{summaryError}</p>}
            {personalSummary !== null && (
              <>
                <dl className="measurement-grid detail-metrics">
                  <div><dt>완료한 측정</dt><dd>{personalSummary.totalSessionCount}회</dd></div>
                  <div><dt>분석 대상</dt><dd>{personalSummary.eligibleSessionCount}회</dd></div>
                  <div><dt>별도 구분</dt><dd>{personalSummary.excludedSessionCount}회</dd></div>
                  <div><dt>대상 총거리</dt><dd>{formatDistance(personalSummary.totalDistanceM)}</dd></div>
                  <div><dt>이동 중 평균속도</dt><dd>{formatSpeed(personalSummary.averageMovingSpeedMps)}</dd></div>
                </dl>
                <p className={personalSummary.hasEnoughSamples ? 'success-message auth-message' : 'warning-card auth-message'}>
                  {personalSummary.hasEnoughSamples
                    ? `분석 가능한 기록 ${personalSummary.eligibleSessionCount}개를 비교한 기초 통계입니다.`
                    : `분석 가능한 기록이 ${personalSummary.eligibleSessionCount}개입니다. 비교 기준인 3개보다 적어 개인 특성을 판단하기에는 부족합니다.`}
                  {' '}이 단계에서는 머신러닝 학습을 수행하지 않습니다.
                </p>
                <ul className="comparison-list" aria-label="보행 기록 비교">
                  {personalSummary.comparisons.map((comparison) => (
                    <li key={comparison.sessionId}>
                      <strong>{formatKoreanDateTime(comparison.startedAt)}</strong>
                      <span>{formatDistance(comparison.metrics.filteredDistanceM)} · {formatDuration(comparison.metrics.durationSeconds)} · 전체 평균 {formatSpeed(comparison.metrics.averageSpeedMps)}</span>
                      <span className={comparison.eligible ? 'eligible-label' : 'excluded-label'}>
                        {comparison.eligible
                          ? '분석 대상'
                          : comparison.exclusionReasons.map((reason) => exclusionReasonLabels[reason]).join(', ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {personalSummary !== null && (
            <WalkingSpeedModelCard summary={personalSummary} />
          )}

          <ol className="history-list" aria-label="완료된 보행 기록">
          {records.map((record) => (
            <li key={record.id}>
              <Link className="history-card" to={`/sessions/${record.id}`}>
                <strong>{formatKoreanDateTime(record.startedAt)}</strong>
                <span>측정 시간 {formatDuration(record.durationSeconds)}</span>
                <span>GPS 저장 지점 {record.pointCount.toLocaleString('ko-KR')}개</span>
              </Link>
            </li>
          ))}
          </ol>
        </>
      )}

      <div className="button-row">
        <Link className="link-button secondary-button" to="/">측정 홈으로</Link>
      </div>
    </main>
  )
}
