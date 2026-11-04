import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KakaoTransitRoute } from '../../domain/kakaoTransitRoute'
import type { SubwayArrivalInfo } from '../../domain/subwayArrival'
import { useKakaoRouteArrivals } from './useKakaoRouteArrivals'

const { getSubwayArrival } = vi.hoisted(() => ({ getSubwayArrival: vi.fn() }))
vi.mock('../../services/transitArrival/subwayArrivalClient', () => ({
  subwayArrivalClient: { getSubwayArrival },
}))

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

describe('카카오 경로별 첫 승차 조회', () => {
  beforeEach(() => { getSubwayArrival.mockReset().mockImplementation(async () => arrival()) })
  afterEach(() => vi.useRealTimers())

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
