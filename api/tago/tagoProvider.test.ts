import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTagoProvider, resetTagoProviderCacheForTests } from './tagoProvider'

function routeStopResponse(items: unknown[], totalCount: number): Response {
  return new Response(JSON.stringify({
    response: {
      header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
      body: { items: { item: items }, totalCount },
    },
  }), { status: 200 })
}

describe('TAGO 노선별 경유 정류장 provider', () => {
  beforeEach(() => resetTagoProviderCacheForTests())

  it('공식 파라미터로 모든 페이지를 조회하고 6시간 캐시를 재사용한다', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(routeStopResponse([{
        routeid: 'ROUTE-1', nodeid: 'STOP-1', nodenm: '승차정류장',
        nodeord: 1, gpslati: 37.5, gpslong: 127, updowncd: '0',
      }], 2))
      .mockResolvedValueOnce(routeStopResponse([{
        routeid: 'ROUTE-1', nodeid: 'STOP-2', nodenm: '하차정류장',
        nodeord: 2, gpslati: 37.49, gpslong: 127, updowncd: '0',
      }], 2))
    const provider = createTagoProvider({
      fetch: fetchMock,
      serviceKey: 'secret-key',
      now: () => 1_000,
    })

    const first = await provider.getRouteStops(
      '12', 'ROUTE-1', new AbortController().signal,
    )
    const second = await provider.getRouteStops(
      '12', 'ROUTE-1', new AbortController().signal,
    )

    expect(first).toHaveLength(2)
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstUrl = new URL(fetchMock.mock.calls[0][0] as string)
    const secondUrl = new URL(fetchMock.mock.calls[1][0] as string)
    expect(firstUrl.pathname).toContain('getRouteAcctoThrghSttnList')
    expect(firstUrl.searchParams.get('cityCode')).toBe('12')
    expect(firstUrl.searchParams.get('routeId')).toBe('ROUTE-1')
    expect(firstUrl.searchParams.get('pageNo')).toBe('1')
    expect(firstUrl.searchParams.get('numOfRows')).toBe('100')
    expect(secondUrl.searchParams.get('pageNo')).toBe('2')
  })
})
