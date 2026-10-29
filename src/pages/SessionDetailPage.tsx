import { useParams } from 'react-router-dom'

export function SessionDetailPage() {
  const { sessionId } = useParams()

  return (
    <main className="page-shell">
      <p className="eyebrow">WalkLab</p>
      <h1>기록 상세</h1>
      <p>세션 ID: {sessionId ?? '확인할 수 없음'}</p>
      <p>기록 요약과 지도는 G5와 G6에서 구현할 예정입니다.</p>
    </main>
  )
}
