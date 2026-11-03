import { describe, expect, it } from 'vitest'
import type { TransitItinerary } from '../../domain/transitRoute'
import { getLastWalkingLegDiagnostic } from './transitRouteDiagnostics'

const destination = { latitude: 37.548, longitude: 127.066 }

function itinerary(): TransitItinerary {
  return {
    id: 'route',
    totalDurationSeconds: 500,
    totalWalkDurationSeconds: 266,
    totalWalkDistanceM: 331,
    totalDistanceM: 2_000,
    transferCount: 0,
    fareKrw: 1_500,
    legs: [{
      mode: 'BUS', distanceM: 1_669, durationSeconds: 234,
      routeName: '2222', routeColor: null, routeType: 11,
      startName: '건대입구', endName: '성동세무서', coordinates: [],
      endCoordinate: { latitude: 37.547, longitude: 127.065 },
      stops: [{
        index: 1, providerStopId: 'STOP', name: '성동세무서',
        coordinate: { latitude: 37.547, longitude: 127.065 },
      }],
    }, {
      mode: 'WALK', distanceM: 331, durationSeconds: 266,
      routeName: null, routeColor: null, routeType: null,
      startName: '성동세무서', endName: '푸조비즈타워',
      startCoordinate: { latitude: 37.547, longitude: 127.065 },
      endCoordinate: destination,
      coordinates: [
        { latitude: 37.547, longitude: 127.065 },
        { latitude: 37.5475, longitude: 127.0665 },
        destination,
      ],
    }],
  }
}

describe('로컬 TMAP 마지막 도보 진단', () => {
  it('공급자 원본 거리·시간과 요청 목적지까지의 좌표 차이를 분리한다', () => {
    const diagnostic = getLastWalkingLegDiagnostic(itinerary(), destination)
    expect(diagnostic).toMatchObject({
      provider: 'tmap-transit',
      distanceM: 331,
      durationSeconds: 266,
      parsedPathPointCount: 3,
      destinationGapM: 0,
      previousTransitStopName: '성동세무서',
    })
    expect(diagnostic?.parsedPathDistanceM).toBeGreaterThan(0)
    expect(diagnostic?.straightLineDistanceM).toBeGreaterThan(0)
  })

  it('경로가 마지막 WALK로 끝나지 않으면 진단을 만들지 않는다', () => {
    const route = itinerary()
    route.legs.push({
      mode: 'SUBWAY', distanceM: 100, durationSeconds: 100,
      routeName: '7호선', routeColor: null, routeType: 7,
      startName: 'A', endName: 'B', coordinates: [],
    })
    expect(getLastWalkingLegDiagnostic(route, destination)).toBeNull()
  })
})
