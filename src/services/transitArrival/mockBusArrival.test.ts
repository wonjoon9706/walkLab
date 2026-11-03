import { describe, expect, it } from 'vitest'
import type { TransitItinerary, TransitRouteLeg } from '../../domain/transitRoute'
import { createMockBusArrivals } from './mockBusArrival'

function bus(routeName: string, startName: string): TransitRouteLeg {
  return {
    mode: 'BUS',
    distanceM: 1000,
    durationSeconds: 300,
    routeName,
    routeColor: null,
    routeType: 11,
    startName,
    endName: '다음 정류장',
    coordinates: [],
  }
}

function itinerary(legs: TransitRouteLeg[]): TransitItinerary {
  return {
    id: 'mock-route',
    totalDurationSeconds: 1000,
    totalWalkDurationSeconds: 100,
    totalWalkDistanceM: 120,
    totalDistanceM: 3000,
    transferCount: Math.max(0, legs.length - 1),
    fareKrw: 1500,
    legs,
  }
}

describe('버스 도착정보 Mock 흐름', () => {
  it('단일 버스 경로에 하나의 도착정보를 만든다', () => {
    const results = createMockBusArrivals(
      itinerary([bus('7800', '사당역9번출구앞')]),
      new Date('2026-11-03T00:00:00.000Z'),
    )

    expect(results).toHaveLength(1)
    expect(results[0].arrival).toMatchObject({
      status: 'available',
      routeName: '7800',
      stopName: '사당역9번출구앞',
      arrivalSeconds: 360,
      remainingStops: 3,
      provider: 'tago',
      walkingTimeToStopSeconds: null,
    })
  })

  it('버스에서 버스로 환승하면 각 버스 구간을 별도로 유지한다', () => {
    const results = createMockBusArrivals(
      itinerary([bus('100', 'A'), bus('200', 'B')]),
      new Date('2026-11-03T00:00:00.000Z'),
    )

    expect(results.map((result) => result.legIndex)).toEqual([0, 1])
    expect(results.map((result) => result.arrival.routeName)).toEqual(['100', '200'])
  })

  it.each([
    'no_service',
    'api_error',
    'unsupported_region',
  ] as const)('%s 상태를 정상 도착정보와 구분한다', (status) => {
    const [result] = createMockBusArrivals(
      itinerary([bus('100', 'A')]),
      new Date('2026-11-03T00:00:00.000Z'),
      { 0: status },
    )

    expect(result.arrival.status).toBe(status)
    expect(result.arrival.arrivalSeconds).toBeNull()
    expect(result.arrival.remainingStops).toBeNull()
  })
})
