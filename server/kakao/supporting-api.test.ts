import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser } }) }))
import entrances from '../../api/kakao/subway-entrances.js'
import busEvidence from '../../api/kakao/seoul-bus-evidence.js'

const userId = '11111111-1111-4111-8111-111111111111'
function request(authenticated = true) {
  return {
    method: 'POST', headers: authenticated ? { authorization: 'Bearer test-token' } : {},
    body: { query: '테스트역 1번출구' },
  } as IncomingMessage & { body: unknown }
}
function response() {
  let statusCode = 0
  let body: unknown
  const value = {
    get statusCode() { return statusCode },
    set statusCode(value: number) { statusCode = value },
    setHeader() {},
    end(text: string) { body = JSON.parse(text) },
  } as unknown as ServerResponse
  return { value, status: () => statusCode, body: () => body }
}
beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('KAKAO_TRANSIT_PRODUCTION_ENABLED', '')
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'test-public')
  vi.stubEnv('TRANSIT_ALLOWED_USER_ID', userId)
  vi.stubEnv('KAKAO_REST_API_KEY', 'server-test-only')
  getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('운영 지원 API', () => {
  it.each(['production', 'preview'])('%s의 출입구 검색은 기본 차단하고 활성화 후 HTTPS로 요청한다', async (environment) => {
    vi.stubEnv('VERCEL_ENV', environment)
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ documents: [] })))
    vi.stubGlobal('fetch', fetchMock)
    const disabled = response()
    await entrances(request(), disabled.value)
    expect(disabled.status()).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
    vi.stubEnv('KAKAO_TRANSIT_PRODUCTION_ENABLED', 'true')
    const enabled = response()
    await entrances(request(), enabled.value)
    expect(enabled.status()).toBe(200)
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https:\/\/dapi\.kakao\.com\//)
    expect(JSON.stringify(enabled.body())).not.toContain('server-test-only')
  })

  it('출입구 운영 허용 후에도 JWT가 없으면 요청하지 않는다', async () => {
    vi.stubEnv('KAKAO_TRANSIT_PRODUCTION_ENABLED', 'true')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = response()
    await entrances(request(false), result.value)
    expect(result.status()).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([401, 429])('출입구 공급자 오류 %s를 구분한다', async (status) => {
    vi.stubEnv('KAKAO_TRANSIT_PRODUCTION_ENABLED', 'true')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })))
    const result = response()
    await entrances(request(), result.value)
    expect(result.body()).toMatchObject({ code: status === 401 ? 'KAKAO_AUTH_ERROR' : 'QUOTA_EXCEEDED' })
  })

  it.each(['production', 'preview'])('%s에서는 카카오 플래그로 서울시 HTTP 검증을 열 수 없다', async (environment) => {
    vi.stubEnv('VERCEL_ENV', environment)
    vi.stubEnv('KAKAO_TRANSIT_PRODUCTION_ENABLED', 'true')
    vi.stubEnv('SEOUL_BUS_API_LOCAL_ENABLED', 'true')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = response()
    await busEvidence(request(), result.value)
    expect(result.body()).toMatchObject({ code: 'PRODUCTION_DISABLED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
