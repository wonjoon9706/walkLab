import { describe, expect, it, vi } from 'vitest'
import {
  createSeoulBusProvider,
  SeoulBusProviderStageError,
} from './seoulBusProvider'

function response(itemList: unknown): Response {
  return new Response(JSON.stringify({
    msgHeader: { headerCd: '0', itemCount: 0 },
    msgBody: { itemList },
  }), { status: 200 })
}

describe('서울시 버스 provider', () => {
  it('공식 좌표·ARS·노선 파라미터를 서버에서 호출한다', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([{
        stId: '103000189', arsId: '04293', stNm: '우리은행화양동지점',
        tmX: 127.066142, tmY: 37.548142,
      }]))
      .mockResolvedValueOnce(response([{
        busRouteId: '100100199', busRouteNm: '2222', busRouteType: '3',
      }]))
      .mockResolvedValueOnce(response([{
        busRouteId: '100100199', rtNm: '2222', stId: '103000189',
        stNm: '우리은행화양동지점', staOrd: 20,
      }]))
    const provider = createSeoulBusProvider({
      fetch: fetchMock,
      serviceKey: 'server-only-key',
      allowInsecureHttp: true,
    })
    const signal = new AbortController().signal

    await provider.getNearbyStops(
      { latitude: 37.548142, longitude: 127.066142 },
      signal,
    )
    await provider.getRoutesAtStop('04293', signal)
    await provider.getRouteArrivals('100100199', signal)

    const urls = fetchMock.mock.calls.map(([url]) => new URL(String(url)))
    expect(urls[0].protocol).toBe('http:')
    expect(urls[0].pathname).toContain('/stationinfo/getStationByPos')
    expect(urls[0].searchParams.get('tmX')).toBe('127.066142')
    expect(urls[0].searchParams.get('tmY')).toBe('37.548142')
    expect(urls[0].searchParams.get('radius')).toBe('500')
    expect(urls[0].searchParams.get('resultType')).toBe('json')
    expect(urls[1].searchParams.get('arsId')).toBe('04293')
    expect(urls[2].searchParams.get('busRouteId')).toBe('100100199')
  })

  it('HTTP가 허용되지 않은 환경에서는 fetch 전에 차단한다', async () => {
    const fetchMock = vi.fn()
    const provider = createSeoulBusProvider({
      fetch: fetchMock,
      serviceKey: 'server-only-key',
      allowInsecureHttp: false,
    })

    await expect(provider.getNearbyStops(
      { latitude: 37.548142, longitude: 127.066142 },
      new AbortController().signal,
    )).rejects.toBeInstanceOf(SeoulBusProviderStageError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
