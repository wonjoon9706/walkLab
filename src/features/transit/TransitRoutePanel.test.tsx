import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TransitRouteResult } from '../../domain/transitRoute'
import { TransitRoutePanel } from './TransitRoutePanel'

const {
  getTransitRoutesMock,
  getBusArrivalMock,
  getWalkingRouteMock,
} = vi.hoisted(() => ({
  getTransitRoutesMock: vi.fn(),
  getBusArrivalMock: vi.fn(),
  getWalkingRouteMock: vi.fn(),
}))

vi.mock('../../services/routing/transitRouteClient', () => ({
  transitRouteClient: { getTransitRoutes: getTransitRoutesMock },
}))

vi.mock('../../services/transitArrival/busArrivalClient', () => ({
  busArrivalClient: { getBusArrival: getBusArrivalMock },
  createBusArrivalRequest: vi.fn(() => ({})),
}))

vi.mock('../../services/transitArrival/subwayArrivalClient', () => ({
  subwayArrivalClient: { getSubwayArrival: vi.fn() },
  createSubwayArrivalRequest: vi.fn(() => ({})),
}))

vi.mock('../../services/routing/walkingRouteClient', () => ({
  walkingRouteClient: { getWalkingRoute: getWalkingRouteMock },
}))

vi.mock('../map/TransitRouteMap', () => ({
  TransitRouteMap: () => <div>대중교통 지도</div>,
}))

vi.mock('../map/WalkingRouteMap', () => ({
  WalkingRouteMap: () => <div>직접 도보 지도</div>,
}))

const origin = { latitude: 37.548, longitude: 127.066 }
const stationPoint = { latitude: 37.55, longitude: 127.07 }
const routeResult: TransitRouteResult = {
  provider: 'tmap-transit',
  requestedAt: new Date().toISOString(),
  itineraries: [{
    id: 'route-1',
    totalDurationSeconds: 1_300,
    totalWalkDurationSeconds: 400,
    totalWalkDistanceM: 400,
    totalDistanceM: 4_000,
    transferCount: 1,
    fareKrw: 1_500,
    legs: [{
      mode: 'WALK', distanceM: 200, durationSeconds: 200,
      routeName: null, routeColor: null, routeType: null,
      startName: '출발지', endName: '정류장', coordinates: [],
    }, {
      mode: 'BUS', distanceM: 2_000, durationSeconds: 183,
      routeName: '간선:302', routeColor: null, routeType: 11,
      startName: '정류장', endName: '하차 정류장', coordinates: [],
      stops: [{ index: 0, providerStopId: 'A', name: '정류장', coordinate: origin }],
    }, {
      mode: 'WALK', distanceM: 256, durationSeconds: 200,
      routeName: null, routeColor: null, routeType: null,
      startName: '하차 정류장', endName: '어린이대공원역 접근점',
      endCoordinate: stationPoint, coordinates: [],
    }, {
      mode: 'SUBWAY', distanceM: 1_500, durationSeconds: 717,
      routeName: '수도권7호선', routeColor: null, routeType: 7,
      startName: '어린이대공원', endName: '이수',
      startCoordinate: stationPoint, coordinates: [],
    }],
  }],
}

const subwayExit = { latitude: 37.540, longitude: 127.060 }
const finalDestination = { latitude: 37.6, longitude: 127.1 }
const lastBusRouteResult: TransitRouteResult = {
  provider: 'tmap-transit',
  requestedAt: new Date().toISOString(),
  itineraries: [{
    id: 'last-bus-route',
    totalDurationSeconds: 2_000,
    totalWalkDurationSeconds: 800,
    totalWalkDistanceM: 656,
    totalDistanceM: 10_000,
    transferCount: 2,
    fareKrw: 1_500,
    legs: [{
      mode: 'WALK', distanceM: 200, durationSeconds: 200,
      routeName: null, routeColor: null, routeType: null,
      startName: '출발지', endName: '남성역', coordinates: [],
    }, {
      mode: 'SUBWAY', distanceM: 7_000, durationSeconds: 1_000,
      routeName: '수도권7호선', routeColor: null, routeType: 7,
      startName: '남성', endName: '건대입구',
      endCoordinate: subwayExit, coordinates: [],
    }, {
      mode: 'WALK', distanceM: 200, durationSeconds: 200,
      routeName: null, routeColor: null, routeType: null,
      startName: '건대입구역 접근점', endName: '건대입구역사거리·건대병원',
      startCoordinate: subwayExit, endCoordinate: stationPoint, coordinates: [],
    }, {
      mode: 'BUS', distanceM: 2_000, durationSeconds: 183,
      routeName: '지선:2222', routeColor: null, routeType: 12,
      startName: '건대입구역사거리·건대병원', endName: '성동세무서',
      startCoordinate: stationPoint,
      endCoordinate: { latitude: 37.59, longitude: 127.09 },
      coordinates: [],
    }, {
      mode: 'WALK', distanceM: 256, durationSeconds: 266,
      routeName: null, routeColor: null, routeType: null,
      startName: '성동세무서', endName: '목적지',
      startCoordinate: { latitude: 37.59, longitude: 127.09 },
      endCoordinate: finalDestination,
      coordinates: [],
    }],
  }],
}

function renderPanel() {
  render(
    <TransitRoutePanel
      active
      origin={origin}
      destination={{
        id: 'destination', name: '목적지', address: '서울', roadAddress: null,
        coordinate: { latitude: 37.6, longitude: 127.1 },
      }}
      speedModel={null}
    />,
  )
}

describe('T2-4A 대중교통 패널', () => {
  beforeEach(() => {
    getTransitRoutesMock.mockReset().mockResolvedValue(routeResult)
    getBusArrivalMock.mockReset().mockImplementation(() => {
      const fetchedAt = new Date().toISOString()
      return Promise.resolve({
        routeName: '302', stopName: '정류장', stopId: 'A',
        arrivalSeconds: 5, remainingStops: 0,
        upcomingArrivals: [
          { order: 1, arrivalSeconds: 5, remainingStops: 0, message: null },
          { order: 2, arrivalSeconds: 674, remainingStops: 6, message: null },
        ],
        fetchedAt, provider: 'seoul', dataMode: 'live', status: 'available',
        walkingTimeToStopSeconds: null,
      })
    })
    getWalkingRouteMock.mockReset().mockResolvedValue({
      distanceM: 700,
      providerDurationSeconds: 620,
      coordinates: [origin, stationPoint],
      provider: 'kakao-walking-route',
      requestedAt: new Date().toISOString(),
    })
  })

  it('사용자 클릭 후 동일 비교 지점으로 조회하고 선택된 두 번째 버스를 표시한다', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: '대중교통 경로 검색' }))
    expect(await screen.findByText('TMAP 경로 후보')).toBeInTheDocument()
    expect(screen.getByText(/실시간 버스 대기시간은 이 상단 시간에 반영되지/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '실시간 도착정보 조회' }))
    await screen.findByText(/두 번째 버스/)
    fireEvent.click(screen.getByRole('button', { name: '역까지 직접 걷기와 비교' }))

    await waitFor(() => expect(getWalkingRouteMock).toHaveBeenCalledWith({
      start: origin,
      destination: stationPoint,
    }))
    expect(await screen.findByText(/두 번째 버스 · 간선 302 기준/)).toBeInTheDocument()
    expect(screen.getByText(/최적 경로를 확정하지 않습니다/)).toBeInTheDocument()
  })

  it('직접 도보 경로 검색 실패를 비교 불가 오류로 남기고 기존 경로를 유지한다', async () => {
    getWalkingRouteMock.mockRejectedValueOnce(new Error('failed'))
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: '대중교통 경로 검색' }))
    await screen.findByText('TMAP 경로 후보')
    fireEvent.click(screen.getByRole('button', { name: '실시간 도착정보 조회' }))
    await screen.findByText(/두 번째 버스/)
    fireEvent.click(screen.getByRole('button', { name: '역까지 직접 걷기와 비교' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '역 접근 비교 지점까지의 도보 경로를 불러오지 못했습니다.',
    )
    expect(screen.getByText('상세 이동 경로')).toBeInTheDocument()
  })

  it('개발 환경에서 마지막 WALK와 요청 목적지의 최소 진단만 표시한다', async () => {
    getTransitRoutesMock.mockResolvedValueOnce({
      ...routeResult,
      itineraries: [{
        ...routeResult.itineraries[0],
        legs: [
          routeResult.itineraries[0].legs[1],
          {
            mode: 'WALK', distanceM: 331, durationSeconds: 266,
            routeName: null, routeColor: null, routeType: null,
            startName: '성동세무서', endName: '목적지',
            startCoordinate: stationPoint,
            endCoordinate: { latitude: 37.6, longitude: 127.1 },
            coordinates: [stationPoint, { latitude: 37.6, longitude: 127.1 }],
          },
        ],
      }],
    })
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: '대중교통 경로 검색' }))

    expect(await screen.findByText('로컬 TMAP 마지막 도보 진단')).toBeInTheDocument()
    expect(screen.getByText('TMAP 요청 목적지')).toBeInTheDocument()
    expect(screen.getByText('TMAP 원본')).toBeInTheDocument()
    expect(screen.getByText(/331 m · 4분 26초/)).toBeInTheDocument()
    expect(screen.queryByText(/인증 URL/)).toBeNull()

    fireEvent.click(screen.getByRole('button', {
      name: '동일 좌표로 G8 도보 경로 1회 조회',
    }))
    await waitFor(() => expect(getWalkingRouteMock).toHaveBeenCalledWith({
      start: stationPoint,
      destination: { latitude: 37.6, longitude: 127.1 },
    }))
    expect(await screen.findByText('TMAP과 G8 동일 좌표 비교')).toBeInTheDocument()
    expect(screen.getByText('직접 도보 지도')).toBeInTheDocument()
  })

  it('마지막 버스 대기 미확인 상태에서 계산된 손익분기시간만 표시한다', async () => {
    getTransitRoutesMock.mockResolvedValueOnce(lastBusRouteResult)
    getWalkingRouteMock.mockResolvedValueOnce({
      distanceM: 800,
      providerDurationSeconds: 700,
      coordinates: [subwayExit, finalDestination],
      provider: 'kakao-walking-route',
      requestedAt: new Date().toISOString(),
    })
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: '대중교통 경로 검색' }))
    expect(await screen.findByRole('heading', {
      name: '목적지까지 직접 걷기와 비교',
    })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {
      name: '목적지까지 직접 걷기와 비교',
    }))

    await waitFor(() => expect(getWalkingRouteMock).toHaveBeenCalledWith({
      start: subwayExit,
      destination: finalDestination,
    }))
    expect(await screen.findByText(/버스 대기시간이 1분 15초보다 길어지면/)).toBeInTheDocument()
    expect(screen.getByText(/미래 환승 대기시간으로 사용하지 않습니다/)).toBeInTheDocument()
    expect(screen.getByText('버스 대기시간 미확인')).toBeInTheDocument()
  })

  it('마지막 버스 생략용 직접 도보 조회 실패가 기존 경로를 지우지 않는다', async () => {
    getTransitRoutesMock.mockResolvedValueOnce(lastBusRouteResult)
    getWalkingRouteMock.mockRejectedValueOnce(new Error('failed'))
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: '대중교통 경로 검색' }))
    await screen.findByRole('heading', {
      name: '목적지까지 직접 걷기와 비교',
    })
    fireEvent.click(screen.getByRole('button', {
      name: '목적지까지 직접 걷기와 비교',
    }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '지하철 하차 지점부터 목적지까지의 G8 경로를 불러오지 못했습니다.',
    )
    expect(screen.getByText('상세 이동 경로')).toBeInTheDocument()
  })
})
