import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: getUserMock } }),
}))

import handler, { resetTagoBusArrivalStateForTests } from './bus-arrival'

const USER_ID = '11111111-1111-4111-8111-111111111111'

function seoulResponse(itemList: unknown): Response {
  return new Response(JSON.stringify({
    msgHeader: { headerCd: '0', headerMsg: '정상', itemCount: 0 },
    msgBody: { itemList },
  }), { status: 200 })
}

function createRequest() {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
    body: {
      routeName: '지선:2222',
      routeId: 'TMAP-2222',
      routeType: 12,
      boardingStop: {
        tmapStopId: 'TMAP-A',
        name: '우리은행화양동지점',
        coordinate: { latitude: 37.548142, longitude: 127.066142 },
      },
      nextStop: null,
      alightingStop: {
        tmapStopId: 'TMAP-C',
        name: '건대입구역사거리·건대병원',
        coordinate: { latitude: 37.54, longitude: 127.07 },
      },
    },
  } as IncomingMessage & { body: unknown }
}

function createResponse() {
  let statusCode = 200
  let body: unknown = null
  const response = {
    set statusCode(value: number) { statusCode = value },
    get statusCode() { return statusCode },
    setHeader: vi.fn(),
    end: vi.fn((text: string) => { body = JSON.parse(text) }),
  } as unknown as ServerResponse
  return { response, getStatusCode: () => statusCode, getBody: () => body }
}

beforeEach(() => {
  resetTagoBusArrivalStateForTests()
  process.env.SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-key'
  process.env.TMAP_TRANSIT_ALLOWED_USER_ID = USER_ID
  process.env.TAGO_SERVICE_KEY = 'server-only-key'
  process.env.SEOUL_BUS_API_LOCAL_ENABLED = 'true'
  delete process.env.VERCEL_ENV
  getUserMock.mockResolvedValue({
    data: { user: { id: USER_ID } }, error: null,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  delete process.env.SEOUL_BUS_API_LOCAL_ENABLED
  delete process.env.TAGO_SERVICE_KEY
  delete process.env.TMAP_TRANSIT_ALLOWED_USER_ID
})

describe('서울시 버스 서버 통합', () => {
  it('서울 좌표에서는 서울시 3종 API만 호출하고 TAGO를 호출하지 않는다', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(seoulResponse([{
        stId: '103000189', arsId: '04293', stNm: '우리은행화양동지점',
        tmX: 127.066142, tmY: 37.548142,
      }]))
      .mockResolvedValueOnce(seoulResponse([{
        stId: '104000001', arsId: '05200',
        stNm: '건대입구역사거리.건대병원', tmX: 127.07, tmY: 37.54,
      }]))
      .mockResolvedValueOnce(seoulResponse([{
        busRouteId: '100100199', busRouteNm: '2222', busRouteType: '3',
      }]))
      .mockResolvedValueOnce(seoulResponse([{
        busRouteId: '100100199', rtNm: '2222', routeType: '3',
        stId: '103000189', arsId: '04293', stNm: '우리은행화양동지점',
        staOrd: 20, arrmsgSec1: 180, arrmsgSec2: 540,
        sectOrd1: 17, sectOrd2: 12,
      }, {
        busRouteId: '100100199', rtNm: '2222', routeType: '3',
        stId: '104000001', arsId: '05200',
        stNm: '건대입구역사거리.건대병원', staOrd: 40,
      }]))
    vi.stubGlobal('fetch', fetchMock)
    const fake = createResponse()

    await handler(createRequest(), fake.response)

    expect(fake.getStatusCode()).toBe(200)
    expect(fake.getBody()).toMatchObject({
      status: 'available',
      provider: 'seoul',
      stopId: '103000189',
      upcomingArrivals: [
        { order: 1, arrivalSeconds: 180 },
        { order: 2, arrivalSeconds: 540 },
      ],
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    const urls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(urls.every((url) => url.startsWith('http://ws.bus.go.kr/'))).toBe(true)
    expect(urls.some((url) => url.includes('apis.data.go.kr'))).toBe(false)
    expect(JSON.stringify(fake.getBody())).not.toContain('server-only-key')
  })
})
