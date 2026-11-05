import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaceSearchResult } from '../domain/walkingRoute'

const {
  getCurrentLocationMock,
  getWalkingRouteMock,
  getKakaoTransitRoutesMock,
  getBusArrivalMock,
  getSubwayArrivalMock,
  reverseGeocodeMock,
  loadSpeedModelMock,
  navigationStartMock,
  navigationStopMock,
  measurementState,
  navigationState,
  subscribeGpsMock,
  startMeasurementMock,
  stopMeasurementMock,
  syncState,
} = vi.hoisted(() => ({
  getCurrentLocationMock: vi.fn(),
  getWalkingRouteMock: vi.fn(),
  getKakaoTransitRoutesMock: vi.fn(),
  getBusArrivalMock: vi.fn(),
  getSubwayArrivalMock: vi.fn(),
  reverseGeocodeMock: vi.fn(),
  loadSpeedModelMock: vi.fn(),
  navigationStartMock: vi.fn(),
  navigationStopMock: vi.fn(),
  subscribeGpsMock: vi.fn(),
  startMeasurementMock: vi.fn(),
  stopMeasurementMock: vi.fn(),
  measurementState: {
    isActive: false,
    status: 'idle',
    localSaveStatus: 'idle',
    savedPointCount: 0,
    message: null,
  },
  navigationState: {
    status: 'idle',
    isActive: false,
    route: null,
    currentPosition: null,
    remainingCoordinates: [],
    remainingDistanceM: null as number | null,
    progressRatio: null,
    recentSpeedMps: null,
    appliedSpeedMps: null,
    speedSource: null,
    remainingDurationSeconds: null as number | null,
    arrivalAt: null as string | null,
    lastPositionAt: null as string | null,
    rerouteCount: 0,
    message: null,
  },
  syncState: {
    status: 'idle',
    pendingCount: 0,
    confirmedCount: 0,
  },
}))

const manualOrigin: PlaceSearchResult = {
  id: 'origin-1',
  name: '서울역',
  address: '서울 용산구 동자동',
  roadAddress: '서울 용산구 한강대로 405',
  coordinate: { latitude: 37.5547, longitude: 126.9707 },
}

const secondOrigin: PlaceSearchResult = {
  id: 'origin-2',
  name: '시청역',
  address: '서울 중구 정동',
  roadAddress: '서울 중구 세종대로 101',
  coordinate: { latitude: 37.5663, longitude: 126.9779 },
}

const destination: PlaceSearchResult = {
  id: 'destination-1',
  name: '광화문',
  address: '서울 종로구 세종로',
  roadAddress: '서울 종로구 세종대로 172',
  coordinate: { latitude: 37.5759, longitude: 126.9768 },
}

const kakaoTransitResult = {
  provider: 'kakao-map-publictraffic',
  requestedAt: '2026-11-02T00:00:00.000Z',
  reportedRouteCounts: { total: 1, bus: 0, subway: 0, busAndSubway: 0 },
  rejectedRoutes: [],
  routes: [{
    id: 'kakao-route-1', type: 'SUBWAY', totalDistanceM: 4_000,
    totalDurationSeconds: 900, transferCount: 0, fare: null,
    steps: [{
      index: 0, mode: 'WALKING', guidance: '도보 이동', distanceM: 400,
      durationSeconds: 300, stops: [], vehicles: [],
      coordinates: [manualOrigin.coordinate, destination.coordinate],
    }],
  }],
} as const

vi.mock('../features/auth/authContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'user@example.com' } }),
}))

vi.mock('../features/measurement/measurementContext', () => ({
  useMeasurement: () => ({
    ...measurementState,
    startMeasurement: startMeasurementMock,
    stopMeasurement: stopMeasurementMock,
    subscribeGps: subscribeGpsMock,
  }),
}))

vi.mock('../features/sync/syncContext', () => ({
  useSync: () => syncState,
}))

vi.mock('../features/navigation/useLiveNavigation', () => ({
  useLiveNavigation: () => ({
    ...navigationState,
    start: navigationStartMock,
    startWithPositionSource: navigationStartMock,
    stop: navigationStopMock,
  }),
}))

vi.mock('../services/location/currentLocation', () => ({
  CurrentLocationError: class CurrentLocationError extends Error {},
  getCurrentLocationFix: getCurrentLocationMock,
}))

vi.mock('../services/learning/currentWalkingSpeedModel', () => ({
  loadCurrentWalkingSpeedModel: loadSpeedModelMock,
}))

vi.mock('../services/routing/walkingRouteClient', () => ({
  walkingRouteClient: { getWalkingRoute: getWalkingRouteMock },
  getSupabaseAccessToken: vi.fn().mockResolvedValue('access-token'),
}))

vi.mock('../services/routing/kakaoTransitRouteClient', () => ({
  kakaoTransitRouteClient: { getTransitRoutes: getKakaoTransitRoutesMock },
}))

vi.mock('../services/transitArrival/busArrivalClient', () => ({
  busArrivalClient: { getBusArrival: getBusArrivalMock },
  createBusArrivalRequest: vi.fn(() => ({})),
}))

vi.mock('../services/transitArrival/subwayArrivalClient', () => ({
  subwayArrivalClient: { getSubwayArrival: getSubwayArrivalMock },
  createSubwayArrivalRequest: vi.fn(() => ({})),
}))

vi.mock('../services/places/kakaoReverseGeocode', () => ({
  reverseGeocodeKakaoCoordinate: reverseGeocodeMock,
}))

vi.mock('../features/map/TransitRouteMap', () => ({
  TransitRouteMap: () => <div>대중교통 경로 지도</div>,
}))

vi.mock('../features/map/WalkingRouteMap', () => ({
  WalkingRouteMap: ({
    coordinates = [],
    start,
    destination: mapDestination,
    isStartSelectionEnabled,
    onSelectStart,
  }: {
    coordinates?: Array<{ latitude: number; longitude: number }>
    start: { latitude: number; longitude: number } | null
    destination?: { latitude: number; longitude: number } | null
    isStartSelectionEnabled?: boolean
    onSelectStart?: (coordinate: {
      latitude: number
      longitude: number
    }) => void
  }) => (
    <div>
      {coordinates.length >= 2 ? '도보 경로 지도' : '위치 미리보기 지도'}
      {start !== null && <span>출발지 마커</span>}
      {mapDestination != null && <span>목적지 마커</span>}
      {isStartSelectionEnabled && (
        <button
          type="button"
          onClick={() =>
            onSelectStart?.({ latitude: 37.55, longitude: 126.99 })
          }
        >
          출발지 설정
        </button>
      )}
    </div>
  ),
}))

vi.mock('../features/places/PlaceSearchPanel', () => ({
  PlaceSearchPanel: ({
    idPrefix,
    title,
    selectedPlace,
    onSelect,
    children,
    closedActions,
  }: {
    idPrefix: string
    title: string
    selectedPlace: PlaceSearchResult | null
    onSelect: (place: PlaceSearchResult) => void
    children?: React.ReactNode
    closedActions?: (openSearch: () => void) => React.ReactNode
  }) => (
    <section>
      <h2>{title}</h2>
      {selectedPlace !== null && (
        <p>
          <strong>{selectedPlace.name}</strong>
          <span>{selectedPlace.roadAddress ?? selectedPlace.address}</span>
        </p>
      )}
      {children}
      {closedActions?.(vi.fn())}
      {idPrefix === 'origin-place' ? (
        <>
          <button type="button" onClick={() => onSelect(manualOrigin)}>
            서울역 출발 선택
          </button>
          <button type="button" onClick={() => onSelect(secondOrigin)}>
            시청역 출발 선택
          </button>
        </>
      ) : (
        <button type="button" onClick={() => onSelect(destination)}>
          광화문 목적지 선택
        </button>
      )}
    </section>
  ),
}))


beforeEach(() => {
  loadSpeedModelMock.mockReset()
  getKakaoTransitRoutesMock.mockReset().mockResolvedValue(kakaoTransitResult)
  getBusArrivalMock.mockReset()
  getSubwayArrivalMock.mockReset()
  reverseGeocodeMock.mockReset()
  navigationStartMock.mockReset()
  navigationStopMock.mockReset()
  subscribeGpsMock.mockReset()
  startMeasurementMock.mockReset()
  stopMeasurementMock.mockReset()
  navigationState.isActive = false
  navigationState.status = 'idle'
  navigationState.route = null
  navigationState.currentPosition = null
  navigationState.remainingCoordinates = []
  navigationState.remainingDistanceM = null
  navigationState.progressRatio = null
  navigationState.recentSpeedMps = null
  navigationState.appliedSpeedMps = null
  navigationState.speedSource = null
  navigationState.remainingDurationSeconds = null
  navigationState.arrivalAt = null
  navigationState.lastPositionAt = null
  navigationState.rerouteCount = 0
  navigationState.message = null
  measurementState.isActive = false
  measurementState.status = 'idle'
  measurementState.localSaveStatus = 'idle'
  measurementState.savedPointCount = 0
  startMeasurementMock.mockResolvedValue(true)
  stopMeasurementMock.mockResolvedValue(undefined)
  navigationStartMock.mockReturnValue(true)
  navigationStopMock.mockImplementation(() => {
    navigationState.isActive = false
  })
  getCurrentLocationMock.mockRejectedValue(new Error('permission denied'))
  loadSpeedModelMock.mockResolvedValue({
    algorithmVersion: 'recency-weighted-v1',
    status: 'insufficient',
    estimatedSpeedMps: null,
    validSessionCount: 0,
  })
  getWalkingRouteMock.mockResolvedValue({
    distanceM: 1000,
    providerDurationSeconds: 800,
    coordinates: [manualOrigin.coordinate, destination.coordinate],
    provider: 'kakao-walking-route',
    requestedAt: '2026-10-30T00:00:00.000Z',
  })
  getBusArrivalMock.mockResolvedValue({
    routeName: '간선 100',
    stopName: '서울역',
    stopId: 'TAGO-SEOUL',
    arrivalSeconds: 360,
    remainingStops: 3,
    fetchedAt: '2026-11-03T00:00:00.000Z',
    provider: 'tago',
    dataMode: 'live',
    status: 'available',
    walkingTimeToStopSeconds: null,
  })
  getSubwayArrivalMock.mockResolvedValue({
    lineName: '2호선',
    stationName: '시청',
    status: 'available',
    estimates: [{
      order: 1,
      arrivalSeconds: 110,
      rawArrivalSeconds: 110,
      dataAgeSeconds: 0,
      direction: '내선',
      destination: '성수',
      trainType: 'normal',
      statusCode: '99',
      statusMessage: '2분 후',
      generatedAt: '2026-11-03T00:00:00.000Z',
    }],
    fetchedAt: '2026-11-03T00:00:30.000Z',
    provider: 'seoul-subway',
    dataMode: 'live',
  })
  reverseGeocodeMock.mockResolvedValue({
    roadAddress: '서울 용산구 한강대로 405',
    address: '서울 용산구 동자동',
  })
})

describe('WalkingRoutePage 출발지 선택', () => {
  it('동일 사용자 객체가 재생성돼도 G7 기록 조회를 반복하지 않는다', async () => {
    const page = <MemoryRouter><WalkingRoutePage /></MemoryRouter>
    const { rerender } = render(page)
    await screen.findByRole('heading', { name: '출발지' })
    await waitFor(() => expect(loadSpeedModelMock).toHaveBeenCalled())
    rerender(<MemoryRouter><WalkingRoutePage /></MemoryRouter>)
    await waitFor(() => expect(loadSpeedModelMock).toHaveBeenCalledTimes(1))
  })
  it('StrictMode 초기 재설정에서도 동일 사용자 G7 기록 조회를 공유한다', async () => {
    render(<StrictMode><MemoryRouter><WalkingRoutePage /></MemoryRouter></StrictMode>)
    await screen.findByRole('heading', { name: '출발지' })
    await waitFor(() => expect(loadSpeedModelMock).toHaveBeenCalledTimes(1))
  })
  it('출발지 상태와 검색 기능을 하나의 영역에 표시한다', async () => {
    getCurrentLocationMock.mockResolvedValueOnce({
      coordinate: { latitude: 37.5, longitude: 127.1 },
      accuracyM: 12,
      measuredAt: '2026-11-02T00:00:00.000Z',
    })

    render(
      <MemoryRouter>
        <WalkingRoutePage />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole('heading', { name: '출발지' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: '출발지 직접 검색' }),
    ).not.toBeInTheDocument()
    expect(
      await screen.findByText(/GPS 확인됨/),
    ).toBeInTheDocument()
    expect(screen.getByText('위치 미리보기 지도')).toBeInTheDocument()
    expect(screen.getByText('출발지 마커')).toBeInTheDocument()
    expect(
      await screen.findByText('서울 용산구 한강대로 405'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '현재 위치 사용' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '장소 또는 주소 검색' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '지도에서 직접 선택' }),
    ).toBeInTheDocument()
  })

  it('GPS 실패 후에도 검색한 출발지로 경로를 조회한다', async () => {
    render(
      <MemoryRouter>
        <WalkingRoutePage />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: '서울역 출발 선택' }))
    expect(screen.getByText('위치 미리보기 지도')).toBeInTheDocument()
    expect(screen.getByText('출발지 마커')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '광화문 목적지 선택' }))

    await waitFor(() => {
      expect(getWalkingRouteMock).toHaveBeenCalledWith({
        start: manualOrigin.coordinate,
        destination: destination.coordinate,
      })
    })
    expect(
      await screen.findByText(/선택한 출발지에서 지금 출발하는 기준/),
    ).toBeInTheDocument()
    expect(screen.getByText('예상 소요시간')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '12분 30초' })).toBeInTheDocument()
    expect(screen.getByText('1.00 km')).toBeInTheDocument()
    expect(screen.getByText('오전 9:12')).toBeInTheDocument()
    expect(screen.queryByText('예상시간 상세')).toBeNull()
    expect(screen.queryByText('기본속도 기준')).toBeNull()
    expect(screen.queryByText('위치 미리보기 지도')).toBeNull()
  })

  it('GPS 정확도가 낮아도 지도와 정확도 경고를 함께 표시한다', async () => {
    getCurrentLocationMock.mockResolvedValueOnce({
      coordinate: { latitude: 37.5, longitude: 127.1 },
      accuracyM: 320,
      measuredAt: '2026-11-02T00:00:00.000Z',
    })

    render(<MemoryRouter><WalkingRoutePage /></MemoryRouter>)

    expect(await screen.findByText('위치 미리보기 지도')).toBeInTheDocument()
    expect(screen.getByText('출발지 마커')).toBeInTheDocument()
    expect(screen.getByText(/GPS 오차 범위가 큽니다/)).toBeInTheDocument()
  })

  it('현재 위치가 없어도 선택한 목적지를 위치 미리보기로 표시한다', async () => {
    render(
      <MemoryRouter>
        <WalkingRoutePage />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: '광화문 목적지 선택' }))

    expect(screen.getByText('위치 미리보기 지도')).toBeInTheDocument()
    expect(screen.queryByText('출발지 마커')).toBeNull()
    expect(screen.getByText('목적지 마커')).toBeInTheDocument()
  })

  it('늦게 도착한 초기 GPS 응답이 검색 출발지를 덮어쓰지 않는다', async () => {
    const deferredLocation: {
      resolve: (value: {
        coordinate: { latitude: number; longitude: number }
        accuracyM: number
        measuredAt: string
      }) => void
    } = { resolve: vi.fn() }
    getCurrentLocationMock.mockReturnValueOnce(
      new Promise((resolve) => {
        deferredLocation.resolve = resolve
      }),
    )
    render(
      <MemoryRouter>
        <WalkingRoutePage />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: '서울역 출발 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '광화문 목적지 선택' }))
    deferredLocation.resolve({
      coordinate: { latitude: 37.5, longitude: 127.1 },
      accuracyM: 8,
      measuredAt: '2026-11-02T00:00:00.000Z',
    })

    await waitFor(() => {
      expect(getWalkingRouteMock).toHaveBeenLastCalledWith({
        start: manualOrigin.coordinate,
        destination: destination.coordinate,
      })
    })
    expect(getWalkingRouteMock).toHaveBeenCalledTimes(1)
  })

  it('지도에서 누른 좌표를 출발지로 사용한다', async () => {
    getCurrentLocationMock.mockResolvedValueOnce({
      coordinate: { latitude: 37.5, longitude: 127.1 },
      accuracyM: 10,
      measuredAt: '2026-11-02T00:00:00.000Z',
    })
    render(
      <MemoryRouter>
        <WalkingRoutePage />
      </MemoryRouter>,
    )
    await screen.findByText(/GPS 확인됨/)

    fireEvent.click(
      screen.getByRole('button', { name: '지도에서 직접 선택' }),
    )
    fireEvent.click(screen.getByRole('button', { name: '출발지 설정' }))
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: '출발지 설정' }),
      ).not.toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: '광화문 목적지 선택' }))

    await waitFor(() => {
      expect(getWalkingRouteMock).toHaveBeenLastCalledWith({
        start: { latitude: 37.55, longitude: 126.99 },
        destination: destination.coordinate,
      })
    })
    expect(
      await screen.findByText('서울 용산구 한강대로 405'),
    ).toBeInTheDocument()
  })

  it('지도 좌표의 주소 조회에 실패해도 선택한 좌표와 대체 문구를 유지한다', async () => {
    getCurrentLocationMock.mockResolvedValueOnce({
      coordinate: { latitude: 37.5, longitude: 127.1 },
      accuracyM: 10,
      measuredAt: '2026-11-02T00:00:00.000Z',
    })
    reverseGeocodeMock
      .mockResolvedValueOnce({ roadAddress: null, address: '서울 광진구 화양동' })
      .mockRejectedValueOnce(new Error('reverse geocode failed'))
    render(<MemoryRouter><WalkingRoutePage /></MemoryRouter>)
    await screen.findByText('위치 미리보기 지도')

    fireEvent.click(screen.getByRole('button', { name: '지도에서 직접 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '출발지 설정' }))

    expect(
      await screen.findByText('지도에서 선택한 위치'),
    ).toBeInTheDocument()
    expect(getWalkingRouteMock).not.toHaveBeenCalled()
  })

  it('요청 출발지와 카카오 경로 첫 점 차이가 크면 안내한다', async () => {
    getWalkingRouteMock.mockResolvedValueOnce({
      distanceM: 1000,
      providerDurationSeconds: 800,
      coordinates: [
        {
          latitude: manualOrigin.coordinate.latitude + 0.001,
          longitude: manualOrigin.coordinate.longitude,
        },
        destination.coordinate,
      ],
      provider: 'kakao-walking-route',
      requestedAt: '2026-10-30T00:00:00.000Z',
    })
    render(
      <MemoryRouter>
        <WalkingRoutePage />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: '서울역 출발 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '광화문 목적지 선택' }))

    fireEvent.click(await screen.findByRole('button', { name: '지도 보기' }))
    expect(
      await screen.findByText(/떨어진 보행 접근점에서 시작합니다/),
    ).toBeInTheDocument()
  })

  it('GPS 확인 실패 시 내 위치 사용 동작으로 현재 위치를 다시 확인한다', async () => {
    const recoveredLocation = { latitude: 37.5, longitude: 127.1 }
    getCurrentLocationMock
      .mockRejectedValueOnce(new Error('permission denied'))
      .mockResolvedValueOnce({
        coordinate: recoveredLocation,
        accuracyM: 15,
        measuredAt: '2026-11-02T00:00:00.000Z',
      })
    render(
      <MemoryRouter>
        <WalkingRoutePage />
      </MemoryRouter>,
    )

    expect(await screen.findByText(/현재 위치를 확인하지 못했습니다/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '현재 위치 사용' }))

    expect(await screen.findByText(/GPS 확인됨/)).toBeInTheDocument()
  })

  it('목적지가 선택된 상태에서 출발지를 바꾸면 다시 조회한다', async () => {
    render(
      <MemoryRouter>
        <WalkingRoutePage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '서울역 출발 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '광화문 목적지 선택' }))
    await waitFor(() => expect(getWalkingRouteMock).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: '시청역 출발 선택' }))

    await waitFor(() => {
      expect(getWalkingRouteMock).toHaveBeenLastCalledWith({
        start: secondOrigin.coordinate,
        destination: destination.coordinate,
      })
    })
  })

  it('조회한 경로와 실제 출발지 조건으로 안내를 시작한다', async () => {
    render(
      <MemoryRouter>
        <WalkingRoutePage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '서울역 출발 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '광화문 목적지 선택' }))
    await screen.findByRole('button', { name: '안내 시작' })

    fireEvent.click(screen.getByRole('button', { name: '안내 시작' }))

    expect(navigationStartMock).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: destination.coordinate,
        forceInitialReroute: true,
      }),
      { subscribe: subscribeGpsMock },
    )
    expect(startMeasurementMock).toHaveBeenCalledOnce()
    expect(startMeasurementMock).toHaveBeenCalledWith('navigation')
  })

  it('현재 위치 출발은 안내 시작 직전에 최신 GPS로 경로를 갱신한다', async () => {
    const initial = { latitude: 37.5, longitude: 127.1 }
    const latest = { latitude: 37.501, longitude: 127.101 }
    getCurrentLocationMock
      .mockResolvedValueOnce({
        coordinate: initial,
        accuracyM: 20,
        measuredAt: '2026-11-02T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        coordinate: latest,
        accuracyM: 8,
        measuredAt: '2026-11-02T00:00:05.000Z',
      })
    render(
      <MemoryRouter>
        <WalkingRoutePage />
      </MemoryRouter>,
    )
    await screen.findByText(/GPS 확인됨/)
    fireEvent.click(screen.getByRole('button', { name: '광화문 목적지 선택' }))
    await waitFor(() => expect(getWalkingRouteMock).toHaveBeenCalledTimes(1))

    fireEvent.click(await screen.findByRole('button', { name: '안내 시작' }))

    await waitFor(() => {
      expect(getWalkingRouteMock).toHaveBeenLastCalledWith({
        start: latest,
        destination: destination.coordinate,
      })
    })
    expect(startMeasurementMock).toHaveBeenCalledWith('navigation')
  })

  it('기존 GPS 측정 중에는 실시간 안내를 함께 시작하지 않는다', async () => {
    measurementState.isActive = true
    render(
      <MemoryRouter>
        <WalkingRoutePage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '서울역 출발 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '광화문 목적지 선택' }))
    fireEvent.click(await screen.findByRole('button', { name: '안내 시작' }))

    expect(navigationStartMock).not.toHaveBeenCalled()
    expect(
      screen.getByText(/GPS 측정 중에는 길찾기 안내를 함께 시작할 수 없습니다/),
    ).toBeInTheDocument()
  })

  it('측정 세션 시작 실패 시 안내를 중지하고 오류를 표시한다', async () => {
    startMeasurementMock.mockResolvedValue(false)
    render(
      <MemoryRouter>
        <WalkingRoutePage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '서울역 출발 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '광화문 목적지 선택' }))
    fireEvent.click(await screen.findByRole('button', { name: '안내 시작' }))

    expect(
      await screen.findByText(/보행 기록 저장을 시작하지 못해 안내도 시작하지 않았습니다/),
    ).toBeInTheDocument()
    expect(navigationStopMock).toHaveBeenCalled()
  })

  it('안내 중 로컬 저장 실패를 사용자에게 표시한다', () => {
    navigationState.isActive = true
    measurementState.isActive = true
    measurementState.status = 'recording'
    measurementState.localSaveStatus = 'failed'

    render(
      <MemoryRouter>
        <WalkingRoutePage />
      </MemoryRouter>,
    )

    expect(screen.getByText(/보행 기록 자동 저장 중/)).toHaveTextContent(
      '저장 실패',
    )
  })

  it('GPS가 불안정하고 ETA가 없으면 이해하기 쉬운 상태와 계산 불가를 표시한다', () => {
    navigationState.isActive = true
    navigationState.status = 'gps_unstable'
    navigationState.remainingDurationSeconds = null
    navigationState.remainingDistanceM = null
    navigationState.arrivalAt = null

    render(
      <MemoryRouter>
        <WalkingRoutePage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('region', { name: '실시간 도보 페이스' })).toBeInTheDocument()
    expect(screen.getByText('현재 위치와 속도를 확인하고 있어요.')).toBeInTheDocument()
    expect(screen.getByText('남은 도보 예상시간').nextElementSibling).toHaveTextContent('확인 중')
  })

  it('안내 중 남은 시간·거리·도착시각을 큰 핵심 영역에 표시한다', () => {
    navigationState.isActive = true
    navigationState.status = 'moving'
    navigationState.remainingDurationSeconds = 620
    navigationState.remainingDistanceM = 840
    navigationState.lastPositionAt = '2026-11-02T00:00:00.000Z'
    navigationState.arrivalAt = '2026-11-02T00:10:20.000Z'

    render(
      <MemoryRouter>
        <WalkingRoutePage />
      </MemoryRouter>,
    )

    expect(screen.getByText('남은 도보 예상시간')).toBeInTheDocument()
    expect(screen.getByText('10분 20초')).toBeInTheDocument()
    expect(screen.getByText('840 m')).toBeInTheDocument()
    expect(screen.getByText(/도보 도착 예상 오전 9:10/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '안내 종료' })).toBeInTheDocument()
  })

  it('안내 종료 시 연결된 측정 세션도 종료한다', async () => {
    navigationStartMock.mockImplementation(() => {
      navigationState.isActive = true
      return true
    })
    render(
      <MemoryRouter>
        <WalkingRoutePage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '서울역 출발 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '광화문 목적지 선택' }))
    fireEvent.click(await screen.findByRole('button', { name: '안내 시작' }))
    fireEvent.click(await screen.findByRole('button', { name: '안내 종료' }))

    await waitFor(() => expect(stopMeasurementMock).toHaveBeenCalledOnce())
    expect(navigationStopMock).toHaveBeenCalled()
  })

  it('안내 준비 중 종료해도 뒤늦게 생성된 측정 세션을 정리한다', async () => {
    const deferred: { resolve: (started: boolean) => void } = {
      resolve: vi.fn(),
    }
    startMeasurementMock.mockReturnValue(
      new Promise<boolean>((resolve) => {
        deferred.resolve = resolve
      }),
    )
    navigationStartMock.mockImplementation(() => {
      navigationState.isActive = true
      return true
    })
    render(
      <MemoryRouter>
        <WalkingRoutePage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '서울역 출발 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '광화문 목적지 선택' }))
    fireEvent.click(await screen.findByRole('button', { name: '안내 시작' }))
    fireEvent.click(await screen.findByRole('button', { name: '안내 종료' }))

    deferred.resolve(true)

    await waitFor(() => expect(stopMeasurementMock).toHaveBeenCalledOnce())
  })

  it('공통 좌표와 대중교통 결과를 탭 전환 동안 유지하고 좌표 변경 시 무효화한다', async () => {
    render(<MemoryRouter><WalkingRoutePage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '서울역 출발 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '광화문 목적지 선택' }))

    fireEvent.click(screen.getByRole('tab', { name: '대중교통' }))
    expect(screen.getByRole('heading', { name: '출발지' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '경로' })).toBeInTheDocument()
    expect(getKakaoTransitRoutesMock).toHaveBeenCalledOnce()
    expect(getKakaoTransitRoutesMock).toHaveBeenCalledWith({
      start: manualOrigin.coordinate,
      destination: destination.coordinate,
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }))

    fireEvent.click(screen.getByRole('tab', { name: '도보' }))
    fireEvent.click(screen.getByRole('tab', { name: '대중교통' }))
    expect(screen.getByRole('heading', { name: '경로' })).toBeInTheDocument()
    expect(getKakaoTransitRoutesMock).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: '시청역 출발 선택' }))
    await waitFor(() => expect(getKakaoTransitRoutesMock).toHaveBeenCalledTimes(2))
  })

  it('도보 경로 지도는 결과에서 사용자가 펼칠 때만 표시한다', async () => {
    render(<MemoryRouter><WalkingRoutePage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '서울역 출발 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '광화문 목적지 선택' }))

    const mapButton = await screen.findByRole('button', { name: '지도 보기' })
    expect(screen.queryByText('도보 경로 지도')).toBeNull()

    fireEvent.click(mapButton)
    expect(screen.getByText('도보 경로 지도')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '지도 접기' }))
    expect(screen.queryByText('도보 경로 지도')).toBeNull()
  })

  it('좌표 변경 전 대중교통 응답과 중복 클릭을 현재 결과로 반영하지 않는다', async () => {
    let resolveRequest: (value: typeof kakaoTransitResult) => void = vi.fn()
    getKakaoTransitRoutesMock.mockReset().mockReturnValueOnce(
      new Promise((resolve) => { resolveRequest = resolve }),
    ).mockResolvedValueOnce(kakaoTransitResult)
    render(<MemoryRouter><WalkingRoutePage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '서울역 출발 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '광화문 목적지 선택' }))
    fireEvent.click(screen.getByRole('tab', { name: '대중교통' }))

    await waitFor(() => expect(getKakaoTransitRoutesMock).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('tab', { name: '도보' }))
    fireEvent.click(screen.getByRole('tab', { name: '대중교통' }))
    expect(getKakaoTransitRoutesMock).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '시청역 출발 선택' }))
    await waitFor(() => expect(getKakaoTransitRoutesMock).toHaveBeenCalledTimes(2))
    resolveRequest(kakaoTransitResult)

    expect(await screen.findByRole('heading', { name: '경로' })).toBeInTheDocument()
    expect(getKakaoTransitRoutesMock).toHaveBeenLastCalledWith({
      start: secondOrigin.coordinate,
      destination: destination.coordinate,
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })
})

import { WalkingRoutePage } from './WalkingRoutePage'
