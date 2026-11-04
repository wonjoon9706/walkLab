import { describe, expect, it } from 'vitest'
import type { KakaoTransitRoute } from '../../domain/kakaoTransitRoute'
import type { TransitAccessWalk } from '../../domain/transitAccessWalk'
import type { TransitEgressWalk } from '../../domain/transitEgressWalk'
import { transitReferenceWalkPresentation } from '../../domain/transitMap'
import {
  createTransitReferenceWalkOverlay,
  toStationAccessComparisonItinerary,
  toTransitItineraryForMap,
} from './kakaoTransitRouteAdapter'

const start = { latitude: 37, longitude: 127 }
const boarding = { latitude: 37.001, longitude: 127.001 }
const alighting = { latitude: 37.01, longitude: 127.01 }
const destination = { latitude: 37.011, longitude: 127.011 }

const route: KakaoTransitRoute = {
  id: 'route',
  type: 'SUBWAY',
  totalDistanceM: 1_000,
  totalDurationSeconds: 600,
  transferCount: 0,
  fare: null,
  steps: [{
    index: 0,
    mode: 'SUBWAY',
    guidance: '7호선',
    distanceM: 1_000,
    durationSeconds: 600,
    stops: [{ index: 0, name: '승차역' }, { index: 1, name: '하차역' }],
    vehicles: [{ index: 0, name: '7호선', type: null }],
    coordinates: [boarding, alighting],
  }],
}

function accessWalk(): TransitAccessWalk {
  return {
    sourceRouteId: 'route', firstTransitStepIndex: 0, mode: 'SUBWAY',
    origin: { coordinate: start, verification: 'representative_coordinate', note: null },
    target: {
      mode: 'SUBWAY', boardingPointName: '승차역', routeName: '7호선',
      locationName: '승차역 1번출구', coordinate: boarding,
      source: 'kakao_place_subway_entrance', providerPlaceId: 'entrance',
      verification: 'explicit_subway_entrance', categoryName: '지하철출구',
      closureStatus: 'unknown', lineAccessStatus: 'unverified',
      selectionBasis: 'shortest_valid_external_walk', selectionConfidence: 'provisional',
      internalStationTimeIncluded: false,
    },
    walkingRoute: { distanceM: 100, providerDurationSeconds: 90, coordinates: [start, boarding], provider: 'kakao-walking-route', requestedAt: '2026-01-01T00:00:00.000Z' },
    endpointGapsM: { start: 0, destination: 0 }, endpointVerification: 'verified',
    pureWalkingDurationSeconds: 80,
    speedBasis: { kind: 'g7_default_fallback', speedMps: 1.25, modelVersion: 'default-v1', validSessionCount: 0, label: null },
    internalStationAccess: { status: 'unknown', durationSeconds: null },
    providerTransitTotalDurationSeconds: 600, personalizedTotalEtaSeconds: null,
    totalEtaStatus: 'not_calculated', totalEtaReason: 'PROVIDER_TIME_COMPONENTS_UNCONFIRMED',
  }
}

function egressWalk(): TransitEgressWalk {
  return {
    sourceRouteId: 'route', lastTransitStepIndex: 0, mode: 'SUBWAY',
    alightingPoint: {
      mode: 'SUBWAY', alightingPointName: '하차역', routeName: '7호선',
      locationName: '하차역 2번출구', coordinate: alighting,
      source: 'kakao_place_subway_entrance', providerPlaceId: 'exit',
      verification: 'explicit_subway_entrance', categoryName: '지하철출구',
      closureStatus: 'unknown', lineAccessStatus: 'unverified',
      selectionBasis: 'shortest_valid_external_walk', selectionConfidence: 'provisional',
      internalStationTimeIncluded: false,
    },
    destination: { name: '목적지', coordinate: destination, source: 'user_selected_place', providerPlaceId: 'destination' },
    walkingRoute: { distanceM: 120, providerDurationSeconds: 100, coordinates: [alighting, destination], provider: 'kakao-walking-route', requestedAt: '2026-01-01T00:00:00.000Z' },
    endpointGapsM: { start: 0, destination: 0 }, endpointVerification: 'verified',
    pureWalkingDurationSeconds: 96,
    speedBasis: { kind: 'g7_default_fallback', speedMps: 1.25, modelVersion: 'default-v1', validSessionCount: 0, label: null },
    internalStationEgress: { status: 'unknown', durationSeconds: null },
    providerTransitTotalDurationSeconds: 600, personalizedTotalEtaSeconds: null,
    totalEtaStatus: 'not_calculated', totalEtaReason: 'PROVIDER_TIME_COMPONENTS_UNCONFIRMED',
  }
}

describe('toTransitItineraryForMap', () => {
  it('검증 성공한 G8 접근·하차 polyline만 원본 카카오 경로 앞뒤에 추가한다', () => {
    const itinerary = toTransitItineraryForMap(route, accessWalk(), egressWalk())
    expect(itinerary.legs.map((leg) => leg.routeName)).toEqual([
      'G8 승차 접근 도보', '7호선', 'G8 목적지 도보',
    ])
    expect(itinerary.legs[0].coordinates).toEqual([start, boarding])
    expect(itinerary.legs[2].coordinates).toEqual([alighting, destination])
  })

  it('G8 검증 실패로 null이면 원본 카카오 polyline 외 직선을 생성하지 않는다', () => {
    const itinerary = toTransitItineraryForMap(route, null, null)
    expect(itinerary.legs).toHaveLength(1)
    expect(itinerary.legs[0].coordinates).toEqual([boarding, alighting])
  })

  it('스냅 초과 G8 polyline은 연결선을 만들지 않는 참고 오버레이로 보존한다', () => {
    const snappedStart = { latitude: 37.0105, longitude: 127.01 }
    const snappedEnd = { latitude: 37.0108, longitude: 127.0108 }
    const overlay = createTransitReferenceWalkOverlay({
      id: 'hwayang-reference',
      scope: 'egress',
      label: '화양사거리 하차 참고 경로',
      walkingRoute: {
        distanceM: 245,
        providerDurationSeconds: 220,
        coordinates: [snappedStart, snappedEnd],
        provider: 'kakao-walking-route',
        requestedAt: '2026-01-01T00:00:00.000Z',
      },
      requestedStart: alighting,
      requestedDestination: destination,
      startGapM: 57.2,
      destinationGapM: 37.7,
    })

    expect(overlay).toMatchObject({
      coordinates: [snappedStart, snappedEnd],
      requestedStart: alighting,
      requestedDestination: destination,
      startGapM: 57.2,
      destinationGapM: 37.7,
    })
    expect(overlay?.coordinates).not.toContain(alighting)
    expect(overlay?.coordinates).not.toContain(destination)
    expect(transitReferenceWalkPresentation.strokeStyle).toBe('dot')
    expect(new Set([
      transitReferenceWalkPresentation.requestedStartMarkerColor,
      transitReferenceWalkPresentation.routeStartMarkerColor,
      transitReferenceWalkPresentation.routeEndMarkerColor,
      transitReferenceWalkPresentation.requestedDestinationMarkerColor,
    ]).size).toBe(4)
  })

  it('G8 polyline이 비어 있으면 참고 오버레이를 만들지 않는다', () => {
    expect(createTransitReferenceWalkOverlay({
      id: 'invalid-reference',
      scope: 'egress',
      label: '유효하지 않은 경로',
      walkingRoute: {
        distanceM: 245,
        providerDurationSeconds: 220,
        coordinates: [],
        provider: 'kakao-walking-route',
        requestedAt: '2026-01-01T00:00:00.000Z',
      },
      requestedStart: alighting,
      requestedDestination: destination,
      startGapM: 57.2,
      destinationGapM: 37.7,
    })).toBeNull()
  })

  it('T2-4A 입력에서는 카카오 접근 WALK를 검증된 G8 접근으로 치환하고 후속 구간은 보존한다', () => {
    const busRoute: KakaoTransitRoute = {
      ...route,
      type: 'BUS_AND_SUBWAY',
      steps: [
        {
          index: 0,
          mode: 'WALKING',
          guidance: '공급자 접근 도보',
          distanceM: 50,
          durationSeconds: 60,
          stops: [],
          vehicles: [],
          coordinates: [start, boarding],
        },
        {
          index: 1,
          mode: 'BUS',
          guidance: '버스',
          distanceM: 500,
          durationSeconds: 180,
          stops: [{ index: 0, name: '승차정류장' }, { index: 1, name: '하차정류장' }],
          vehicles: [{ index: 0, name: '테스트17', type: '마을' }],
          coordinates: [boarding, alighting],
        },
        {
          index: 2,
          mode: 'WALKING',
          guidance: '역 접근',
          distanceM: 100,
          durationSeconds: 90,
          stops: [],
          vehicles: [],
          coordinates: [alighting, destination],
        },
        { ...route.steps[0], index: 3, coordinates: [destination, alighting] },
        { ...route.steps[0], index: 4, mode: 'BUS', guidance: '후속 버스' },
      ],
    }
    const busAccess = accessWalk()
    busAccess.mode = 'BUS'
    busAccess.target = {
      mode: 'BUS',
      boardingPointName: '승차정류장',
      routeName: '테스트17',
      locationName: '검증 정류장',
      coordinate: boarding,
      source: 'seoul_bus_stop',
      providerStopId: 'stop',
      arsId: 'ars',
      providerRouteId: 'route',
      verification: 'verified_bus_stop',
      directionVerification: 'route_stop_order',
    }

    const itinerary = toStationAccessComparisonItinerary(busRoute, busAccess)

    expect(itinerary?.legs.map((leg) => leg.mode)).toEqual([
      'WALK', 'BUS', 'WALK', 'SUBWAY', 'BUS',
    ])
    expect(itinerary?.legs[0].routeName).toBe('G8 승차 접근 도보')
  })
})
