import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getUserMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: getUserMock } }),
}))

import handler from './walking-route'

interface FakeResponse {
  response: ServerResponse
  getStatusCode: () => number
  getBody: () => unknown
}

function createResponse(): FakeResponse {
  let statusCode = 200
  let body: unknown = null
  const response = {
    set statusCode(value: number) { statusCode = value },
    get statusCode() { return statusCode },
    setHeader: vi.fn(),
    end: vi.fn((text: string) => { body = JSON.parse(text) }),
  } as unknown as ServerResponse
  return {
    response,
    getStatusCode: () => statusCode,
    getBody: () => body,
  }
}

function createRequest(url: string, token = 'test-access-token') {
  return {
    method: 'GET',
    url,
    headers: { authorization: `Bearer ${token}` },
  } as IncomingMessage
}

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key'
  process.env.KAKAO_REST_API_KEY = 'test-rest-api-key'
  getUserMock.mockResolvedValue({
    data: { user: { id: crypto.randomUUID() } },
    error: null,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  delete process.env.KAKAO_REST_API_KEY
  delete process.env.SUPABASE_URL
  delete process.env.SUPABASE_PUBLISHABLE_KEY
})

describe('Vercel 카카오 도보 경로 함수', () => {
  it('로그인 사용자의 좌표를 WGS84 경도·위도 순서로 전달한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'OK',
          route: {
            properties: { totalDistance: 500, totalTime: 360 },
            legs: [{
              steps: [{
                path: { points: [[127.1, 37.5], [127.2, 37.6]] },
              }],
            }],
          },
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const fake = createResponse()

    await handler(
      createRequest(
        '/api/kakao/walking-route?start_x=127.1&start_y=37.5&end_x=127.2&end_y=37.6',
      ),
      fake.response,
    )

    expect(fake.getStatusCode()).toBe(200)
    expect(fake.getBody()).toMatchObject({
      distanceM: 500,
      provider: 'kakao-walking-route',
    })
    const kakaoUrl = fetchMock.mock.calls[0][0] as URL
    expect(kakaoUrl.searchParams.get('start_x')).toBe('127.1')
    expect(kakaoUrl.searchParams.get('start_y')).toBe('37.5')
    expect(kakaoUrl.searchParams.get('input_coord')).toBe('WGS84')
  })

  it('인증되지 않은 요청은 카카오 API를 호출하지 않는다', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const fake = createResponse()

    await handler(
      createRequest(
        '/api/kakao/walking-route?start_x=127.1&start_y=37.5&end_x=127.2&end_y=37.6',
      ),
      fake.response,
    )

    expect(fake.getStatusCode()).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fake.getBody()).toMatchObject({ code: 'AUTH_TOKEN_INVALID' })
  })

  it('Authorization 헤더가 없으면 원인을 구분한다', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const fake = createResponse()
    const request = {
      method: 'GET',
      url: '/api/kakao/walking-route',
      headers: {},
    } as IncomingMessage

    await handler(request, fake.response)

    expect(fake.getStatusCode()).toBe(401)
    expect(fake.getBody()).toMatchObject({ code: 'AUTH_HEADER_MISSING' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('서버 Supabase 설정이 없으면 토큰 만료로 오인하지 않는다', async () => {
    delete process.env.VITE_SUPABASE_URL
    delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const fake = createResponse()

    await handler(
      createRequest('/api/kakao/walking-route'),
      fake.response,
    )

    expect(fake.getStatusCode()).toBe(503)
    expect(fake.getBody()).toMatchObject({
      code: 'SERVER_AUTH_NOT_CONFIGURED',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('너무 가까운 좌표를 외부 호출 전에 거부한다', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const fake = createResponse()

    await handler(
      createRequest(
        '/api/kakao/walking-route?start_x=127.1&start_y=37.5&end_x=127.100001&end_y=37.500001',
      ),
      fake.response,
    )

    expect(fake.getStatusCode()).toBe(400)
    expect(fake.getBody()).toMatchObject({ code: 'POINTS_TOO_CLOSE' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
