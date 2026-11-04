import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: getUserMock } }),
}))

import handler from './transit-routes'

const USER_ID = '11111111-1111-4111-8111-111111111111'

function request() {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
    body: {
      start: { latitude: 37.49, longitude: 126.97 },
      destination: { latitude: 37.54, longitude: 127.06 },
    },
  } as IncomingMessage & { body: unknown }
}

function response() {
  let statusCode = 200
  let body: unknown
  const value = {
    set statusCode(next: number) { statusCode = next },
    get statusCode() { return statusCode },
    setHeader: vi.fn(),
    end: vi.fn((text: string) => { body = JSON.parse(text) }),
  } as unknown as ServerResponse
  return { value, status: () => statusCode, body: () => body }
}

const providerBody = {
  status: 'OK',
  properties: { total: 1, bus: 0, subway: 1, busAndSubway: 0 },
  routes: [{
    properties: {
      type: 'SUBWAY',
      totalDistance: 10_000,
      totalTime: 1_800,
      transfers: 0,
      fare: { value: 1_500 },
    },
    steps: [{
      properties: {
        type: 'SUBWAY',
        guidance: '7호선',
        distance: 10_000,
        time: 1_800,
        stops: [{ name: '이수' }, { name: '건대입구' }],
        vehicles: [{ name: '7호선', type: '일반' }],
      },
      path: { points: [[126.98, 37.48], [127.06, 37.54]] },
    }],
  }],
}

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'publishable'
  process.env.TMAP_TRANSIT_ALLOWED_USER_ID = USER_ID
  process.env.KAKAO_REST_API_KEY = 'server-only-test-key'
  delete process.env.VERCEL_ENV
  getUserMock.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  delete process.env.VERCEL_ENV
})

describe('local Kakao public transit function', () => {
  it('서버 키로 일반 routes/steps API를 호출하고 정규화한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(providerBody), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const fake = response()

    await handler(request(), fake.value)

    expect(fake.status()).toBe(200)
    expect(fake.body()).toMatchObject({ provider: 'kakao-map-publictraffic' })
    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string)
    expect(calledUrl.pathname).toBe('/v2/routing/publictraffic')
    expect(calledUrl.searchParams.get('start_x')).toBe('126.97')
    expect(calledUrl.searchParams.get('start_y')).toBe('37.49')
    expect(calledUrl.searchParams.get('end_x')).toBe('127.06')
    expect(calledUrl.searchParams.get('end_y')).toBe('37.54')
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers)
      .toEqual({ Authorization: 'KakaoAK server-only-test-key' })
  })

  it('production과 preview에서는 외부 API를 호출하지 않는다', async () => {
    process.env.VERCEL_ENV = 'production'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const fake = response()

    await handler(request(), fake.value)

    expect(fake.status()).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
