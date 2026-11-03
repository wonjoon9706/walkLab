import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SubwayArrivalInfo } from '../../domain/subwayArrival'
import { SubwayArrivalStatus } from './SubwayArrivalStatus'

const arrival: SubwayArrivalInfo = {
  lineName: '2호선',
  stationName: '건대입구',
  status: 'available',
  estimates: [
    {
      order: 1, arrivalSeconds: 110, direction: '내선', destination: '성수',
      rawArrivalSeconds: 110, dataAgeSeconds: 0,
      trainType: 'normal', statusCode: '99', statusMessage: '2분 후',
      generatedAt: '2026-11-03T03:00:00.000Z',
    },
    {
      order: 2, arrivalSeconds: 250, direction: '내선', destination: '성수',
      rawArrivalSeconds: 250, dataAgeSeconds: 0,
      trainType: 'normal', statusCode: '99', statusMessage: '4분 후',
      generatedAt: '2026-11-03T03:00:00.000Z',
    },
  ],
  fetchedAt: '2026-11-03T03:03:00.000Z',
  provider: 'seoul-subway',
  dataMode: 'live',
}

describe('지하철 도착정보 카드', () => {
  it('초를 분·초로 바꾸고 두 열차와 오래된 데이터 경고를 표시한다', () => {
    render(<SubwayArrivalStatus arrival={arrival} />)
    expect(screen.getByText('첫 번째 열차')).toBeInTheDocument()
    expect(screen.getByText('두 번째 열차')).toBeInTheDocument()
    expect(screen.getByText('도착 예정 1분 50초')).toBeInTheDocument()
    expect(screen.getByText('도착 예정 4분 10초')).toBeInTheDocument()
    expect(screen.getByText(/2분 이상 지나/)).toBeInTheDocument()
  })

  it('안전하게 매칭된 세 번째·네 번째 열차도 세로 목록으로 표시한다', () => {
    render(<SubwayArrivalStatus arrival={{
      ...arrival,
      estimates: [
        ...arrival.estimates,
        {
          ...arrival.estimates[0],
          order: 3,
          destination: '온수',
        },
        {
          ...arrival.estimates[0],
          order: 4,
          destination: '온수',
        },
      ],
    }} />)

    expect(screen.getByText('세 번째 열차')).toBeInTheDocument()
    expect(screen.getByText('네 번째 열차')).toBeInTheDocument()
    expect(screen.getAllByText('내선 · 온수행')).toHaveLength(2)
  })
})
