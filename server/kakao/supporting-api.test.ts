import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser } }) }))
import entrances from '../../api/kakao/subway-entrances.js'
import busEvidence, { resetSeoulBusEvidenceCacheForTests, seoulBusEvidenceTimeouts } from '../../api/kakao/seoul-bus-evidence.js'

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
  const headers = new Map<string, string>()
  const value = {
    get statusCode() { return statusCode },
    set statusCode(value: number) { statusCode = value },
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value) },
    end(text: string) { body = JSON.parse(text) },
  } as unknown as ServerResponse
  return { value, status: () => statusCode, body: () => body, headers }
}
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  resetSeoulBusEvidenceCacheForTests()
  vi.stubEnv('SEOUL_BUS_SERVICE_KEY', 'bus-test-only')
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('KAKAO_TRANSIT_PRODUCTION_ENABLED', '')
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'test-public')
  vi.stubEnv('TRANSIT_ALLOWED_USER_ID', userId)
  vi.stubEnv('KAKAO_REST_API_KEY', 'server-test-only')
  getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('운영 지원 API', () => {
  it('응답하지 않는 인증 서버는 별도 코드로 종료하고 서울시를 호출하지 않는다', async () => {
    vi.useFakeTimers()
    getUser.mockReturnValue(new Promise(() => undefined))
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
    const result = response()
    const pending = busEvidence(request(), result.value)
    await vi.advanceTimersByTimeAsync(seoulBusEvidenceTimeouts.authMs)
    await pending
    expect(result.status()).toBe(504)
    expect(result.body()).toMatchObject({ code: 'AUTH_REQUEST_TIMEOUT' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.headers.get('server-timing')).toContain('auth;dur=5000')
  })

  it('abort에 응답하지 않는 서울시 요청도 10초에 종료하며 공유 요청과 재시도가 동작한다', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined))
    vi.stubGlobal('fetch', fetchMock)
    const req = request(); req.body = { operation: 'routes_at_stop', arsId: '10001' }
    const first = response(), second = response()
    const jobs = [busEvidence(req, first.value), busEvidence(req, second.value)]
    await vi.advanceTimersByTimeAsync(seoulBusEvidenceTimeouts.upstreamMs)
    await Promise.all(jobs)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(first.body()).toMatchObject({ code: 'REQUEST_TIMEOUT' })
    expect(second.body()).toMatchObject({ code: 'REQUEST_TIMEOUT' })
    expect(first.headers.get('server-timing')).toContain('upstream;dur=10000')
    expect(first.headers.get('x-smart-arrival-request-id')).toMatch(/^[a-f0-9-]{36}$/i)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ msgHeader: { headerCd: '0' }, msgBody: { itemList: [] } })))
    const retry = response()
    await busEvidence(req, retry.value)
    expect(retry.status()).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('HTTP 200 안의 명시적 인증 실패와 로그의 비밀정보 제외를 확인한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      msgHeader: { headerCd: '7', headerMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' },
    }))))
    const req = request(); req.body = { operation: 'route_arrivals', routeId: 'synthetic-route' }
    const result = response()
    await busEvidence(req, result.value)
    expect(result.body()).toMatchObject({ code: 'SEOUL_BUS_AUTH_ERROR' })
    const logs = vi.mocked(console.info).mock.calls.flat().join(' ')
    expect(logs).toContain('"providerCode":"7"')
    expect(logs).not.toMatch(/bus-test-only|test-token|synthetic-route|ServiceKey=|11111111-1111/)
  })
  it('XML 인증 오류도 응답 형식 오류나 정류장 없음으로 처리하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>')))
    const req = request(); req.body = { operation: 'routes_at_stop', arsId: '10001' }
    const result = response()
    await busEvidence(req, result.value)
    expect(result.body()).toMatchObject({ code: 'SEOUL_BUS_AUTH_ERROR' })
  })

  it('TAGO 변수 fallback도 동일 서비스키 문자열로 전송하며 별도 키가 우선한다', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ msgHeader: { headerCd: '0' }, msgBody: { itemList: [] } })))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('TAGO_SERVICE_KEY', 'fake-decoded+/=')
    vi.stubEnv('SEOUL_BUS_SERVICE_KEY', '')
    const req = request(); req.body = { operation: 'route_arrivals', routeId: 'test' }
    await busEvidence(req, response().value)
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('ServiceKey')).toBe('fake-decoded+/=')
    vi.stubEnv('SEOUL_BUS_SERVICE_KEY', 'seoul-priority')
    await busEvidence(req, response().value)
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('ServiceKey')).toBe('seoul-priority')
  })
  it('동일한 진행 중 요청을 공유하고 실패 후 다시 시도할 수 있다', async () => {
    let finish: (response: Response) => void = () => undefined
    const pending = new Promise<Response>((resolve) => { finish = resolve })
    const fetchMock = vi.fn().mockReturnValue(pending)
    vi.stubGlobal('fetch', fetchMock)
    const req = request(); req.body = { operation: 'routes_at_stop', arsId: '10001' }
    const first = response(), second = response()
    const jobs = [busEvidence(req, first.value), busEvidence(req, second.value)]
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    finish(new Response('{}', { status: 429 }))
    await Promise.all(jobs)
    expect(first.body()).toMatchObject({ code: 'QUOTA_EXCEEDED' })
    expect(second.body()).toMatchObject({ code: 'QUOTA_EXCEEDED' })
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ msgHeader: { headerCd: '0' }, msgBody: { itemList: [] } })))
    await busEvidence(req, response().value)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('버스 지연과 비정상 응답을 구분하고 외부 URL을 입력받지 않는다', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('timeout', 'AbortError'))
    vi.stubGlobal('fetch', fetchMock)
    const req = request(); req.body = { operation: 'routes_at_stop', arsId: '10001' }
    const timeout = response(); await busEvidence(req, timeout.value)
    expect(timeout.body()).toMatchObject({ code: 'REQUEST_TIMEOUT' })
    fetchMock.mockResolvedValue(new Response('invalid'))
    const invalid = response(); await busEvidence(req, invalid.value)
    expect(invalid.body()).toMatchObject({ code: 'INVALID_RESPONSE' })
    req.body = { operation: 'route_arrivals', routeId: 'http://example.invalid/' }
    const malformed = response(); await busEvidence(req, malformed.value)
    expect(malformed.status()).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it.each(['development', 'production', 'preview'])('%s에서도 인증 후 공식 버스 API를 호출하고 빈 결과와 캐시를 유지한다', async (env) => {
    vi.stubEnv('VERCEL_ENV', env)
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      msgHeader: { headerCd: '0' }, msgBody: { itemList: [] },
    })))
    vi.stubGlobal('fetch', fetchMock)
    const req = request()
    req.body = { operation: 'nearby_stops', coordinate: { latitude: 37.5, longitude: 127 } }
    const first = response(), second = response()
    await busEvidence(req, first.value)
    await busEvidence(req, second.value)
    expect(first.status()).toBe(200)
    expect(first.body()).toEqual([])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(new URL(String(fetchMock.mock.calls[0][0])).host).toBe('ws.bus.go.kr')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
    expect(JSON.stringify(first.body())).not.toContain('bus-test-only')
  })

  it.each([401, 429, 500])('버스 제공기관 HTTP %s는 매칭 실패가 아니라 API 오류다', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })))
    const req = request(); req.body = { operation: 'routes_at_stop', arsId: '10001' }
    const result = response()
    await busEvidence(req, result.value)
    expect(result.body()).toMatchObject({ code: status === 429 ? 'QUOTA_EXCEEDED'
      : status === 401 ? 'SEOUL_BUS_AUTH_ERROR' : 'SEOUL_BUS_API_ERROR' })
  })

  it('버스 인증·키 누락 시 외부 API를 호출하지 않는다', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
    const noAuth = response()
    await busEvidence(request(false), noAuth.value)
    expect(noAuth.status()).toBe(401)
    vi.stubEnv('SEOUL_BUS_SERVICE_KEY', '')
    vi.stubEnv('TAGO_SERVICE_KEY', '')
    const noKey = response()
    await busEvidence(request(), noKey.value)
    expect(noKey.body()).toMatchObject({ code: 'SERVER_NOT_CONFIGURED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
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

})
