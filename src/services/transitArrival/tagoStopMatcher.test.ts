import { describe, expect, it } from 'vitest'
import type { TagoStopCandidate } from '../../domain/busArrival'
import type { TransitRouteLeg } from '../../domain/transitRoute'
import { matchTmapBusStopToTago } from './tagoStopMatcher'

const busLeg: TransitRouteLeg = {
  mode: 'BUS',
  distanceM: 2000,
  durationSeconds: 600,
  routeName: '직행좌석:7800',
  routeId: 'TMAP-7800',
  routeColor: null,
  routeType: 4,
  startName: '사당역9번출구앞',
  endName: '의왕톨게이트',
  coordinates: [],
  stops: [
    {
      index: 0,
      providerStopId: 'TMAP-A',
      name: '사당역9번출구앞',
      coordinate: { latitude: 37.478, longitude: 126.982 },
    },
    {
      index: 1,
      providerStopId: 'TMAP-B',
      name: '남태령역',
      coordinate: { latitude: 37.468, longitude: 126.982 },
    },
  ],
}

function candidate(
  nodeId: string,
  latitude: number,
  nextLatitude: number | null,
  routeName = '7800',
): TagoStopCandidate {
  return {
    cityCode: '31010',
    nodeId,
    name: '사당역 9번 출구 앞 정류장',
    coordinate: { latitude, longitude: 126.982 },
    routes: [{
      routeId: `TAGO-${routeName}`,
      routeName,
      nextStopCoordinate: nextLatitude === null
        ? null
        : { latitude: nextLatitude, longitude: 126.982 },
    }],
  }
}

describe('TMAP-TAGO 정류장 매칭', () => {
  it('같은 이름의 맞은편 정류장은 진행 방향으로 제외한다', () => {
    const result = matchTmapBusStopToTago(busLeg, [
      candidate('WRONG-SIDE', 37.47805, 37.488),
      candidate('RIGHT-SIDE', 37.47795, 37.468),
    ])

    expect(result).toMatchObject({
      status: 'matched',
      candidate: { nodeId: 'RIGHT-SIDE' },
    })
  })

  it('진행 방향 증거로 후보를 하나로 줄이지 못하면 확인 필요를 반환한다', () => {
    const result = matchTmapBusStopToTago(busLeg, [
      candidate('A', 37.47805, null),
      candidate('B', 37.47795, null),
    ])

    expect(result).toEqual({
      status: 'review_required',
      reason: 'DIRECTION_AMBIGUOUS',
    })
  })

  it('유일한 이름·노선 후보라도 진행 방향이 반대면 자동 선택하지 않는다', () => {
    const result = matchTmapBusStopToTago(busLeg, [
      candidate('WRONG-SIDE', 37.478, 37.488),
    ])

    expect(result).toEqual({
      status: 'review_required',
      reason: 'DIRECTION_AMBIGUOUS',
    })
  })

  it('인근 후보가 없으면 매칭 실패를 반환한다', () => {
    const result = matchTmapBusStopToTago(busLeg, [
      candidate('FAR', 37.49, 37.48),
    ])

    expect(result).toEqual({ status: 'failed', reason: 'NO_NEARBY_STOP' })
  })

  it('정류장은 같아도 탑승 노선이 다르면 매칭하지 않는다', () => {
    const result = matchTmapBusStopToTago(busLeg, [
      candidate('OTHER-ROUTE', 37.478, 37.468, '7770'),
    ])

    expect(result).toEqual({ status: 'failed', reason: 'ROUTE_MISMATCH' })
  })
})
