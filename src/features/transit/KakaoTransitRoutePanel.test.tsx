import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KakaoTransitRouteResult } from '../../domain/kakaoTransitRoute'
import type { WalkingSpeedModel } from '../../domain/walkingSpeedModel'
import { createKakaoTransitRouteClient, kakaoTransitRouteClient } from '../../services/routing/kakaoTransitRouteClient'
import { KakaoTransitRoutePanel } from './KakaoTransitRoutePanel'

vi.mock('./useTransitAccessRecording', () => ({
  useTransitAccessRecording: () => ({
    isActive: false,
    state: { phase: 'idle', routeId: null, currentPosition: null, message: null },
    start: startRecordingMock, finish: vi.fn(),
  }),
}))

const { resolveAccessMock, resolveEgressMock, getRouteArrivalsMock, getSubwayArrivalMock, startRecordingMock } = vi.hoisted(() => ({
  resolveAccessMock: vi.fn(),
  resolveEgressMock: vi.fn(),
  getRouteArrivalsMock: vi.fn(),
  getSubwayArrivalMock: vi.fn(),
  startRecordingMock: vi.fn(),
}))

vi.mock('../../services/routing/seoulBusEvidenceClient', () => ({
  seoulBusEvidenceClient: { getRouteArrivals: getRouteArrivalsMock },
}))
vi.mock('../../services/transitArrival/subwayArrivalClient', () => ({
  subwayArrivalClient: { getSubwayArrival: getSubwayArrivalMock },
}))

vi.mock('../../services/routing/automaticTransitAccess', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/routing/automaticTransitAccess')>(),
  resolveAutomaticTransitAccess: resolveAccessMock,
}))
vi.mock('../../services/routing/automaticTransitEgress', () => ({
  resolveAutomaticTransitEgress: resolveEgressMock,
}))
vi.mock('../../services/routing/kakaoTransitArrival', () => ({
  createKakaoBusArrivalInfo: vi.fn(() => ({
    routeName: '테스트 버스', stopName: '테스트 정류장', stopId: 'stop',
    arrivalSeconds: 360, remainingStops: 3,
    upcomingArrivals: [{
      order: 1, arrivalSeconds: 360, remainingStops: 3, message: null,
      serviceStatus: 'in_service', arrivalTimeStatus: 'estimated',
    }],
    fetchedAt: new Date().toISOString(), provider: 'seoul', dataMode: 'live',
    status: 'available', walkingTimeToStopSeconds: null,
  })),
  createKakaoSubwayArrivalRequest: vi.fn(() => ({})),
}))
vi.mock('../map/TransitRouteMap', () => ({
  TransitRouteMap: ({ referenceWalks = [] }: { referenceWalks?: unknown[] }) => <>
    <div>선택 경로 지도</div><span data-testid="reference-walk-count">{referenceWalks.length}</span>
  </>,
}))

const origin = { latitude: 37, longitude: 127 }
const destinationCoordinate = { latitude: 37.1, longitude: 127.1 }
const accessCoordinate = { latitude: 37.01, longitude: 127.01 }
const egressCoordinate = { latitude: 37.09, longitude: 127.09 }

const result: KakaoTransitRouteResult = {
  provider: 'kakao-map-publictraffic',
  requestedAt: '2026-11-04T00:00:00.000Z',
  reportedRouteCounts: { total: 1, bus: 0, subway: 0, busAndSubway: 1 },
  rejectedRoutes: [],
  routes: [{
    id: 'route', type: 'BUS_AND_SUBWAY', totalDistanceM: 10_000,
    totalDurationSeconds: 2_000, transferCount: 1, fare: null,
    steps: [
      {
        index: 0, mode: 'BUS', guidance: '버스', distanceM: 2_000,
        durationSeconds: 500, stops: [], vehicles: [], coordinates: [],
      },
      {
        index: 1, mode: 'WALKING', guidance: '환승 도보', distanceM: 600,
        durationSeconds: 600, stops: [], vehicles: [], coordinates: [],
      },
      {
        index: 2, mode: 'SUBWAY', guidance: '지하철', distanceM: 7_400,
        durationSeconds: 600, stops: [], vehicles: [], coordinates: [],
      },
    ],
  }],
}

function walkingRoute(
  distanceM: number,
  providerDurationSeconds: number,
  start: typeof origin,
  destination: typeof origin,
) {
  return {
    distanceM,
    providerDurationSeconds,
    coordinates: [start, destination],
    provider: 'kakao-walking-route' as const,
    requestedAt: '2026-11-04T00:00:00.000Z',
  }
}

const accessResult = {
  status: 'ready' as const,
  accessWalk: {
    sourceRouteId: 'route', firstTransitStepIndex: 0, mode: 'BUS' as const,
    origin: { coordinate: origin, verification: 'searched_place' as const, note: null },
    target: {
      mode: 'BUS' as const, boardingPointName: '첫 정류장', routeName: '테스트 버스',
      locationName: '첫 정류장', coordinate: accessCoordinate,
      source: 'seoul_bus_stop' as const, providerStopId: 'stop', arsId: '10001',
      providerRouteId: 'route-id', verification: 'verified_bus_stop' as const,
      directionVerification: 'route_stop_order' as const,
    },
    walkingRoute: walkingRoute(300, 200, origin, accessCoordinate),
    endpointGapsM: { start: 0, destination: 0 }, endpointVerification: 'verified' as const,
    pureWalkingDurationSeconds: 150,
    speedBasis: {
      kind: 'g7_personalized' as const, speedMps: 2,
      modelVersion: 'recency-weighted-v1' as const, validSessionCount: 9, label: null,
    },
    internalStationAccess: { status: 'not_applicable' as const, durationSeconds: null },
    providerTransitTotalDurationSeconds: 2_000, personalizedTotalEtaSeconds: null,
    totalEtaStatus: 'not_calculated' as const,
    totalEtaReason: 'PROVIDER_TIME_COMPONENTS_UNCONFIRMED' as const,
  },
  busCandidates: [{
    stopId: 'stop', arsId: '10001', stopName: '첫 정류장', coordinate: accessCoordinate,
    routeId: 'route-id', routeName: '테스트 버스', distanceFromSearchAnchorM: 10,
    orderedStopNames: ['첫 정류장', '다음 정류장'],
    walkingRouteStatus: 'available' as const, walkingRoute: walkingRoute(300, 200, origin, accessCoordinate),
    walkingDistanceM: 300, walkingProviderDurationSeconds: 200, startGapM: 0, destinationGapM: 0,
    walkingErrorCode: null, arrivalEstimates: [], arrivalFetchedAt: null as string | null,
  }], busDiagnostics: null, subwayCandidates: [],
}

const egressResult = {
  status: 'ready' as const,
  egressWalk: {
    sourceRouteId: 'route', lastTransitStepIndex: 2, mode: 'SUBWAY' as const,
    alightingPoint: {
      mode: 'SUBWAY' as const, alightingPointName: '마지막 역', routeName: '7호선',
      locationName: '마지막 역 1번출구', coordinate: egressCoordinate,
      source: 'kakao_place_subway_entrance' as const, providerPlaceId: 'exit',
      verification: 'explicit_subway_entrance' as const, categoryName: '지하철역출구',
      closureStatus: 'unknown' as const, lineAccessStatus: 'unverified' as const,
      selectionBasis: 'shortest_valid_external_walk' as const,
      selectionConfidence: 'provisional' as const, internalStationTimeIncluded: false as const,
    },
    destination: {
      name: '목적지', coordinate: destinationCoordinate,
      source: 'user_selected_place' as const, providerPlaceId: 'destination',
    },
    walkingRoute: walkingRoute(200, 150, egressCoordinate, destinationCoordinate),
    endpointGapsM: { start: 0, destination: 0 }, endpointVerification: 'verified' as const,
    pureWalkingDurationSeconds: 100,
    speedBasis: {
      kind: 'g7_personalized' as const, speedMps: 2,
      modelVersion: 'recency-weighted-v1' as const, validSessionCount: 9, label: null,
    },
    internalStationEgress: { status: 'unknown' as const, durationSeconds: null },
    providerTransitTotalDurationSeconds: 2_000, personalizedTotalEtaSeconds: null,
    totalEtaStatus: 'not_calculated' as const,
    totalEtaReason: 'PROVIDER_TIME_COMPONENTS_UNCONFIRMED' as const,
  },
  busCandidates: [], subwayCandidates: [],
}

function speedModel(speedMps: number): WalkingSpeedModel {
  return {
    algorithmVersion: 'recency-weighted-v1', status: 'ready',
    estimatedSpeedMps: speedMps, simpleAverageSpeedMps: speedMps,
    validSessionCount: 9, windowDays: 30,
    trainingPeriodStart: null, trainingPeriodEnd: null,
    lastUpdatedAt: null, calculatedAt: '2026-11-04T00:00:00.000Z',
    estimatedOneKilometerSeconds: 1_000 / speedMps, decisions: [],
  }
}

function renderPanel(strict = false) {
  const panel = (
    <KakaoTransitRoutePanel
      active
      origin={origin}
      originSource="searched_place"
      destination={{
        id: 'destination', name: '목적지', address: '주소', roadAddress: null,
        coordinate: destinationCoordinate,
      }}
      speedModel={speedModel(2)}
    />
  )
  return render(
    strict ? <StrictMode>{panel}</StrictMode> : panel,
  )
}

describe('카카오 개인화 ETA 화면 연결', () => {
  beforeEach(() => {
    startRecordingMock.mockReset()
    getRouteArrivalsMock.mockReset().mockResolvedValue([
      { routeId: 'route-id', stopId: 'stop', stopName: '첫 정류장', sequence: 1, estimates: [] },
      { routeId: 'route-id', stopId: 'next', stopName: '다음 정류장', sequence: 2, estimates: [] },
    ])
    getSubwayArrivalMock.mockReset()
    accessResult.busCandidates[0].arrivalFetchedAt = new Date().toISOString()
    resolveAccessMock.mockReset().mockResolvedValue(accessResult)
    resolveEgressMock.mockReset().mockResolvedValue(egressResult)
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

  it('실제 복수 차량 Egress 결과를 점선 지도·부분 ETA에 사용하고 GPS 목표로 승격하지 않는다', async () => {
    const { resolveAutomaticTransitEgress } = await vi.importActual<typeof import('../../services/routing/automaticTransitEgress')>(
      '../../services/routing/automaticTransitEgress')
    const inputRoute: KakaoTransitRouteResult['routes'][number] = { ...result.routes[0], steps: [{
      index: 0, mode: 'BUS', guidance: '17 / 18', distanceM: 1_000, durationSeconds: 600,
      coordinates: [origin, egressCoordinate], stops: [{ index: 0, name: '승차' }, { index: 1, name: '하차' }],
      vehicles: [{ index: 0, name: '17', type: null }, { index: 1, name: '18', type: null }],
    }] }
    const reference = await resolveAutomaticTransitEgress({ route: inputRoute,
      destination: { name: '목적지', coordinate: destinationCoordinate, source: 'user_selected_place', providerPlaceId: null },
      speed: { kind: 'g7_model', model: speedModel(2) }, signal: new AbortController().signal,
    }, {
      seoulBusProvider: { getNearbyStops: async () => [], getRoutesAtStop: async () => [], getRouteArrivals: async () => [] },
      searchPlaces: async () => [],
      getWalkingRoute: async ({ start, destination }) => walkingRoute(400, 300, start, destination),
    })
    resolveAccessMock.mockResolvedValue({ status: 'review_required', reason: 'MULTIPLE_VEHICLE_OPTIONS',
      busCandidates: [], subwayCandidates: [], busDiagnostics: null })
    resolveEgressMock.mockResolvedValue(reference)
    vi.spyOn(kakaoTransitRouteClient, 'getTransitRoutes').mockResolvedValue({ ...result, routes: [inputRoute] })
    renderPanel()
    await screen.findByText('부분 개인화 참고')
    const duration = document.querySelector('.transit-option-time strong')?.textContent
    fireEvent.click(screen.getByText('경로 1').closest('button')!)
    expect(screen.getByTestId('reference-walk-count')).toHaveTextContent('1')
    expect(screen.getByText('하차 후 추정 도보')).toBeInTheDocument()
    expect(document.querySelector('.primary-summary dd')?.textContent).toBe(duration)
    fireEvent.click(screen.getByRole('button', { name: '안내 시작' }))
    expect(startRecordingMock).toHaveBeenCalledWith(inputRoute.id, null)
  })

  it('실제 앱과 같은 StrictMode 재설정 후에도 요청 결과를 표시한다', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(result)))
    const client = createKakaoTransitRouteClient({ fetch, getAccessToken: async () => 'test-token' })
    vi.spyOn(kakaoTransitRouteClient, 'getTransitRoutes').mockImplementation(client.getTransitRoutes)
    renderPanel(true)
    expect(await screen.findByRole('heading', { name: '경로' })).toBeInTheDocument()
    expect(screen.queryByText('대중교통 경로를 찾고 있습니다.')).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0][0]).toBe('/api/kakao/transit-routes')
  })

  it('인증 대기가 끝나지 않으면 무한 로딩 대신 인증 시간초과와 재검색을 표시한다', async () => {
    vi.useFakeTimers()
    try {
      const fetch = vi.fn()
      const client = createKakaoTransitRouteClient({
        fetch, getAccessToken: () => new Promise(() => undefined),
      })
      vi.spyOn(kakaoTransitRouteClient, 'getTransitRoutes').mockImplementation(client.getTransitRoutes)
      renderPanel()
      expect(screen.getByText('검색 단계: 로그인 인증 확인')).toBeInTheDocument()
      await act(async () => vi.advanceTimersByTimeAsync(25_000))
      expect(screen.getByRole('alert')).toHaveTextContent('로그인 인증 확인 시간이 초과')
      expect(screen.getByRole('button', { name: '다시 검색' })).toBeInTheDocument()
      expect(screen.queryByText('대중교통 경로를 찾고 있습니다.')).not.toBeInTheDocument()
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('자동 검색 후 계산 상태를 표시하고 모든 G8 결과를 목록·상세에서 재사용한다', async () => {
    let finishAccess: (value: typeof accessResult) => void = () => undefined
    let finishEgress: (value: typeof egressResult) => void = () => undefined
    resolveAccessMock.mockReturnValueOnce(new Promise((resolve) => { finishAccess = resolve }))
    resolveEgressMock.mockReturnValueOnce(new Promise((resolve) => { finishEgress = resolve }))
    vi.spyOn(kakaoTransitRouteClient, 'getTransitRoutes').mockResolvedValue(result)
    renderPanel()

    expect(await screen.findByText('33분 20초')).toBeInTheDocument()
    expect(screen.getByText(/개인화 계산 중/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '카카오 대중교통 경로 검색' })).not.toBeInTheDocument()

    await act(async () => {
      finishAccess(accessResult)
      finishEgress(egressResult)
    })

    expect(await screen.findByText('26분 40초')).toBeInTheDocument()
    expect(startRecordingMock).not.toHaveBeenCalled()
    expect(screen.getByText(/도보 1.10 km/)).toBeInTheDocument()
    expect(await screen.findByText(/1번째 정보 · 6분 후 · 탑승 가능성 높음/)).toBeInTheDocument()
    expect(screen.getByLabelText('이동 수단 순서').textContent).toMatch(/^도보.*BUS.*도보.*SUBWAY.*도보$/)
    expect(screen.queryByRole('button', { name: /다른 경로.*더보기/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /경로 1/ }))

    expect(await screen.findByText('선택 경로 지도')).toBeInTheDocument()
    expect(startRecordingMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '안내 시작' }))
    expect(startRecordingMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText('출발 도보')).toBeInTheDocument()
    expect(screen.getByText('하차 후 도보')).toBeInTheDocument()
    expect(resolveAccessMock).toHaveBeenCalledTimes(1)
    expect(resolveEgressMock).toHaveBeenCalledTimes(1)
    expect(getRouteArrivalsMock).toHaveBeenCalledTimes(1)

    const refresh = screen.getByRole('button', { name: '도착정보 새로고침' })
    expect(refresh.closest('li')).toHaveTextContent('1번째 정보 · 6분 후')
    expect(screen.queryByRole('heading', { name: '첫 승차 실시간 도착정보' })).not.toBeInTheDocument()
    fireEvent.click(refresh)
    await screen.findByText(/1번째 정보 · 6분 후/)
    fireEvent.click(screen.getByRole('button', { name: '경로 목록' }))

    expect(screen.getByText('26분 40초')).toBeInTheDocument()
    expect(screen.getByText(/1번째 정보 · 6분 후 · 탑승 가능성 높음/)).toBeInTheDocument()
  })

  it('자동 검색 실패 시에만 다시 검색 버튼을 제공한다', async () => {
    vi.spyOn(kakaoTransitRouteClient, 'getTransitRoutes')
      .mockRejectedValueOnce(new Error('검색 실패'))
      .mockResolvedValueOnce(result)
    renderPanel()

    expect(await screen.findByRole('alert')).toHaveTextContent('검색 실패')
    fireEvent.click(screen.getByRole('button', { name: '다시 검색' }))

    expect(await screen.findByRole('heading', { name: '경로' })).toBeInTheDocument()
    expect(kakaoTransitRouteClient.getTransitRoutes).toHaveBeenCalledTimes(2)
  })

  it.each([true, false])('DEV=%s에서도 3개 카드·12개 더보기·선택 계산 캐시를 유지한다', async (dev) => {
    vi.stubEnv('DEV', dev)
    vi.stubEnv('PROD', !dev)
    const routes = Array.from({ length: 15 }, (_, index) => ({
      ...result.routes[0],
      id: `route-${index}`,
      totalDurationSeconds: 2_000 + index * 10,
    }))
    let finishAccess: (value: typeof accessResult) => void = () => undefined
    const pendingAccess = new Promise<typeof accessResult>((resolve) => { finishAccess = resolve })
    resolveAccessMock.mockReturnValue(pendingAccess)
    vi.spyOn(kakaoTransitRouteClient, 'getTransitRoutes').mockResolvedValue({ ...result, routes })
    renderPanel()

    await screen.findByText('경로 1')
    expect(screen.queryByText('경로 15')).not.toBeInTheDocument()
    expect(document.querySelectorAll('.kakao-route-option')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: '다른 경로 12개 더보기' }))
    expect(document.querySelectorAll('.kakao-route-option')).toHaveLength(15)
    expect(screen.getAllByText('카카오 기본 · 선택 시 개인화')).toHaveLength(12)
    expect(getRouteArrivalsMock).not.toHaveBeenCalled()
    expect(resolveAccessMock).toHaveBeenCalledTimes(2)
    await act(async () => finishAccess(accessResult))
    await waitFor(() => expect(resolveAccessMock).toHaveBeenCalledTimes(3))
    await screen.findByText('우선 개인화 완료 · 총 15개')
    expect(resolveEgressMock).toHaveBeenCalledTimes(3)
    await waitFor(() => expect(getRouteArrivalsMock).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('경로 15').closest('button')!)
    await waitFor(() => expect(resolveAccessMock).toHaveBeenCalledTimes(4))
    await screen.findByText('선택 경로 지도')
    fireEvent.click(screen.getByRole('button', { name: '경로 목록' }))
    fireEvent.click(screen.getByText('경로 15').closest('button')!)
    expect(resolveAccessMock).toHaveBeenCalledTimes(4)
    expect(resolveEgressMock).toHaveBeenCalledTimes(4)
    expect(screen.queryByRole('button', { name: '다른 경로 12개 더보기' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '경로 목록' }))
    expect(screen.getByRole('button', { name: '다른 경로 접기' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: '다른 경로 접기' }))
    expect(document.querySelectorAll('.kakao-route-option')).toHaveLength(3)
    expect(resolveAccessMock).toHaveBeenCalledTimes(4)
    expect(kakaoTransitRouteClient.getTransitRoutes).toHaveBeenCalledTimes(1)
    expect(getRouteArrivalsMock).toHaveBeenCalledTimes(1)
  })

  it('우선 후보가 모두 계산된 뒤에만 개인화 시간 순으로 추천한다', async () => {
    const routes = [0, 1, 2].map((index) => ({ ...result.routes[0], id: `route-${index}` }))
    resolveAccessMock.mockImplementation(async ({ route }: { route: { id: string } }) => ({
      ...accessResult,
      accessWalk: { ...accessResult.accessWalk,
        walkingRoute: { ...accessResult.accessWalk.walkingRoute,
          distanceM: route.id === 'route-0' ? 4_000 : route.id === 'route-1' ? 100 : 200 },
      },
    }))
    let finish: (value: typeof egressResult) => void = () => undefined
    const pending = new Promise<typeof egressResult>((resolve) => { finish = resolve })
    resolveEgressMock.mockImplementation(({ route }: { route: { id: string } }) =>
      route.id === 'route-0' ? pending : Promise.resolve(egressResult))
    vi.spyOn(kakaoTransitRouteClient, 'getTransitRoutes').mockResolvedValue({ ...result, routes })
    renderPanel()
    await screen.findByText('우선 개인화 2/3')
    expect(screen.queryByText(/우선 후보 추천/)).not.toBeInTheDocument()
    await act(async () => finish(egressResult))
    await screen.findByText('우선 후보 추천 1')
    expect([...document.querySelectorAll('.kakao-route-option .transit-option-heading > span:first-child')]
      .map((item) => item.textContent)).toEqual(['경로 2', '경로 3', '경로 1'])
  })

  it('실시간 조회 실패가 경로 목록과 상세 선택을 막지 않는다', async () => {
    getRouteArrivalsMock.mockRejectedValue(new Error('API failure'))
    vi.spyOn(kakaoTransitRouteClient, 'getTransitRoutes').mockResolvedValue(result)
    renderPanel()
    await screen.findByText(/실시간 제공기관 조회 실패/)
    fireEvent.click(screen.getByText('경로 1').closest('button')!)
    expect(await screen.findByText('선택 경로 지도')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '도착정보 새로고침' })).toBeEnabled()
  })

  it('접근 G8만 있으면 목록과 상세에 같은 부분 개인화 시간과 미반영 구간을 표시한다', async () => {
    resolveEgressMock.mockResolvedValue({
      status: 'review_required', reason: 'NO_VERIFIED_BUS_STOP', busCandidates: [], subwayCandidates: [],
    })
    vi.spyOn(kakaoTransitRouteClient, 'getTransitRoutes').mockResolvedValue(result)
    renderPanel()
    const message = '출발 도보만 반영한 참고시간입니다. 하차 후 도보는 미반영입니다.'
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.getByText('부분 개인화 참고')).toBeInTheDocument()
    const duration = document.querySelector('.transit-option-time strong')?.textContent
    fireEvent.click(screen.getByText('경로 1').closest('button')!)
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(document.querySelector('.primary-summary dd')?.textContent).toBe(duration)
  })

  it('양쪽 G8 성공은 기존 개인화 추정을 유지하고 단일 하차 스냅 실패는 참고선으로 지도에 전달한다', async () => {
    vi.spyOn(kakaoTransitRouteClient, 'getTransitRoutes').mockResolvedValue(result)
    resolveEgressMock.mockResolvedValue({ status: 'review_required', reason: 'NO_VERIFIED_SUBWAY_EXIT',
      detailReason: 'WALKING_ENDPOINT_MISMATCH', busCandidates: [],
      subwayCandidates: [{ place: { id: 'exit', name: '출구', coordinate: egressCoordinate },
        walkingRoute: walkingRoute(400, 300, egressCoordinate, destinationCoordinate),
        walkingRouteStatus: 'available', startGapM: 50, destinationGapM: 0 }],
    })
    renderPanel()
    await screen.findByText('개인화 추정')
    expect(screen.queryByText('부분 개인화 참고')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('경로 1').closest('button')!)
    expect(screen.getByTestId('reference-walk-count')).toHaveTextContent('1')
    expect(screen.getByText('하차 후 추정 도보')).toBeInTheDocument()
  })

  it('상세 개인화 조회 실패 후에도 기본 경로와 지도 선택을 유지한다', async () => {
    resolveAccessMock.mockRejectedValue(new Error('network'))
    resolveEgressMock.mockRejectedValue(new Error('network'))
    vi.spyOn(kakaoTransitRouteClient, 'getTransitRoutes').mockResolvedValue(result)
    renderPanel()
    await screen.findByText('부분 개인화 참고')
    fireEvent.click(screen.getByText('경로 1').closest('button')!)
    expect(await screen.findByText('선택 경로 지도')).toBeInTheDocument()
    expect(resolveAccessMock).toHaveBeenCalledTimes(1)
  })
})
