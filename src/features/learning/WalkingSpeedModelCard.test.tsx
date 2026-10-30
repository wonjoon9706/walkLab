import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PersonalWalkingSummary } from '../../domain/movementAnalysis'
import { WalkingSpeedModelCard } from './WalkingSpeedModelCard'

describe('WalkingSpeedModelCard', () => {
  it('기록이 없으면 학습 부족과 예시 시간 미계산을 명확히 표시한다', () => {
    const summary: PersonalWalkingSummary = {
      totalSessionCount: 0,
      eligibleSessionCount: 0,
      excludedSessionCount: 0,
      totalDistanceM: 0,
      averageMovingSpeedMps: null,
      hasEnoughSamples: false,
      comparisons: [],
    }

    render(<WalkingSpeedModelCard summary={summary} />)

    expect(screen.getByRole('heading', { name: '개인 보행속도 추정' })).toBeInTheDocument()
    expect(screen.getByText(/최소 3개가 필요합니다/)).toBeInTheDocument()
    expect(screen.getByText(/실제 경로 예측이 아닙니다/)).toBeInTheDocument()
    expect(screen.getByText(/정확도 비교를 표시하지 않습니다/)).toBeInTheDocument()
  })
})
