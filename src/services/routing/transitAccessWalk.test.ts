import { describe, expect, it } from 'vitest'
import type { KakaoTransitRoute } from '../../domain/kakaoTransitRoute'
import type { TransitAccessTarget } from '../../domain/transitAccessWalk'
import type { WalkingSpeedModel } from '../../domain/walkingSpeedModel'
import type { GeoCoordinate, WalkingRoute } from '../../domain/walkingRoute'
import { buildTransitAccessWalk } from './transitAccessWalk'

const origin: GeoCoordinate = { latitude: 37, longitude: 127 }
const destination: GeoCoordinate = { latitude: 37.0005, longitude: 127.0005 }

function createRoute(
  mode: 'BUS' | 'SUBWAY' = 'SUBWAY',
  vehicleNames: string[] = [mode === 'SUBWAY' ? '7호선' : '동작17'],
): KakaoTransitRoute {
  return {
    id: 'synthetic-route',
    type: mode,
    totalDistanceM: 4_000,
    totalDurationSeconds: 1_800,
    transferCount: 0,
    fare: null,
    steps: [{
      index: 0,
      mode,
      guidance: 'synthetic',
      distanceM: 3_000,
      durationSeconds: 900,
      stops: mode === 'SUBWAY'
        ? [{ index: 0, name: '이수' }, { index: 1, name: '내방' }]
        : [{ index: 0, name: '극동상가' }, { index: 1, name: '다음정류장' }],
      vehicles: vehicleNames.map((name, index) => ({ index, name, type: null })),
      coordinates: [origin, destination],
    }],
  }
}

function createWalkingRoute(distanceM = 1_140): WalkingRoute {
  return {
    distanceM,
    providerDurationSeconds: 1_000,
    coordinates: [origin, destination],
    provider: 'kakao-walking-route',
    requestedAt: '2026-01-01T00:00:00.000Z',
  }
}

function createReadyModel(): WalkingSpeedModel {
  return {
    algorithmVersion: 'recency-weighted-v1',
    status: 'ready',
    estimatedSpeedMps: 1.5,
    simpleAverageSpeedMps: 1.45,
    validSessionCount: 8,
    windowDays: 30,
    trainingPeriodStart: '2025-12-01T00:00:00.000Z',
    trainingPeriodEnd: '2025-12-31T00:00:00.000Z',
    lastUpdatedAt: '2026-01-01T00:00:00.000Z',
    calculatedAt: '2026-01-01T00:00:00.000Z',
    estimatedOneKilometerSeconds: 667,
    decisions: [],
  }
}

const subwayTarget: TransitAccessTarget = {
  mode: 'SUBWAY',
  boardingPointName: '이수역',
  routeName: '7호선',
  locationName: '이수역 7호선 확인 출입구',
  coordinate: destination,
  source: 'kakao_place_subway_entrance',
  providerPlaceId: 'synthetic-place-id',
  verification: 'explicit_subway_entrance',
  categoryName: '교통,수송 > 지하철,전철 > 지하철출구',
  closureStatus: 'unknown',
  lineAccessStatus: 'unverified',
  selectionBasis: 'shortest_valid_external_walk',
  selectionConfidence: 'provisional',
  internalStationTimeIncluded: false,
}

const busTarget: TransitAccessTarget = {
  mode: 'BUS',
  boardingPointName: '극동상가',
  routeName: '동작17',
  locationName: '극동상가 승차 정류장',
  coordinate: destination,
  source: 'seoul_bus_stop',
  providerStopId: 'synthetic-stop-id',
  arsId: 'synthetic-ars-id',
  providerRouteId: 'synthetic-route-id',
  verification: 'verified_bus_stop',
  directionVerification: 'route_stop_order',
}

describe('buildTransitAccessWalk', () => {
  it('지하철 출입구 접근 도보와 공급자 전체시간을 분리한다', () => {
    const route = createRoute()
    const originalRoute = structuredClone(route)
    const result = buildTransitAccessWalk({
      route,
      origin: {
        coordinate: origin,
        verification: 'representative_coordinate',
        note: '실제 건물 출입구 미확인',
      },
      target: subwayTarget,
      walkingRoute: createWalkingRoute(),
      speed: { kind: 'g7_model', model: createReadyModel() },
    })

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.accessWalk.pureWalkingDurationSeconds).toBe(760)
    expect(result.accessWalk.speedBasis.kind).toBe('g7_personalized')
    expect(result.accessWalk.internalStationAccess).toEqual({
      status: 'unknown',
      durationSeconds: null,
    })
    expect(result.accessWalk.providerTransitTotalDurationSeconds).toBe(1_800)
    expect(result.accessWalk.personalizedTotalEtaSeconds).toBeNull()
    expect(route).toEqual(originalRoute)
  })

  it('확정된 버스 정류장 접근 도보를 만들고 이후 원본 경로를 변경하지 않는다', () => {
    const route = createRoute('BUS')
    const result = buildTransitAccessWalk({
      route,
      origin: {
        coordinate: origin,
        verification: 'representative_coordinate',
        note: null,
      },
      target: busTarget,
      walkingRoute: createWalkingRoute(105),
      speed: { kind: 'reference_only', speedMps: 1.5, label: '테스트 참고값' },
    })

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.accessWalk.pureWalkingDurationSeconds).toBe(70)
    expect(result.accessWalk.speedBasis.kind).toBe('reference_only')
    expect(result.accessWalk.target).toMatchObject({
      source: 'seoul_bus_stop',
      providerStopId: 'synthetic-stop-id',
    })
    expect(result.accessWalk.internalStationAccess.status).toBe('not_applicable')
    expect(route.steps).toHaveLength(1)
  })

  it('G7 모델이 없으면 기존 기본속도 fallback을 명시한다', () => {
    const result = buildTransitAccessWalk({
      route: createRoute(),
      origin: { coordinate: origin, verification: 'representative_coordinate', note: null },
      target: subwayTarget,
      walkingRoute: createWalkingRoute(),
      speed: { kind: 'g7_model', model: null },
    })

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.accessWalk.speedBasis.kind).toBe('g7_default_fallback')
    expect(result.accessWalk.speedBasis.modelVersion).toBe('default-v1')
  })

  it('복수 차량 후보를 임의 선택하지 않는다', () => {
    const result = buildTransitAccessWalk({
      route: createRoute('BUS', ['동작17', '동작17-1']),
      origin: { coordinate: origin, verification: 'representative_coordinate', note: null },
      target: busTarget,
      walkingRoute: createWalkingRoute(),
      speed: { kind: 'g7_model', model: null },
    })

    expect(result).toEqual({
      status: 'review_required',
      reason: 'MULTIPLE_VEHICLE_OPTIONS',
    })
  })

  it('승차 지점 이름이나 노선이 다르면 연결하지 않는다', () => {
    const wrongStop = buildTransitAccessWalk({
      route: createRoute('BUS'),
      origin: { coordinate: origin, verification: 'representative_coordinate', note: null },
      target: { ...busTarget, boardingPointName: '다른정류장' },
      walkingRoute: createWalkingRoute(),
      speed: { kind: 'g7_model', model: null },
    })
    const wrongRoute = buildTransitAccessWalk({
      route: createRoute('BUS'),
      origin: { coordinate: origin, verification: 'representative_coordinate', note: null },
      target: { ...busTarget, routeName: '다른노선' },
      walkingRoute: createWalkingRoute(),
      speed: { kind: 'g7_model', model: null },
    })

    expect(wrongStop).toEqual({
      status: 'review_required',
      reason: 'BOARDING_NAME_MISMATCH',
    })
    expect(wrongRoute).toEqual({
      status: 'review_required',
      reason: 'ROUTE_NAME_MISMATCH',
    })
  })

  it('G8 시작·종료 스냅 오차가 30m를 넘으면 검토 상태로 둔다', () => {
    const result = buildTransitAccessWalk({
      route: createRoute(),
      origin: { coordinate: origin, verification: 'representative_coordinate', note: null },
      target: subwayTarget,
      walkingRoute: {
        ...createWalkingRoute(),
        coordinates: [
          { latitude: 37.01, longitude: 127.01 },
          destination,
        ],
      },
      speed: { kind: 'g7_model', model: null },
    })

    expect(result).toEqual({
      status: 'review_required',
      reason: 'WALKING_ENDPOINT_MISMATCH',
    })
  })
})
