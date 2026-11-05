import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BusArrivalInfo } from '../../domain/busArrival'
import { BusArrivalStatus } from './BusArrivalStatus'

const base = {
  routeName: '직행좌석 7800',
  stopName: '사당역9번출구앞',
  fetchedAt: '2026-11-03T00:00:00.000Z',
  provider: 'tago' as const,
  dataMode: 'live' as const,
  walkingTimeToStopSeconds: null,
}

describe('버스 도착정보 표시', () => {
  afterEach(() => vi.useRealTimers())

  it('정상 Mock 도착시간과 남은 정류장 수를 표시한다', () => {
    const arrival: BusArrivalInfo = {
      ...base,
      status: 'available',
      stopId: 'TAGO-A',
      arrivalSeconds: 360,
      remainingStops: 3,
    }

    render(<BusArrivalStatus arrival={arrival} />)

    expect(screen.getByText('도착 예정 6분 0초')).toBeInTheDocument()
    expect(screen.getByText('3정거장 전')).toBeInTheDocument()
    expect(screen.getByText(/TAGO 실시간/)).toBeInTheDocument()
  })

  it.each([
    ['no_service', '현재 운행 중인 도착정보가 없습니다.'],
    ['unsupported_region', 'TAGO 실시간 도착정보를 지원하지 않는 지역입니다.'],
    ['stop_match_failed', '경로 정류장과 TAGO 정류장을 연결하지 못했습니다.'],
    ['stop_match_review_required', '같은 이름의 정류장이 있어 정류장 확인이 필요합니다.'],
    ['api_error', '실시간 도착정보를 불러오지 못했습니다.'],
  ] as const)('%s 상태를 구분해 표시한다', (status, message) => {
    const arrival: BusArrivalInfo = {
      ...base,
      status,
      stopId: null,
      arrivalSeconds: null,
      remainingStops: null,
    }

    render(<BusArrivalStatus arrival={arrival} />)

    expect(screen.getByText(message)).toBeInTheDocument()
  })

  it('조회 후 2분이 지나면 최신 정보가 아닐 수 있음을 표시한다', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-03T00:02:01.000Z'))
    const arrival: BusArrivalInfo = {
      ...base,
      status: 'available',
      stopId: 'TAGO-A',
      arrivalSeconds: 360,
      remainingStops: 3,
    }

    render(<BusArrivalStatus arrival={arrival} />)
    await act(async () => vi.runOnlyPendingTimersAsync())

    expect(
      screen.getByText(/조회 후 2분이 지나 최신 정보가 아닐 수 있습니다/),
    ).toBeInTheDocument()
  })

  it('0초인데 정류장이 남은 서울시 값은 즉시 도착으로 표시하지 않는다', () => {
    const arrival: BusArrivalInfo = {
      ...base,
      provider: 'seoul',
      status: 'available',
      stopId: 'SEOUL-A',
      arrivalSeconds: 0,
      remainingStops: 3,
      upcomingArrivals: [{
        order: 1,
        arrivalSeconds: 0,
        remainingStops: 3,
        message: '출발대기',
        arrivalTimeStatus: 'review_required',
      }],
    }

    render(<BusArrivalStatus arrival={arrival} />)

    expect(screen.getByText('도착시간 확인 필요')).toBeInTheDocument()
    expect(screen.queryByText('도착 예정 0초')).not.toBeInTheDocument()
    expect(screen.getByText(/원본 안내: 출발대기/)).toBeInTheDocument()
  })

  it('첫째·둘째 슬롯이 모두 출발대기면 차량 두 대로 단정하지 않고 한 번만 안내한다', () => {
    const waitingEstimate = (order: 1 | 2) => ({
      order,
      arrivalSeconds: 0,
      remainingStops: null,
      message: '출발대기',
      serviceStatus: 'departure_waiting' as const,
      rawStopSequence: 3,
      rawSectionSequence: 0,
      arrivalTimeStatus: 'review_required' as const,
    })
    const arrival: BusArrivalInfo = {
      ...base,
      provider: 'seoul',
      status: 'available',
      stopId: 'SEOUL-A',
      arrivalSeconds: 0,
      remainingStops: null,
      upcomingArrivals: [waitingEstimate(1), waitingEstimate(2)],
    }

    render(<BusArrivalStatus arrival={arrival} />)

    expect(screen.getAllByText('출발 대기 중 · 도착 예정시간 미확정'))
      .toHaveLength(1)
    expect(screen.queryByText('첫 번째 버스')).not.toBeInTheDocument()
    expect(screen.queryByText('두 번째 버스')).not.toBeInTheDocument()
    expect(screen.queryByText(/정거장 전/)).not.toBeInTheDocument()
    expect(screen.queryByText(/도착 예정 0초/)).not.toBeInTheDocument()
  })
})
