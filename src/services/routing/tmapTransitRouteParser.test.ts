import { describe, expect, it } from 'vitest'
import { TransitRouteError } from '../../domain/transitRoute'
import { parseTmapTransitRouteResponse } from './tmapTransitRouteParser'

const response = {
  metaData: {
    plan: {
      itineraries: [{
        fare: { regular: { totalFare: 1500 } },
        totalTime: 900,
        totalWalkTime: 300,
        totalWalkDistance: 360,
        totalDistance: 4500,
        transferCount: 1,
        legs: [
          {
            mode: 'WALK',
            sectionTime: 120,
            distance: 140,
            start: { name: '출발지' },
            end: { name: '정류장 A' },
            steps: [{ linestring: '127.1,37.5 127.101,37.501' }],
          },
          {
            mode: 'BUS',
            type: 11,
            sectionTime: 600,
            distance: 4000,
            route: '간선:100',
            routeColor: '0068B7',
            start: { name: '정류장 A' },
            end: { name: '정류장 B' },
            passShape: { linestring: '127.101,37.501 127.12,37.52' },
          },
          {
            mode: 'WALK',
            sectionTime: 180,
            distance: 220,
            start: { name: '정류장 B' },
            end: { name: '도착지' },
            steps: [{ linestring: '127.12,37.52 127.121,37.521' }],
          },
        ],
      }],
    },
  },
}

describe('TMAP 대중교통 응답 파서', () => {
  it('초·미터 단위와 경도·위도 linestring을 도메인 타입으로 변환한다', () => {
    const result = parseTmapTransitRouteResponse(
      response,
      new Date('2026-11-02T00:00:00.000Z'),
    )

    expect(result.provider).toBe('tmap-transit')
    expect(result.itineraries[0]).toMatchObject({
      totalDurationSeconds: 900,
      totalWalkDurationSeconds: 300,
      totalWalkDistanceM: 360,
      transferCount: 1,
      fareKrw: 1500,
    })
    expect(result.itineraries[0].legs[1]).toMatchObject({
      mode: 'BUS',
      routeType: 11,
      routeName: '간선:100',
      coordinates: [
        { latitude: 37.501, longitude: 127.101 },
        { latitude: 37.52, longitude: 127.12 },
      ],
    })
  })

  it('결과 없음 응답을 성공으로 처리하지 않는다', () => {
    expect(() =>
      parseTmapTransitRouteResponse({
        result: { status: 14, message: '검색 결과가 없음' },
      }),
    ).toThrowError(TransitRouteError)
  })

  it('필수 합계나 leg가 빠진 응답을 거부한다', () => {
    expect(() =>
      parseTmapTransitRouteResponse({
        metaData: { plan: { itineraries: [{ totalTime: 100 }] } },
      }),
    ).toThrow('대중교통 경로를 찾지 못했습니다.')
  })
})
