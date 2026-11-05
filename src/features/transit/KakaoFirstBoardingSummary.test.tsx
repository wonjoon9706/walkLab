import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AutomaticTransitAccessResult } from '../../domain/transitBoardingPoint'
import type { KakaoTransitRoute } from '../../domain/kakaoTransitRoute'
import type { KakaoRouteArrival } from './useKakaoRouteArrivals'
import { KakaoFirstBoardingSummary } from './KakaoFirstBoardingSummary'

const now = Date.parse('2026-11-04T03:00:00Z')
const coordinate = { latitude: 37, longitude: 127 }
const route: KakaoTransitRoute = {
  id: 'route', type: 'BUS', totalDistanceM: 2_000, totalDurationSeconds: 1_000,
  transferCount: 0, fare: null,
  steps: [{
    index: 0, mode: 'BUS', guidance: '테스트 버스', distanceM: 2_000, durationSeconds: 300,
    stops: [{ index: 0, name: '승차 정류장' }, { index: 1, name: '하차 정류장' }],
    vehicles: [{ index: 0, name: '테스트 버스', type: null }], coordinates: [coordinate, coordinate],
  }],
}
const access: AutomaticTransitAccessResult = {
  status: 'ready', busCandidates: [], subwayCandidates: [], busDiagnostics: null,
  accessWalk: {
    sourceRouteId: 'route', firstTransitStepIndex: 0, mode: 'BUS',
    origin: { coordinate, verification: 'searched_place', note: null },
    target: {
      mode: 'BUS', boardingPointName: '승차 정류장', routeName: '테스트 버스',
      locationName: '승차 정류장', coordinate, source: 'seoul_bus_stop', providerStopId: 'stop',
      arsId: '00001', providerRouteId: 'bus', verification: 'verified_bus_stop',
      directionVerification: 'route_stop_order',
    },
    walkingRoute: { distanceM: 100, providerDurationSeconds: 100, coordinates: [coordinate, coordinate],
      provider: 'kakao-walking-route', requestedAt: new Date(now).toISOString() },
    endpointGapsM: { start: 0, destination: 0 }, endpointVerification: 'verified',
    pureWalkingDurationSeconds: 100,
    speedBasis: { kind: 'g7_default_fallback', speedMps: 1, modelVersion: 'default-v1', validSessionCount: 0, label: null },
    internalStationAccess: { status: 'not_applicable', durationSeconds: null },
    providerTransitTotalDurationSeconds: 1_000, personalizedTotalEtaSeconds: null,
    totalEtaStatus: 'not_calculated', totalEtaReason: 'PROVIDER_TIME_COMPONENTS_UNCONFIRMED',
  },
}
function arrival(): KakaoRouteArrival {
  return {
    status: 'ready', error: null, checkedAt: new Date(now).toISOString(), subway: null,
    bus: {
      status: 'available', routeName: '테스트 버스', stopName: '승차 정류장', stopId: 'stop',
      fetchedAt: new Date(now).toISOString(), provider: 'seoul', dataMode: 'live',
      walkingTimeToStopSeconds: 100, arrivalSeconds: 600, remainingStops: 4,
      upcomingArrivals: [
        { order: 1, arrivalSeconds: 600, remainingStops: 4, message: null },
        { order: 2, arrivalSeconds: 900, remainingStops: 6, message: null },
      ],
    },
  }
}

describe('경로 카드 첫 승차 요약', () => {
  it('첫째·둘째 실제 정보와 T2-3 판정을 표시한다', () => {
    render(<KakaoFirstBoardingSummary route={route} access={access} arrival={arrival()} speedModel={null} now={now} />)
    expect(screen.getByText(/1번째 정보 · 10분 후 · 탑승 가능성 높음/)).toBeInTheDocument()
    expect(screen.getByText(/2번째 정보 · 15분 후 · 탑승 가능성 높음/)).toBeInTheDocument()
    expect(screen.getByText(/접근 도보/)).toBeInTheDocument()
  })

  it('출발대기 슬롯을 실제 차량 두 대나 즉시 도착으로 단정하지 않는다', () => {
    const value = arrival()
    if (value.bus?.status !== 'available') throw new Error('fixture')
    value.bus.upcomingArrivals = [1, 2].map((order) => ({
      order: order as 1 | 2, arrivalSeconds: 0, remainingStops: null,
      message: '출발대기', serviceStatus: 'departure_waiting', arrivalTimeStatus: 'review_required',
    }))
    render(<KakaoFirstBoardingSummary route={route} access={access} arrival={value} speedModel={null} now={now} />)
    expect(screen.getAllByText(/출발 대기 중 · 도착시간 미정 · 확인 필요/)).toHaveLength(2)
    expect(screen.queryByText(/곧 도착|탑승 가능성 높음/)).not.toBeInTheDocument()
  })

  it('연결 미확정 또는 오래된 정보로 탑승 가능하다고 표시하지 않는다', () => {
    const { rerender } = render(<KakaoFirstBoardingSummary route={route} access={null} arrival={arrival()} speedModel={null} now={now} />)
    expect(screen.queryByText(/탑승 가능성 높음/)).not.toBeInTheDocument()
    expect(screen.getByText(/접근 도보 연결 확인 필요/)).toBeInTheDocument()
    rerender(<KakaoFirstBoardingSummary route={route} access={access} arrival={arrival()} speedModel={null} now={now + 121_000} />)
    expect(screen.getByText(/도착정보 갱신 필요/)).toBeInTheDocument()
    expect(screen.queryByText(/분 후/)).not.toBeInTheDocument()
  })

  it('오래된 출발대기는 마지막 확인 상태만 안내하고 현재 ETA로 취급하지 않는다', () => {
    const value = arrival()
    if (value.bus?.status !== 'available') throw new Error('fixture')
    value.bus.upcomingArrivals = [{
      order: 1, arrivalSeconds: 0, remainingStops: null, message: '출발대기',
      serviceStatus: 'departure_waiting', arrivalTimeStatus: 'review_required',
    }]
    render(<KakaoFirstBoardingSummary route={route} access={access} arrival={value} speedModel={null} now={now + 121_000} />)
    expect(screen.getByText('마지막 조회: 출발 대기 · 현재 도착시간 미확인')).toBeInTheDocument()
    expect(screen.queryByText(/곧 도착|탑승 가능성 높음/)).not.toBeInTheDocument()
  })

  it('운영 차단을 일반 네트워크 오류나 도착 0분으로 표시하지 않는다', () => {
    render(<KakaoFirstBoardingSummary route={route} access={access}
      arrival={{ status: 'ready', bus: null, subway: null, error: 'disabled', checkedAt: null, issue: 'service_disabled' }}
      speedModel={null} now={now} />)
    expect(screen.getByText('이 환경에서는 실시간 도착정보를 제공하지 않습니다')).toBeInTheDocument()
    expect(screen.queryByText(/곧 도착|탑승 가능성 높음/)).not.toBeInTheDocument()
  })

  it('도착예정 정보 없음과 제공기관 조회 실패를 구분한다', () => {
    const value = arrival()
    value.bus = { ...value.bus!, status: 'no_service', arrivalSeconds: null, remainingStops: null }
    const { rerender } = render(<KakaoFirstBoardingSummary route={route} access={access} arrival={value} speedModel={null} now={now} />)
    expect(screen.getByText('현재 도착예정 정보 없음 · 탑승 여부 확인 필요')).toBeInTheDocument()
    rerender(<KakaoFirstBoardingSummary route={route} access={access}
      arrival={{ status: 'ready', bus: null, subway: null, error: 'failed', checkedAt: null, issue: 'request_failed' }}
      speedModel={null} now={now} />)
    expect(screen.getByText(/실시간 제공기관 조회 실패/)).toBeInTheDocument()
  })
})
