import type { TransitLegBoardingAssessment } from '../../domain/transitBoarding'
import { formatDuration } from '../../utils/format'

const STATUS_LABELS: Readonly<Record<TransitLegBoardingAssessment['status'], string>> = {
  likely: '탑승 가능성 높음',
  tight: '시간이 촉박함',
  unlikely: '탑승 어려움',
  unavailable: '확인 불가',
  requery_required: '환승 시 재조회 필요',
}

function formatMargin(seconds: number): string {
  return seconds >= 0
    ? `예상 여유 ${formatDuration(seconds)}`
    : `${formatDuration(Math.abs(seconds))} 부족`
}

export function TransitBoardingAssessment({
  assessment,
}: {
  assessment: TransitLegBoardingAssessment
}) {
  return (
    <section
      className={`transit-boarding-assessment status-${assessment.status}`}
      aria-label="교통편 탑승 가능성"
    >
      <strong>{STATUS_LABELS[assessment.status]}</strong>
      <span>
        정류장·역 입구까지 순수 보행 {formatDuration(assessment.accessDurationSeconds)}
      </span>
      {assessment.candidates.length > 0 && (
        <ul>
          {assessment.candidates.map((candidate) => (
            <li key={candidate.order}>
              <span>
                {candidate.order}번째
                {candidate.destination === null ? ' 차량' : ` ${candidate.destination}행`}
              </span>
              <b>
                {assessment.mode === 'SUBWAY' ? '역 입구 기준 ' : ''}
                {formatMargin(candidate.marginSeconds)}
              </b>
            </li>
          ))}
        </ul>
      )}
      {assessment.platformAccess === 'unknown' && (
        <small>개찰구·승강장 접근시간 미확인 — 역 입구 기준만 표시</small>
      )}
      {assessment.mode === 'BUS' && (
        <small>판정 기준: 여유 2분 이상 높음 · 30초 이상 촉박</small>
      )}
      <small>{assessment.message}</small>
    </section>
  )
}
