import { describe, expect, it } from 'vitest'
import type { TagoRouteStop, TagoStopCandidate } from '../../domain/busArrival'
import { verifyTagoRouteDirection } from './tagoRouteDirection'

const candidate: TagoStopCandidate = {
  cityCode: '12',
  nodeId: 'BOARD',
  name: '승차정류장',
  coordinate: { latitude: 37.5, longitude: 127 },
  routes: [],
}

const boarding = {
  name: '승차정류장',
  coordinate: { latitude: 37.5, longitude: 127 },
}

const alighting = {
  name: '하차정류장',
  coordinate: { latitude: 37.47, longitude: 127 },
}

function routeStops(): TagoRouteStop[] {
  return [
    {
      routeId: 'ROUTE-1', nodeId: 'BOARD', name: '승차정류장', sequence: 10,
      coordinate: { latitude: 37.5, longitude: 127 }, upDownCode: '0',
    },
    {
      routeId: 'ROUTE-1', nodeId: 'NEXT', name: '다음정류장', sequence: 11,
      coordinate: { latitude: 37.49, longitude: 127 }, upDownCode: '0',
    },
    {
      routeId: 'ROUTE-1', nodeId: 'ALIGHT', name: '하차정류장', sequence: 12,
      coordinate: { latitude: 37.47, longitude: 127 }, upDownCode: '0',
    },
  ]
}

describe('TAGO 노선 경유 순서 방향 검증', () => {
  it('승차 정류장 다음에 하차 정류장이 유일하게 있으면 검증한다', () => {
    const result = verifyTagoRouteDirection(
      'ROUTE-1', candidate, boarding, alighting, routeStops(),
    )

    expect(result).toMatchObject({
      status: 'verified',
      boardingStop: { nodeId: 'BOARD', sequence: 10 },
      nextStop: { nodeId: 'NEXT', sequence: 11 },
      alightingStop: { nodeId: 'ALIGHT', sequence: 12 },
    })
  })

  it('하차 정류장이 승차 정류장보다 앞이면 반대 방향 또는 순환으로 남긴다', () => {
    const stops = routeStops().map((stop) =>
      stop.nodeId === 'BOARD' ? { ...stop, sequence: 20 } : stop,
    )

    expect(verifyTagoRouteDirection(
      'ROUTE-1', candidate, boarding, alighting, stops,
    )).toEqual({
      status: 'review_required',
      reason: 'CIRCULAR_OR_REVERSE_ORDER',
    })
  })

  it('순환노선처럼 같은 정류장 ID가 반복되면 자동 확정하지 않는다', () => {
    const stops = [
      ...routeStops(),
      { ...routeStops()[0], sequence: 13 },
    ]

    expect(verifyTagoRouteDirection(
      'ROUTE-1', candidate, boarding, alighting, stops,
    )).toEqual({ status: 'review_required', reason: 'DUPLICATE_STOP' })
  })

  it('분기 구간에서 updowncd가 바뀌면 자동 확정하지 않는다', () => {
    const stops = routeStops().map((stop) =>
      stop.nodeId === 'NEXT' ? { ...stop, upDownCode: '1' } : stop,
    )

    expect(verifyTagoRouteDirection(
      'ROUTE-1', candidate, boarding, alighting, stops,
    )).toEqual({
      status: 'review_required',
      reason: 'BRANCH_DIRECTION_CONFLICT',
    })
  })

  it('정류장 순서가 누락되면 자동 확정하지 않는다', () => {
    const stops = routeStops().map((stop) =>
      stop.nodeId === 'NEXT' ? { ...stop, sequence: null } : stop,
    )

    expect(verifyTagoRouteDirection(
      'ROUTE-1', candidate, boarding, alighting, stops,
    )).toEqual({ status: 'review_required', reason: 'MISSING_SEQUENCE' })
  })

  it('하차 정류장이 경유 목록에 없으면 실패한다', () => {
    const stops = routeStops().filter((stop) => stop.nodeId !== 'ALIGHT')

    expect(verifyTagoRouteDirection(
      'ROUTE-1', candidate, boarding, alighting, stops,
    )).toEqual({ status: 'failed', reason: 'ALIGHTING_STOP_NOT_FOUND' })
  })

  it('요청한 TAGO 노선 ID와 응답 노선 ID가 다르면 실패한다', () => {
    const stops = routeStops().map((stop) => ({ ...stop, routeId: 'OTHER' }))

    expect(verifyTagoRouteDirection(
      'ROUTE-1', candidate, boarding, alighting, stops,
    )).toEqual({ status: 'failed', reason: 'ROUTE_ID_MISMATCH' })
  })

  it('같은 이름의 다른 정류장은 TAGO nodeId가 다르면 승차 정류장으로 쓰지 않는다', () => {
    const stops = routeStops().map((stop) =>
      stop.nodeId === 'BOARD' ? { ...stop, nodeId: 'OPPOSITE' } : stop,
    )

    expect(verifyTagoRouteDirection(
      'ROUTE-1', candidate, boarding, alighting, stops,
    )).toEqual({ status: 'failed', reason: 'BOARDING_STOP_NOT_FOUND' })
  })

  it('중복 경유 순번은 분기 가능성이 있어 자동 확정하지 않는다', () => {
    const stops = routeStops().map((stop) =>
      stop.nodeId === 'NEXT' ? { ...stop, sequence: 10 } : stop,
    )

    expect(verifyTagoRouteDirection(
      'ROUTE-1', candidate, boarding, alighting, stops,
    )).toEqual({ status: 'review_required', reason: 'DUPLICATE_SEQUENCE' })
  })
})
