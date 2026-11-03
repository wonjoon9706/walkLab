import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TransitLegBoardingAssessment } from '../../domain/transitBoarding'
import { TransitBoardingAssessment } from './TransitBoardingAssessment'

const bus: TransitLegBoardingAssessment = {
  legIndex: 1, mode: 'BUS', status: 'likely', dataFreshness: 'fresh',
  accessDurationSeconds: 160, accessArrivalAt: '2026-11-03T07:02:40.000Z',
  platformAccess: 'not_required', selectedOrder: 1,
  candidates: [{
    order: 1, serviceArrivalAt: '2026-11-03T07:04:00.000Z',
    accessArrivalAt: '2026-11-03T07:02:40.000Z', marginSeconds: 80,
    likelihood: 'tight', destination: null,
  }],
  message: '탑승을 보장하지 않습니다.',
}

describe('탑승 가능성 UI', () => {
  it('순수 보행시간, 여유시간과 비보장 문구를 함께 표시한다', () => {
    render(<TransitBoardingAssessment assessment={bus} />)
    expect(screen.getByText('탑승 가능성 높음')).toBeInTheDocument()
    expect(screen.getByText(/순수 보행 2분 40초/)).toBeInTheDocument()
    expect(screen.getByText('예상 여유 1분 20초')).toBeInTheDocument()
    expect(screen.getByText(/탑승을 보장하지 않습니다/)).toBeInTheDocument()
  })

  it('지하철 승강장 접근시간 미확인을 명시한다', () => {
    render(<TransitBoardingAssessment assessment={{
      ...bus,
      mode: 'SUBWAY',
      status: 'unavailable',
      platformAccess: 'unknown',
      selectedOrder: null,
    }} />)
    expect(screen.getByText(/개찰구·승강장 접근시간 미확인/)).toBeInTheDocument()
  })
})
