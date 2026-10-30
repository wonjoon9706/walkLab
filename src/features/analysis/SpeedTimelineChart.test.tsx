import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MovementAnalysis } from '../../domain/movementAnalysis'
import { SpeedTimelineChart } from './SpeedTimelineChart'

describe('SpeedTimelineChart', () => {
  it('이동·정지·판정 불가 구간과 속도선을 표시한다', () => {
    const movement: MovementAnalysis = {
      algorithmVersion: 'movement-v1',
      qualityAlgorithmVersion: 'quality-v1',
      movingDurationSeconds: 10,
      stationaryDurationSeconds: 5,
      uncertainDurationSeconds: 5,
      movingDistanceM: 15,
      movingAverageSpeedMps: 1.5,
      segments: [
        { index: 0, startedAt: '2026-10-30T00:00:00.000Z', endedAt: '2026-10-30T00:00:10.000Z', durationSeconds: 10, distanceM: 15, speedMps: 1.5, state: 'moving' },
        { index: 1, startedAt: '2026-10-30T00:00:10.000Z', endedAt: '2026-10-30T00:00:15.000Z', durationSeconds: 5, distanceM: 0, speedMps: 0, state: 'stationary' },
        { index: 2, startedAt: '2026-10-30T00:00:15.000Z', endedAt: '2026-10-30T00:00:20.000Z', durationSeconds: 5, distanceM: 0, speedMps: null, state: 'uncertain' },
      ],
    }

    const { container } = render(<SpeedTimelineChart movement={movement} />)

    expect(screen.getByRole('img', { name: /측정 시간에 따른 구간별 속도/ })).toBeInTheDocument()
    expect(screen.getByText('이동')).toBeInTheDocument()
    expect(screen.getByText('정지')).toBeInTheDocument()
    expect(screen.getByText('판정 불가')).toBeInTheDocument()
    expect(container.querySelectorAll('rect')).toHaveLength(3)
    expect(container.querySelector('.speed-line')).toBeInTheDocument()
  })
})
