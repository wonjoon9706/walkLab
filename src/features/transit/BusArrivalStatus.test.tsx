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
    ['stop_match_failed', 'TMAP 정류장과 TAGO 정류장을 연결하지 못했습니다.'],
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
})
