import { describe, expect, it } from 'vitest'
import type { KakaoTransitRoute } from '../../domain/kakaoTransitRoute'
import type { AutomaticTransitAccessResult } from '../../domain/transitBoardingPoint'
import {
  createKakaoBusArrivalInfo,
  createKakaoSubwayArrivalRequest,
} from './kakaoTransitArrival'

const origin = { latitude: 37, longitude: 127 }
const stop = { latitude: 37.001, longitude: 127.001 }

function route(mode: 'SUBWAY' | 'BUS', vehicles: string[]): KakaoTransitRoute {
  return {
    id: `kakao-${mode}`,
    type: mode,
    totalDistanceM: 10_000,
    totalDurationSeconds: 2_000,
    transferCount: 0,
    fare: null,
    steps: [{
      index: 0,
      mode,
      guidance: 'test',
      distanceM: 9_000,
      durationSeconds: 1_800,
      stops: mode === 'SUBWAY'
        ? [
            { index: 0, name: '이수' },
            { index: 1, name: '내방' },
            { index: 2, name: '고속터미널' },
            { index: 3, name: '건대입구' },
          ]
        : [
            { index: 0, name: '극동상가' },
            { index: 1, name: '이수역' },
          ],
      vehicles: vehicles.map((name, index) => ({ index, name, type: null })),
      coordinates: [stop, { latitude: 37.01, longitude: 127.01 }],
    }],
  }
}

function busAccess(): AutomaticTransitAccessResult {
  return {
    status: 'ready',
    accessWalk: {
      sourceRouteId: 'kakao-BUS',
      firstTransitStepIndex: 0,
      mode: 'BUS',
      origin: { coordinate: origin, verification: 'searched_place', note: null },
      target: {
        mode: 'BUS', boardingPointName: '극동상가', routeName: '동작17',
        locationName: '극동상가', coordinate: stop, source: 'seoul_bus_stop',
        providerStopId: '119900256', arsId: '20502',
        providerRouteId: 'route-17', verification: 'verified_bus_stop',
        directionVerification: 'route_stop_order',
      },
      walkingRoute: {
        distanceM: 500, providerDurationSeconds: 420,
        coordinates: [origin, stop], provider: 'kakao-walking-route',
        requestedAt: '2026-11-04T00:00:00.000Z',
      },
      endpointGapsM: { start: 0, destination: 0 },
      endpointVerification: 'verified',
      pureWalkingDurationSeconds: 316,
      speedBasis: {
        kind: 'g7_personalized', speedMps: 1.58,
        modelVersion: 'recency-weighted-v1', validSessionCount: 8, label: null,
      },
      internalStationAccess: { status: 'not_applicable', durationSeconds: null },
      providerTransitTotalDurationSeconds: 2_000,
      personalizedTotalEtaSeconds: null,
      totalEtaStatus: 'not_calculated',
      totalEtaReason: 'PROVIDER_TIME_COMPONENTS_UNCONFIRMED',
    },
    busCandidates: [{
      stopId: '119900256', arsId: '20502', stopName: '극동상가',
      coordinate: stop, routeId: 'route-17', routeName: '동작17',
      distanceFromSearchAnchorM: 5, orderedStopNames: ['극동상가', '이수역'],
      walkingRouteStatus: 'available',
      walkingRoute: null,
      walkingDistanceM: 500,
      walkingProviderDurationSeconds: 420,
      startGapM: 0,
      destinationGapM: 0,
      walkingErrorCode: null,
      arrivalEstimates: [
        { order: 1, arrivalSeconds: 240, remainingStops: 2, message: null },
        { order: 2, arrivalSeconds: 720, remainingStops: 7, message: null },
      ],
      arrivalFetchedAt: '2026-11-04T00:00:00.000Z',
    }],
    busDiagnostics: null,
    subwayCandidates: [],
  }
}

describe('카카오 경로 실시간 도착정보 연결', () => {
  it('이수→내방 7호선을 공급자 ID 생성 없이 서울시 요청으로 변환한다', () => {
    expect(createKakaoSubwayArrivalRequest(route('SUBWAY', ['7호선'])))
      .toEqual({
        routeName: '7호선',
        routeType: null,
        trainType: 'normal',
        boardingStation: { providerStationId: null, name: '이수' },
        nextStation: { providerStationId: null, name: '내방' },
        alightingStation: { providerStationId: null, name: '건대입구' },
      })
  })

  it('복수 지하철 차량 후보를 임의로 선택하지 않는다', () => {
    expect(() => createKakaoSubwayArrivalRequest(
      route('SUBWAY', ['7호선', '7호선 급행']),
    )).toThrowError('카카오 지하철 노선 또는 승차·다음역 정보가 충분하지 않습니다.')
  })

  it('동작17 검증 과정의 서울시 도착정보와 G7 접근시간을 재사용한다', () => {
    const result = createKakaoBusArrivalInfo(busAccess())
    expect(result).toMatchObject({
      status: 'available',
      routeName: '동작17',
      stopName: '극동상가',
      stopId: '119900256',
      arrivalSeconds: 240,
      walkingTimeToStopSeconds: 316,
    })
    expect(result.status === 'available' && result.upcomingArrivals)
      .toHaveLength(2)
  })
})
