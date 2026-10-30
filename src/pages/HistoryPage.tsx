import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { WalkHistoryItem } from '../domain/history'
import { useAuth } from '../features/auth/authContext'
import { walkHistoryService } from '../services/history/walkHistoryService'
import { formatDuration, formatKoreanDateTime } from '../utils/format'

export function HistoryPage() {
  const { user } = useAuth()
  const [records, setRecords] = useState<WalkHistoryItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let isCurrent = true

    async function loadRecords() {
      if (user === null) return

      setIsLoading(true)
      setErrorMessage(null)
      try {
        const completedSessions = await walkHistoryService.listCompletedSessions(user.id)
        if (isCurrent) setRecords(completedSessions)
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
  }, [user])

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
      )}

      <div className="button-row">
        <Link className="link-button secondary-button" to="/">측정 홈으로</Link>
      </div>
    </main>
  )
}
