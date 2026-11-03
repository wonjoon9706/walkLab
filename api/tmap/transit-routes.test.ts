import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: getUserMock } }),
}))

import handler from './transit-routes'

const ALLOWED_USER_ID = '11111111-1111-4111-8111-111111111111'

function createResponse() {
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

function createRequest() {
  return {
    method: 'POST',
    url: '/api/tmap/transit-routes',
    headers: { authorization: 'Bearer test-token' },
    body: {
      start: { latitude: 37.5, longitude: 127.1 },
      destination: { latitude: 37.6, longitude: 127.2 },
    },
  } as IncomingMessage & { body: unknown }
}

const providerResponse = {
  metaData: {
    plan: {
      itineraries: [{
        fare: { regular: { totalFare: 1500 } },
        totalTime: 900,
        totalWalkTime: 200,
        totalWalkDistance: 250,
        totalDistance: 4000,
        transferCount: 0,
        legs: [{
          mode: 'BUS',
          sectionTime: 700,
          distance: 3750,
          route: '100',
          start: { name: 'A' },
          end: { name: 'B' },
          passShape: { linestring: '127.1,37.5 127.2,37.6' },
        }],
      }],
    },
  },
}

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'publishable-key'
  process.env.TMAP_TRANSIT_APP_KEY = 'server-only-key'
  process.env.TMAP_TRANSIT_ALLOWED_USER_ID = ALLOWED_USER_ID
  delete process.env.VERCEL_ENV
  delete process.env.TMAP_TRANSIT_PRODUCTION_ENABLED
  getUserMock.mockResolvedValue({
    data: { user: { id: ALLOWED_USER_ID } },
    error: null,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  delete process.env.TMAP_TRANSIT_APP_KEY
  delete process.env.TMAP_TRANSIT_ALLOWED_USER_ID
  delete process.env.TMAP_TRANSIT_PRODUCTION_ENABLED
  delete process.env.VERCEL_ENV
})

describe('Vercel TMAP 대중교통 함수', () => {
  it('로그인 사용자의 WGS84 좌표와 서버 앱 키를 TMAP에 전달한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(providerResponse), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const fake = createResponse()

    await handler(createRequest(), fake.response)

    expect(fake.getStatusCode()).toBe(200)
    expect(fake.getBody()).toMatchObject({ provider: 'tmap-transit' })
    const options = fetchMock.mock.calls[0][1] as RequestInit
    expect(options.headers).toMatchObject({ appKey: 'server-only-key' })
    expect(JSON.parse(options.body as string)).toMatchObject({
      startX: '127.1',
      startY: '37.5',
      endX: '127.2',
      endY: '37.6',
    })
  })

  it('로그인하지 않은 요청은 유료 API를 호출하지 않는다', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const fake = createResponse()

    await handler(createRequest(), fake.response)

    expect(fake.getStatusCode()).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Production에서는 영속 사용량 제한이 없어 호출을 기본 차단한다', async () => {
    process.env.VERCEL_ENV = 'production'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const fake = createResponse()

    await handler(createRequest(), fake.response)

    expect(fake.getStatusCode()).toBe(503)
    expect(fake.getBody()).toMatchObject({ code: 'PRODUCTION_DISABLED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('허용된 사용자와 명시적 활성화가 모두 있으면 Production 호출을 허용한다', async () => {
    process.env.VERCEL_ENV = 'production'
    process.env.TMAP_TRANSIT_PRODUCTION_ENABLED = 'true'
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(providerResponse), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const fake = createResponse()

    await handler(createRequest(), fake.response)

    expect(fake.getStatusCode()).toBe(200)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('허용 목록과 다른 로그인 사용자는 403으로 차단한다', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: '22222222-2222-4222-8222-222222222222' } },
      error: null,
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const fake = createResponse()

    await handler(createRequest(), fake.response)

    expect(fake.getStatusCode()).toBe(403)
    expect(fake.getBody()).toMatchObject({ code: 'USER_NOT_ALLOWED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('허용 사용자 ID가 없거나 UUID가 아니면 호출하지 않는다', async () => {
    process.env.TMAP_TRANSIT_ALLOWED_USER_ID = 'invalid-user-id'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const fake = createResponse()

    await handler(createRequest(), fake.response)

    expect(fake.getStatusCode()).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('서버 앱 키가 없으면 유료 API를 호출하지 않는다', async () => {
    delete process.env.TMAP_TRANSIT_APP_KEY
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const fake = createResponse()

    await handler(createRequest(), fake.response)

    expect(fake.getStatusCode()).toBe(503)
    expect(fake.getBody()).toMatchObject({ code: 'SERVER_NOT_CONFIGURED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
