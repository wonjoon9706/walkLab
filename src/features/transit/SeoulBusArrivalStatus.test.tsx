import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { BusArrivalInfo } from '../../domain/busArrival'
import { BusArrivalStatus } from './BusArrivalStatus'

describe('서울시 버스 도착정보 표시', () => {
  it('첫 번째와 두 번째 버스를 구분하고 제공기관을 표시한다', () => {
    const arrival: BusArrivalInfo = {
      routeName: '지선 2222',
      stopName: '우리은행화양동지점',
      stopId: '103000189',
      arrivalSeconds: 265,
      remainingStops: 3,
      upcomingArrivals: [
        { order: 1, arrivalSeconds: 265, remainingStops: 3, message: '265분' },
        { order: 2, arrivalSeconds: 745, remainingStops: 8, message: '745분' },
      ],
      fetchedAt: new Date().toISOString(),
      provider: 'seoul',
      dataMode: 'live',
      status: 'available',
      walkingTimeToStopSeconds: null,
    }

    render(<BusArrivalStatus arrival={arrival} />)

    expect(screen.getByText('첫 번째 버스')).toBeInTheDocument()
    expect(screen.getByText('두 번째 버스')).toBeInTheDocument()
    expect(screen.getByText('도착 예정 4분 25초')).toBeInTheDocument()
    expect(screen.getByText('도착 예정 12분 25초')).toBeInTheDocument()
    expect(screen.queryByText('265분')).not.toBeInTheDocument()
    expect(screen.queryByText('745분')).not.toBeInTheDocument()
    expect(screen.getByText(/서울시 버스 실시간/)).toBeInTheDocument()
    expect(screen.getByText('3정거장 전')).toBeInTheDocument()
    expect(screen.getByText('8정거장 전')).toBeInTheDocument()
  })
})
