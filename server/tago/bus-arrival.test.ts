import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: getUserMock } }),
}))

import handler, { resetTagoBusArrivalStateForTests } from '../../api/tago/bus-arrival.js'

const ALLOWED_USER_ID = '11111111-1111-4111-8111-111111111111'

function jsonResponse(items: unknown[], totalCount = items.length): string {
  return JSON.stringify({
    response: {
      header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
      body: { items: { item: items }, totalCount },
    },
  })
}

function providerResponse(items: unknown[]): Response {
  return new Response(jsonResponse(items), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
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

function createRequest() {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
    body: {
      routeName: '직행좌석:7800',
      routeId: 'TMAP-7800',
      routeType: 4,
      boardingStop: {
        tmapStopId: 'TMAP-A',
        name: '사당역9번출구앞',
        coordinate: { latitude: 37.478, longitude: 126.982 },
      },
      nextStop: {
        tmapStopId: 'TMAP-B',
        name: '남태령역',
        coordinate: { latitude: 37.468, longitude: 126.982 },
      },
      alightingStop: {
        tmapStopId: 'TMAP-C',
        name: '의왕톨게이트',
        coordinate: { latitude: 37.45, longitude: 126.982 },
      },
    },
  } as IncomingMessage & { body: unknown }
}

function normalFetchMock() {
  return vi.fn()
    .mockResolvedValueOnce(providerResponse([
      { citycode: '12', cityname: '서울특별시' },
    ]))
    .mockResolvedValueOnce(providerResponse([{
      citycode: '12',
      nodeid: 'TAGO-A',
      nodenm: '사당역9번출구앞',
      gpslati: 37.47801,
      gpslong: 126.982,
    }]))
    .mockResolvedValueOnce(providerResponse([{
      routeid: 'TAGO-7800',
      routeno: '7800',
      routetp: '직행좌석',
    }]))
    .mockResolvedValueOnce(providerResponse([{
      routeid: 'TAGO-7800', nodeid: 'TAGO-A', nodenm: '사당역9번출구앞',
      nodeord: 1, gpslati: 37.47801, gpslong: 126.982, updowncd: '0',
    }, {
      routeid: 'TAGO-7800', nodeid: 'TAGO-B', nodenm: '남태령역',
      nodeord: 2, gpslati: 37.468, gpslong: 126.982, updowncd: '0',
    }, {
      routeid: 'TAGO-7800', nodeid: 'TAGO-C', nodenm: '의왕톨게이트',
      nodeord: 3, gpslati: 37.45, gpslong: 126.982, updowncd: '0',
    }]))
    .mockResolvedValueOnce(providerResponse([{
      nodeid: 'TAGO-A', nodenm: '사당역9번출구앞',
      routeid: 'TAGO-7800', routeno: '7800', routetp: '직행좌석',
      arrprevstationcnt: 3, arrtime: 360,
    }]))
}

beforeEach(() => {
  resetTagoBusArrivalStateForTests()
  process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'publishable-key'
  process.env.TMAP_TRANSIT_ALLOWED_USER_ID = ALLOWED_USER_ID
  process.env.TAGO_SERVICE_KEY = 'server-only-tago-key'
  delete process.env.VERCEL_ENV
  delete process.env.TAGO_BUS_ARRIVAL_PRODUCTION_ENABLED
  delete process.env.SEOUL_BUS_API_LOCAL_ENABLED
  getUserMock.mockResolvedValue({
    data: { user: { id: ALLOWED_USER_ID } },
    error: null,
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  delete process.env.TMAP_TRANSIT_ALLOWED_USER_ID
  delete process.env.TAGO_SERVICE_KEY
  delete process.env.VERCEL_ENV
  delete process.env.TAGO_BUS_ARRIVAL_PRODUCTION_ENABLED
  delete process.env.TAGO_BUS_ARRIVAL_DIAGNOSTICS_ENABLED
  delete process.env.SEOUL_BUS_API_LOCAL_ENABLED
})

describe('Vercel TAGO 버스 도착정보 함수', () => {
  it('서버 키로 도시·정류장·노선 순서·도착정보를 안전하게 조합한다', async () => {
    const fetchMock = normalFetchMock()
    vi.stubGlobal('fetch', fetchMock)
    const fake = createResponse()

    await handler(createRequest(), fake.response)

    expect(fake.getStatusCode()).toBe(200)
    expect(fake.getBody()).toMatchObject({
      status: 'available',
      provider: 'tago',
      dataMode: 'live',
    })
    expect(fetchMock).toHaveBeenCalledTimes(5)
    const urls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(urls[0]).toContain('/getCtyCodeList?')
    expect(urls[1]).toContain('/getCrdntPrxmtSttnList?')
    expect(urls[2]).toContain('/getSttnThrghRouteList?')
    expect(urls[3]).toContain('/getRouteAcctoThrghSttnList?')
    expect(urls[4]).toContain('/getSttnAcctoArvlPrearngeInfoList?')
    expect(String(JSON.stringify(fake.getBody()))).not.toContain('server-only-tago-key')
  })

  it('30초 안의 동일 요청은 TAGO를 다시 호출하지 않는다', async () => {
    const fetchMock = normalFetchMock()
    vi.stubGlobal('fetch', fetchMock)
    const first = createResponse()
    const second = createResponse()

    await handler(createRequest(), first.response)
    await handler(createRequest(), second.response)

    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(second.getBody()).toEqual(first.getBody())
  })

  it('로그인하지 않은 요청과 허용 목록 밖 사용자는 호출하지 않는다', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null })
    const unauthenticated = createResponse()
    await handler(createRequest(), unauthenticated.response)
    expect(unauthenticated.getStatusCode()).toBe(401)

    getUserMock.mockResolvedValueOnce({
      data: { user: { id: '22222222-2222-4222-8222-222222222222' } },
      error: null,
    })
    const forbidden = createResponse()
    await handler(createRequest(), forbidden.response)
    expect(forbidden.getStatusCode()).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Production은 명시적으로 활성화하기 전까지 호출하지 않는다', async () => {
    process.env.VERCEL_ENV = 'production'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const fake = createResponse()

    await handler(createRequest(), fake.response)

    expect(fake.getStatusCode()).toBe(503)
    expect(fake.getBody()).toMatchObject({ code: 'PRODUCTION_DISABLED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Production에서는 서울시 HTTP 플래그가 켜져도 기존 TAGO만 사용한다', async () => {
    process.env.VERCEL_ENV = 'production'
    process.env.TAGO_BUS_ARRIVAL_PRODUCTION_ENABLED = 'true'
    process.env.SEOUL_BUS_API_LOCAL_ENABLED = 'true'
    const fetchMock = normalFetchMock()
    vi.stubGlobal('fetch', fetchMock)
    const fake = createResponse()

    await handler(createRequest(), fake.response)

    expect(fake.getStatusCode()).toBe(200)
    const urls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(urls.some((url) => url.startsWith('http://ws.bus.go.kr/'))).toBe(false)
    expect(urls.every((url) => url.startsWith('https://apis.data.go.kr/'))).toBe(true)
  })

  it('XML 인증키 오류와 호출 한도 오류를 구분한다', async () => {
    const authXml = `<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(authXml)))
    const auth = createResponse()
    await handler(createRequest(), auth.response)
    expect(auth.getStatusCode()).toBe(502)
    expect(auth.getBody()).toMatchObject({ code: 'TAGO_AUTH_ERROR' })

    resetTagoBusArrivalStateForTests()
    const quotaXml = `<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</returnAuthMsg><returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(quotaXml)))
    const quota = createResponse()
    await handler(createRequest(), quota.response)
    expect(quota.getStatusCode()).toBe(429)
    expect(quota.getBody()).toMatchObject({ code: 'QUOTA_EXCEEDED' })
  })

  it('응답 지연과 깨진 데이터 형식을 안전하게 처리한다', async () => {
    vi.useFakeTimers()
    const delayedFetch = vi.fn((_url: string, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      }),
    )
    vi.stubGlobal('fetch', delayedFetch)
    const delayed = createResponse()
    const pending = handler(createRequest(), delayed.response)
    await vi.advanceTimersByTimeAsync(8_000)
    await pending
    expect(delayed.getStatusCode()).toBe(504)
    expect(delayed.getBody()).toMatchObject({ code: 'REQUEST_TIMEOUT' })

    vi.useRealTimers()
    resetTagoBusArrivalStateForTests()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{broken')))
    const malformed = createResponse()
    await handler(createRequest(), malformed.response)
    expect(malformed.getStatusCode()).toBe(502)
    expect(malformed.getBody()).toMatchObject({ code: 'INVALID_RESPONSE' })

    resetTagoBusArrivalStateForTests()
    process.env.TAGO_BUS_ARRIVAL_DIAGNOSTICS_ENABLED = 'true'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{broken')))
    const diagnosed = createResponse()
    await handler(createRequest(), diagnosed.response)
    expect(diagnosed.getBody()).toMatchObject({
      code: 'INVALID_RESPONSE',
      diagnostics: {
        source: 'live',
        failedStage: 'city_codes',
        outcomeReason: 'TAGO_REQUEST_OR_RESPONSE_ERROR',
      },
    })
  })
})
