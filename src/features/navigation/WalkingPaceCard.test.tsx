import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LiveNavigationState } from '../../domain/liveNavigation'
import { WalkingPaceCard } from './WalkingPaceCard'

const state: LiveNavigationState = {
  status: 'moving', isActive: true, route: null, isReferenceRoute: false,
  currentPosition: null, currentAccuracyM: 5, remainingCoordinates: [],
  remainingDistanceM: 510, progressRatio: 0.5, recentSpeedMps: 1.3, appliedSpeedMps: 1.4,
  baselineSpeed: { speedMps: 1.5, source: 'personalized', modelVersion: 'recency-weighted-v1', validSessionCount: 5 },
  pace: 'slower', speedSource: 'recent_blended', remainingDurationSeconds: 380,
  arrivalAt: '2026-11-05T01:06:20Z', lastPositionAt: '2026-11-05T01:00:00Z', rerouteCount: 0, message: null,
}

describe('실시간 도보 페이스 카드', () => {
  it('실시간 속도와 G7 속도, 현재 도보 구간의 ETA를 함께 표시한다', () => {
    render(<WalkingPaceCard navigation={state} />)
    expect(screen.getByText('4.7 km/h')).toBeInTheDocument()
    expect(screen.getByText('5.4 km/h')).toBeInTheDocument()
    expect(screen.getByText('평소보다 조금 느림')).toBeInTheDocument()
    expect(screen.getByText('6분 20초')).toBeInTheDocument()
    expect(screen.getByText('510 m')).toBeInTheDocument()
  })
  it('미학습 기본속도를 평소 G7 결과로 표시하지 않는다', () => {
    render(<WalkingPaceCard navigation={{ ...state, baselineSpeed: { speedMps: 1.3, source: 'default', modelVersion: 'default-v1', validSessionCount: 0 }, pace: 'similar' }} />)
    expect(screen.getByText('기본 보행속도')).toBeInTheDocument()
    expect(screen.queryByText('평소 보행속도 (G7)')).not.toBeInTheDocument()
    expect(screen.getByText(/기본속도와 비슷함/)).toBeInTheDocument()
  })
  it.each(['stale', 'off_route', 'rerouting', 'error'] as const)('%s에서는 과거 속도와 ETA를 실시간 값처럼 표시하지 않는다', (status) => {
    render(<WalkingPaceCard navigation={{ ...state, status }} />)
    expect(screen.queryByText('4.7 km/h')).not.toBeInTheDocument()
    expect(screen.queryByText('6분 20초')).not.toBeInTheDocument()
    expect(screen.queryByText(/도보 도착 예상/)).not.toBeInTheDocument()
  })
  it('정지는 느린 페이스와 구분하고 참고 경로 연결 미확정을 보존한다', () => {
    render(<WalkingPaceCard navigation={{ ...state, status: 'stationary', recentSpeedMps: 0, pace: 'checking', isReferenceRoute: true }} />)
    expect(screen.getByText('잠시 멈춰 있어요')).toBeInTheDocument()
    expect(screen.queryByText('평소보다 조금 느림')).not.toBeInTheDocument()
    expect(screen.getByText(/일부 도보 연결은 미확인/)).toBeInTheDocument()
  })
})
