import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: getUserMock } }),
}))

import handler, { resetSubwayArrivalStateForTests } from '../../api/subway/arrival.js'

const USER_ID = '11111111-1111-4111-8111-111111111111'

function createRequest() {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
    body: {
      routeName: '2호선', trainType: 'normal',
      boardingStation: { providerStationId: 'A', name: '건대입구' },
      nextStation: { providerStationId: 'B', name: '구의' },
      alightingStation: { providerStationId: 'C', name: '잠실' },
    },
  } as IncomingMessage & { body: unknown }
}

function createResponse() {
  let status = 200
  let body: unknown
  const response = {
    set statusCode(value: number) { status = value },
    get statusCode() { return status },
    setHeader: vi.fn(),
    end: vi.fn((text: string) => { body = JSON.parse(text) }),
  } as unknown as ServerResponse
  return { response, status: () => status, body: () => body }
}

function apiResponse(): Response {
  return new Response(JSON.stringify({
    errorMessage: { code: 'INFO-000', message: '정상 처리되었습니다.' },
    realtimeArrivalList: [{
      subwayId: '1002', statnNm: '건대입구', updnLine: '내선',
      trainLineNm: '성수행 - 구의방면', btrainSttus: '일반',
      barvlDt: '110', recptnDt: '2026-11-03 12:00:00',
      arvlCd: '99', arvlMsg2: '2분 후',
    }],
  }), { status: 200 })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-03T03:01:00.000Z'))
  resetSubwayArrivalStateForTests()
  process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'publishable-key'
  process.env.TRANSIT_ALLOWED_USER_ID = USER_ID
  process.env.SEOUL_SUBWAY_REALTIME_KEY = 'server-only-key'
  delete process.env.VERCEL_ENV
  getUserMock.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  delete process.env.TRANSIT_ALLOWED_USER_ID
  delete process.env.SEOUL_SUBWAY_REALTIME_KEY
  delete process.env.VERCEL_ENV
})

describe('Vercel 서울시 지하철 도착정보 함수', () => {
  it.each([401, 429])('운영 HTTP %s 오류를 열차 정보 없음으로 바꾸지 않는다', async (status) => {
    process.env.VERCEL_ENV = 'production'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })))
    const result = createResponse()
    await handler(createRequest(), result.response)
    expect(result.body()).toMatchObject({ code: status === 429 ? 'QUOTA_EXCEEDED' : 'SEOUL_SUBWAY_API_ERROR' })
  })

  it('운영 타임아웃을 열차 정보 없음과 구분한다', async () => {
    process.env.VERCEL_ENV = 'production'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('test', 'AbortError')))
    const result = createResponse()
    await handler(createRequest(), result.response)
    expect(result.body()).toMatchObject({ code: 'REQUEST_TIMEOUT' })
  })
  it.each(['development', 'production', 'preview'])('%s에서도 공식 API로 조회하고 시간 보정을 유지한다', async (env) => {
    process.env.VERCEL_ENV = env
    const fetchMock = vi.fn().mockImplementation(async () => apiResponse())
    vi.stubGlobal('fetch', fetchMock)
    const result = createResponse()
    await handler(createRequest(), result.response)
    expect(result.status()).toBe(200)
    expect(result.body()).toMatchObject({ status: 'available', estimates: [{ arrivalSeconds: 50 }] })
    expect(new URL(String(fetchMock.mock.calls[0][0])).host).toBe('swopenapi.seoul.go.kr')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
  })

  it('운영에서도 키 누락이면 오류를 반환하고 외부 호출하지 않는다', async () => {
    process.env.VERCEL_ENV = 'production'
    delete process.env.SEOUL_SUBWAY_REALTIME_KEY
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
    const result = createResponse()
    await handler(createRequest(), result.response)
    expect(result.body()).toMatchObject({ code: 'SERVER_NOT_CONFIGURED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('인증된 허용 사용자에게만 정규화된 결과를 반환하고 30초 캐시를 사용한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(apiResponse())
    vi.stubGlobal('fetch', fetchMock)
    const first = createResponse()
    const second = createResponse()

    await handler(createRequest(), first.response)
    await handler(createRequest(), second.response)

    expect(first.status()).toBe(200)
    expect(first.body()).toMatchObject({
      status: 'available', provider: 'seoul-subway',
      estimates: [{
        rawArrivalSeconds: 110,
        dataAgeSeconds: 60,
        arrivalSeconds: 50,
      }],
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(JSON.stringify(first.body())).not.toContain('server-only-key')
  })

})
