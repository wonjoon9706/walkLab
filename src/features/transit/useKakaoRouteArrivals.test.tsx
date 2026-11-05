import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KakaoTransitRoute } from '../../domain/kakaoTransitRoute'
import type { SubwayArrivalInfo } from '../../domain/subwayArrival'
import { SubwayArrivalError } from '../../domain/subwayArrival'
import { useKakaoRouteArrivals } from './useKakaoRouteArrivals'
import { resolveAutomaticTransitAccess } from '../../services/routing/automaticTransitAccess'
import type { SeoulRouteStopArrival } from '../../domain/seoulBus'

const { getSubwayArrival, getRouteArrivals } = vi.hoisted(() => ({ getSubwayArrival: vi.fn(), getRouteArrivals: vi.fn() }))
vi.mock('../../services/transitArrival/subwayArrivalClient', () => ({
  subwayArrivalClient: { getSubwayArrival },
}))
vi.mock('../../services/routing/seoulBusEvidenceClient', () => ({ seoulBusEvidenceClient: { getRouteArrivals } }))

const route: KakaoTransitRoute = {
  id: 'route', type: 'SUBWAY', totalDistanceM: 5_000, totalDurationSeconds: 900,
  transferCount: 0, fare: null, steps: [{
    index: 0, mode: 'SUBWAY', guidance: '7호선', distanceM: 5_000, durationSeconds: 900,
    vehicles: [{ index: 0, name: '7호선', type: null }], coordinates: [],
    stops: [{ index: 0, name: '이수' }, { index: 1, name: '내방' }, { index: 2, name: '건대입구' }],
  }],
}
function arrival(): SubwayArrivalInfo {
  return { lineName: '7호선', stationName: '이수', status: 'no_arrival_data', estimates: [],
    fetchedAt: new Date().toISOString(), provider: 'seoul-subway', dataMode: 'live' }
}

const busRoute: KakaoTransitRoute = { ...route, type: 'BUS', steps: [{ ...route.steps[0], mode: 'BUS',
  vehicles: [{ index: 0, name: '테스트17', type: null }],
  stops: [{ index: 0, name: '테스트 승차' }, { index: 1, name: '테스트 하차' }],
  coordinates: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.001 }],
}] }
const busStops: SeoulRouteStopArrival[] = ['테스트 승차', '테스트 하차'].map((stopName, i) => ({
  routeId: 'bus', routeName: '테스트17', routeType: null, stopId: `stop${i}`, arsId: null,
  stopName, sequence: i + 1, fetchedAt: new Date().toISOString(),
  estimates: [{ order: 1, arrivalSeconds: 360, remainingStops: 3, message: null }],
}))
function resolveBusAccess(fail = false) {
  return resolveAutomaticTransitAccess({ route: busRoute,
    origin: { coordinate: { latitude: 0, longitude: -0.0001 }, verification: 'searched_place', note: null },
    speed: { kind: 'g7_model', model: null }, signal: new AbortController().signal,
  }, { seoulBusProvider: {
    getNearbyStops: async () => { if (fail) throw new Error('REQUEST_TIMEOUT'); return [{ stopId: 'stop0', arsId: '10001', name: '테스트 승차', coordinate: { latitude: 0, longitude: 0 } }] },
    getRoutesAtStop: async () => [{ routeId: 'bus', routeName: '테스트17', routeType: null }],
    getRouteArrivals: async () => busStops,
  }, searchPlaces: async () => [], getWalkingRoute: async ({ start, destination }) => ({
    distanceM: 12, providerDurationSeconds: 10, coordinates: [start, destination], provider: 'kakao-walking-route', requestedAt: new Date().toISOString(),
  }) })
}

describe('카카오 경로별 첫 승차 조회', () => {
  beforeEach(() => { getSubwayArrival.mockReset().mockImplementation(async () => arrival()); getRouteArrivals.mockReset().mockResolvedValue(busStops) })
  afterEach(() => vi.useRealTimers())

  it('실제 정류장 검증기의 504를 후보 없음과 구분하고 수동 재검증 후 버스 조회를 복구한다', async () => {
    const { result } = renderHook(useKakaoRouteArrivals)
    const failed = await resolveBusAccess(true)
    const signal = new AbortController().signal
    await act(async () => result.current.ensure(busRoute, failed, signal))
    expect(getRouteArrivals).not.toHaveBeenCalled()
    expect(result.current.entries.get(busRoute.id)).toMatchObject({ issue: 'timeout', errorCode: 'REQUEST_TIMEOUT' })
    const verified = await resolveBusAccess()
    expect(verified.status).toBe('ready')
    await act(async () => result.current.ensure(busRoute, verified, signal, true))
    expect(getRouteArrivals).toHaveBeenCalledOnce()
    expect(result.current.entries.get(busRoute.id)?.bus).toMatchObject({ status: 'available', arrivalSeconds: 360, stopId: 'stop0' })
  })

  it('단일 정류장의 G8 스냅 review는 도착정보 조회를 막지 않지만 방향이 다르면 배제한다', async () => {
    const access = await resolveBusAccess()
    const reviewed = { ...access, status: 'review_required' as const, reason: 'ACCESS_WALK_REVIEW_REQUIRED' as const,
      detailReason: 'WALKING_ENDPOINT_MISMATCH' as const }
    const { result } = renderHook(useKakaoRouteArrivals)
    const signal = new AbortController().signal
    await act(async () => result.current.ensure(busRoute, reviewed, signal))
    expect(result.current.entries.get(busRoute.id)?.bus?.status).toBe('available')
    getRouteArrivals.mockResolvedValue([busStops[0], { ...busStops[1], stopName: '반대 방향' }])
    act(() => result.current.reset())
    await act(async () => result.current.ensure(busRoute, reviewed, signal, true))
    expect(result.current.entries.get(busRoute.id)?.issue).toBe('direction_unverified')
  })

  it.each([
    ['SEOUL_BUS_AUTH_ERROR', 'auth_error'], ['REQUEST_TIMEOUT', 'timeout'],
    ['GATEWAY_TIMEOUT', 'gateway_timeout'], ['FUNCTION_INVOCATION_TIMEOUT', 'gateway_timeout'],
    ['SERVER_NOT_CONFIGURED', 'not_configured'], ['INVALID_RESPONSE', 'invalid_response'],
  ])('버스 오류 %s를 %s로 보존한다', async (code, issue) => {
    const access = await resolveBusAccess()
    getRouteArrivals.mockRejectedValue(new Error(code))
    const { result } = renderHook(useKakaoRouteArrivals)
    await act(async () => result.current.ensure(busRoute, access, new AbortController().signal))
    expect(result.current.entries.get(busRoute.id)).toMatchObject({ issue, errorCode: code })
  })

  it('서버 운영 제한을 일반 조회 실패와 구분한다', async () => {
    getSubwayArrival.mockRejectedValue(new SubwayArrivalError('PRODUCTION_DISABLED', '운영 통신 미확인'))
    const { result } = renderHook(useKakaoRouteArrivals)
    await act(async () => {
      await result.current.ensure(route, null, new AbortController().signal)
    })
    expect(result.current.entries.get(route.id)?.issue).toBe('service_disabled')
    expect(result.current.entries.get(route.id)?.subway).toBeNull()
  })

  it('동일 노선·승차·다음·하차역 요청을 공유하고 상세 진입에 재사용한다', async () => {
    const { result } = renderHook(useKakaoRouteArrivals)
    const controller = new AbortController()
    await act(async () => {
      await Promise.all([
        result.current.ensure(route, null, controller.signal),
        result.current.ensure({ ...route, id: 'second' }, null, controller.signal),
      ])
    })
    expect(getSubwayArrival).toHaveBeenCalledOnce()
    expect(result.current.entries.size).toBe(2)
    await act(async () => result.current.ensure(route, null, controller.signal))
    expect(getSubwayArrival).toHaveBeenCalledOnce()
    expect(result.current.entries.get(route.id)?.subway?.status).toBe('no_arrival_data')
  })

  it('반대 방향 또는 다른 하차역에 기존 결과를 공유하지 않는다', async () => {
    const { result } = renderHook(useKakaoRouteArrivals)
    const signal = new AbortController().signal
    const reverse = { ...route, id: 'reverse', steps: [{ ...route.steps[0],
      stops: [{ index: 0, name: '이수' }, { index: 1, name: '남성' }, { index: 2, name: '온수' }],
    }] }
    await act(async () => {
      await result.current.ensure(route, null, signal)
      await result.current.ensure(reverse, null, signal)
    })
    expect(getSubwayArrival).toHaveBeenCalledTimes(2)
  })

  it('30초 중복 방지를 유지하며 명시적 새로고침 때만 만료 결과를 갱신한다', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(useKakaoRouteArrivals)
    const signal = new AbortController().signal
    await act(async () => result.current.ensure(route, null, signal))
    await act(async () => result.current.ensure(route, null, signal, true))
    expect(getSubwayArrival).toHaveBeenCalledOnce()
    vi.setSystemTime(Date.now() + 31_000)
    await act(async () => result.current.ensure(route, null, signal))
    expect(getSubwayArrival).toHaveBeenCalledOnce()
    await act(async () => result.current.ensure(route, null, signal, true))
    expect(getSubwayArrival).toHaveBeenCalledTimes(2)
  })

  it('새 검색 후 이전 비동기 결과를 반영하지 않는다', async () => {
    let finish: (value: SubwayArrivalInfo) => void = () => undefined
    getSubwayArrival.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const { result } = renderHook(useKakaoRouteArrivals)
    let pending: Promise<void>
    act(() => { pending = result.current.ensure(route, null, new AbortController().signal) })
    act(() => result.current.reset())
    await act(async () => { finish(arrival()); await pending })
    expect(result.current.entries.size).toBe(0)
  })

  it('조회 실패나 무응답을 확인 필요로 끝내며 자동 재시도하지 않는다', async () => {
    vi.useFakeTimers()
    getSubwayArrival.mockImplementation(() => new Promise(() => undefined))
    const { result } = renderHook(useKakaoRouteArrivals)
    let pending: Promise<void>
    act(() => { pending = result.current.ensure(route, null, new AbortController().signal) })
    await act(async () => { await vi.advanceTimersByTimeAsync(25_000); await pending })
    expect(result.current.entries.get(route.id)?.status).toBe('ready')
    expect(result.current.entries.get(route.id)?.error).not.toBeNull()
    expect(getSubwayArrival).toHaveBeenCalledOnce()
  })
})
