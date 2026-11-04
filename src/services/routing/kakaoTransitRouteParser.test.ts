import { describe, expect, it } from 'vitest'
import { KakaoTransitResponseError } from '../../domain/kakaoTransitRoute'
import { diagnoseKakaoTransitRoute } from './kakaoTransitRouteDiagnostics'
import { parseKakaoTransitRouteResponse } from './kakaoTransitRouteParser'

// 실제 API 원문이 아닌 공식 routes/steps 스키마 검증용 합성 fixture다.
const schemaFixture = {
  status: 'OK',
  properties: {
    total: 3,
    bus: 1,
    subway: 1,
    busAndSubway: 1,
    landingURL: 'https://map.kakao.com/example',
  },
  routes: [
    {
      properties: {
        type: 'BUS_AND_SUBWAY',
        totalDistance: 10_200,
        totalTime: 2_100,
        transfers: 1,
        fare: { value: 1_550 },
      },
      steps: [
        {
          properties: {
            guidance: '마을 동작17 (출발정류장 > 이수역)',
            type: 'BUS',
            distance: 1_200,
            time: 480,
            stops: [
              { name: '출발정류장' },
              { name: '중간정류장' },
              { name: '이수역' },
            ],
            vehicles: [
              { name: '동작17', type: '마을' },
              { name: '동작18', type: '마을' },
            ],
          },
          path: {
            points: [
              [126.9735, 37.4917],
              [126.98, 37.5],
            ],
          },
        },
        {
          properties: {
            guidance: '7호선 (이수 > 건대입구)',
            type: 'SUBWAY',
            distance: 8_700,
            time: 1_200,
            stops: [
              { name: '이수' },
              { name: '내방' },
              { name: '건대입구' },
            ],
            vehicles: [{ name: '7호선', type: '일반' }],
          },
          path: {
            points: [
              [126.981, 37.5],
              [127.06, 37.54],
            ],
          },
        },
        {
          properties: {
            guidance: '목적지까지 도보',
            type: 'WALKING',
            distance: 200,
            time: 180,
            stops: [],
            vehicles: [],
          },
          path: {
            points: [
              [127.06, 37.54],
              [127.064236, 37.547742],
            ],
          },
        },
      ],
    },
    {
      properties: {
        type: 'SUBWAY',
        totalDistance: 9_000,
        totalTime: 1_500,
        transfers: 0,
        fare: { min: 1_400, max: 1_500 },
      },
      steps: [
        {
          properties: {
            guidance: '승차 지점까지 도보',
            type: 'WALKING',
            distance: 300,
            time: 240,
          },
          path: { points: [[126.9733577, 37.4916341], [126.974, 37.492]] },
        },
        {
          properties: {
            guidance: '7호선 이용',
            type: 'SUBWAY',
            distance: 8_500,
            time: 1_100,
            stops: [{ name: '남성' }, { name: '이수' }],
            vehicles: [{ name: '7호선', type: '일반' }],
          },
          path: { points: [[126.974, 37.492], [127.063, 37.547]] },
        },
        {
          properties: {
            guidance: '목적지까지 도보',
            type: 'WALKING',
            distance: 200,
            time: 160,
          },
          path: { points: [[127.063, 37.547], [127.064236, 37.547742]] },
        },
      ],
    },
    {
      properties: { type: 'BUS', totalDistance: 100 },
      steps: [],
    },
  ],
}

describe('카카오맵 일반 REST 대중교통 응답 파서', () => {
  it('구간, 정류장 순서, 차량, 좌표와 원본 합계를 보존한다', () => {
    const result = parseKakaoTransitRouteResponse(
      schemaFixture,
      new Date('2026-11-03T00:00:00.000Z'),
    )

    expect(result.provider).toBe('kakao-map-publictraffic')
    expect(result.routes).toHaveLength(2)
    expect(result.rejectedRoutes).toEqual([
      { routeIndex: 2, reason: 'INVALID_ROUTE_PROPERTIES' },
    ])
    expect(result.routes[0]).toMatchObject({
      type: 'BUS_AND_SUBWAY',
      totalDistanceM: 10_200,
      totalDurationSeconds: 2_100,
      transferCount: 1,
      fare: { value: 1_550, min: null, max: null },
    })
    expect(result.routes[0].steps[0]).toMatchObject({
      mode: 'BUS',
      stops: [
        { index: 0, name: '출발정류장' },
        { index: 1, name: '중간정류장' },
        { index: 2, name: '이수역' },
      ],
      vehicles: [
        { index: 0, name: '동작17', type: '마을' },
        { index: 1, name: '동작18', type: '마을' },
      ],
      coordinates: [
        { longitude: 126.9735, latitude: 37.4917 },
        { longitude: 126.98, latitude: 37.5 },
      ],
    })
    expect(result.routes[0].steps[1].stops.map((stop) => stop.name)).toEqual([
      '이수',
      '내방',
      '건대입구',
    ])
  })

  it('비도보 첫 구간을 접근 도보 누락 가능성으로만 기록한다', () => {
    const result = parseKakaoTransitRouteResponse(schemaFixture)
    const diagnostics = diagnoseKakaoTransitRoute(
      result.routes[0],
      { longitude: 126.9733577, latitude: 37.4916341 },
      { longitude: 127.064236, latitude: 37.547742 },
    )

    expect(diagnostics).toMatchObject({
      initialAccessWalkExplicit: false,
      initialAccessWalkMayBeMissing: true,
      finalAccessWalkExplicit: true,
      finalAccessWalkMayBeMissing: false,
      stepDurationSumSeconds: 1_860,
      totalToStepDurationDifferenceSeconds: 240,
      stepDistanceSumM: 10_100,
      totalToStepDistanceDifferenceM: 100,
      missingCoordinateStepIndexes: [],
      missingTransitStopStepIndexes: [],
      missingVehicleStepIndexes: [],
      ambiguousVehicleStepIndexes: [0],
    })
    expect(diagnostics.requestStartToFirstPathM).toBeGreaterThan(0)
    expect(diagnostics.realtimeMatchingEvidence).toEqual([
      expect.objectContaining({
        stepIndex: 0,
        mode: 'BUS',
        vehicleNames: ['동작17', '동작18'],
        vehicleOptionCount: 2,
        hasMultipleVehicleOptions: true,
        hasProviderStopIds: false,
        hasProviderRouteIds: false,
        hasPerStopCoordinates: false,
        level: 'partial',
      }),
      expect.objectContaining({
        stepIndex: 1,
        mode: 'SUBWAY',
        vehicleNames: ['7호선'],
        orderedStopNames: ['이수', '내방', '건대입구'],
        vehicleOptionCount: 1,
        hasMultipleVehicleOptions: false,
        level: 'partial',
      }),
    ])
  })

  it('처음과 마지막 WALKING 구간이 명시된 경로를 구분한다', () => {
    const result = parseKakaoTransitRouteResponse(schemaFixture)
    const diagnostics = diagnoseKakaoTransitRoute(
      result.routes[1],
      { longitude: 126.9733577, latitude: 37.4916341 },
      { longitude: 127.064236, latitude: 37.547742 },
    )

    expect(diagnostics.initialAccessWalkExplicit).toBe(true)
    expect(diagnostics.finalAccessWalkExplicit).toBe(true)
    expect(diagnostics.initialAccessWalkMayBeMissing).toBe(false)
    expect(diagnostics.finalAccessWalkMayBeMissing).toBe(false)
    expect(diagnostics.requestStartToFirstPathM).toBe(0)
    expect(diagnostics.lastPathToRequestEndM).toBe(0)
  })

  it('정류장·차량·좌표 누락을 자동으로 채우지 않는다', () => {
    const missingEvidenceResponse = structuredClone(schemaFixture)
    missingEvidenceResponse.routes = [{
      properties: {
        type: 'BUS',
        totalDistance: 500,
        totalTime: 300,
        transfers: 0,
        fare: { value: 1_400 },
      },
      steps: [{
        properties: {
          guidance: '정보가 부족한 버스 구간',
          type: 'BUS',
          distance: 500,
          time: 300,
          stops: [{ name: '승차 정류장' }],
          vehicles: [],
        },
        path: { points: [] },
      }],
    }]
    missingEvidenceResponse.properties = {
      total: 1,
      bus: 1,
      subway: 0,
      busAndSubway: 0,
      landingURL: '',
    }

    const result = parseKakaoTransitRouteResponse(missingEvidenceResponse)
    const diagnostics = diagnoseKakaoTransitRoute(
      result.routes[0],
      { longitude: 127, latitude: 37.5 },
      { longitude: 127.1, latitude: 37.6 },
    )

    expect(result.routes[0].steps[0].stops).toEqual([
      { index: 0, name: '승차 정류장' },
    ])
    expect(result.routes[0].steps[0].vehicles).toEqual([])
    expect(result.routes[0].steps[0].coordinates).toEqual([])
    expect(diagnostics).toMatchObject({
      requestStartToFirstPathM: null,
      lastPathToRequestEndM: null,
      missingCoordinateStepIndexes: [0],
      missingTransitStopStepIndexes: [0],
      missingVehicleStepIndexes: [0],
    })
    expect(diagnostics.realtimeMatchingEvidence[0].level).toBe('insufficient')
  })

  it('오류 상태와 파싱 가능한 경로가 없는 응답을 거부한다', () => {
    expect(() => parseKakaoTransitRouteResponse({
      status: 'NO_RESULTS',
    })).toThrowError(KakaoTransitResponseError)
    expect(() => parseKakaoTransitRouteResponse({
      status: 'OK',
      properties: { total: 1, bus: 1, subway: 0, busAndSubway: 0 },
      routes: [{ properties: {}, steps: [] }],
    })).toThrow('파싱 가능한 카카오 대중교통 경로가 없습니다.')
  })
})
