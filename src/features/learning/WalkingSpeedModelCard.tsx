import { useMemo } from 'react'
import type { PersonalWalkingSummary } from '../../domain/movementAnalysis'
import type { LearningExclusionReason } from '../../domain/walkingSpeedModel'
import {
  backtestWalkingSpeedModel,
  trainWalkingSpeedModel,
} from '../../services/learning/walkingSpeedModel'
import {
  formatDuration,
  formatKoreanDateTime,
  formatSpeed,
} from '../../utils/format'

interface WalkingSpeedModelCardProps {
  summary: PersonalWalkingSummary
}

const reasonLabels: Record<LearningExclusionReason, string> = {
  too_short: '측정시간 부족',
  too_little_distance: '이동거리 부족',
  too_few_points: 'GPS 지점 부족',
  low_quality: 'GPS 품질 부족',
  outside_learning_window: '최근 90일 이전 기록',
  outside_selected_window: '최근 30일 기록이 충분해 기본 범위에서 제외',
  missing_moving_speed: '이동 중 속도 계산 불가',
  future_session: '계산 시점 이후 기록',
  manually_excluded: '사용자 제외 기록',
}

function formatError(errorMps: number | null): string {
  return errorMps === null
    ? '평가할 수 없음'
    : `${(errorMps * 3.6).toFixed(2)} km/h`
}

export function WalkingSpeedModelCard({
  summary,
}: WalkingSpeedModelCardProps) {
  const { model, backtest } = useMemo(
    () => ({
      model: trainWalkingSpeedModel(summary.comparisons),
      backtest: backtestWalkingSpeedModel(summary.comparisons),
    }),
    [summary],
  )

  return (
    <section className="status-card" aria-labelledby="walking-model-title">
      <h2 id="walking-model-title">개인 보행속도 추정</h2>
      <p className="page-description">
        세션별 이동 중 평균속도를 하나의 학습 사례로 사용합니다. 최근 기록에
        더 높은 가중치를 주지만 세션 길이는 가중치에 반영하지 않습니다.
      </p>
      <dl className="measurement-grid detail-metrics">
        <div>
          <dt>현재 개인 추정속도</dt>
          <dd>{formatSpeed(model.estimatedSpeedMps)}</dd>
        </div>
        <div>
          <dt>단순 평균속도</dt>
          <dd>{formatSpeed(model.simpleAverageSpeedMps)}</dd>
        </div>
        <div>
          <dt>유효 세션</dt>
          <dd>{model.validSessionCount}개</dd>
        </div>
        <div>
          <dt>학습 검색 범위</dt>
          <dd>최근 {model.windowDays}일</dd>
        </div>
        <div>
          <dt>사용 기록 기간</dt>
          <dd>
            {model.trainingPeriodStart === null || model.trainingPeriodEnd === null
              ? '사용 기록 없음'
              : `${formatKoreanDateTime(model.trainingPeriodStart)} ~ ${formatKoreanDateTime(model.trainingPeriodEnd)}`}
          </dd>
        </div>
        <div>
          <dt>마지막 갱신 기록</dt>
          <dd>{model.lastUpdatedAt === null ? '없음' : formatKoreanDateTime(model.lastUpdatedAt)}</dd>
        </div>
        <div>
          <dt>1km 예상시간 예시</dt>
          <dd>{formatDuration(model.estimatedOneKilometerSeconds)}</dd>
        </div>
      </dl>

      <p className={`auth-message ${model.status === 'ready' ? 'success-message' : 'warning-card'}`}>
        {model.status === 'ready'
          ? `${model.validSessionCount}개 세션으로 계산한 기초 개인화 추정값입니다.`
          : `유효 세션이 ${model.validSessionCount}개여서 참고용 계산값만 표시합니다. 최소 3개가 필요합니다.`}
        {' '}1km 시간은 현재 추정속도를 적용한 예시이며 실제 경로 예측이 아닙니다.
      </p>

      <h3>학습 기록</h3>
      <ul className="comparison-list" aria-label="개인 보행속도 학습 기록">
        {model.decisions.map((decision) => (
          <li key={decision.sessionId}>
            <strong>{formatKoreanDateTime(decision.startedAt)}</strong>
            <span>{formatSpeed(decision.movingAverageSpeedMps)}</span>
            <span className={decision.included ? 'eligible-label' : 'excluded-label'}>
              {decision.included
                ? `학습 포함 · 가중치 ${((decision.weight ?? 0) * 100).toFixed(1)}%`
                : decision.exclusionReasons.map((reason) => reasonLabels[reason]).join(', ')}
            </span>
          </li>
        ))}
      </ul>

      <div className="model-evaluation">
        <h3>시간순 백테스트</h3>
        <p className="page-description">
          각 기록을 예측할 때 그보다 이전 기록만 사용합니다. 평가 대상은{' '}
          {backtest.evaluationSessionCount}개입니다.
        </p>
        {backtest.status === 'ready' ? (
          <dl className="measurement-grid detail-metrics">
            <div>
              <dt>단순 평균 절대오차</dt>
              <dd>{formatError(backtest.simpleMeanAbsoluteErrorMps)}</dd>
            </div>
            <div>
              <dt>최근 가중 모델 절대오차</dt>
              <dd>{formatError(backtest.weightedMeanAbsoluteErrorMps)}</dd>
            </div>
          </dl>
        ) : (
          <p className="auth-message warning-card">
            최소 3개의 과거 학습 세션과 2개의 이후 평가 세션이 필요해 아직
            정확도 비교를 표시하지 않습니다.
          </p>
        )}
      </div>
      <p className="analysis-version">모델 기준: {model.algorithmVersion}</p>
    </section>
  )
}
