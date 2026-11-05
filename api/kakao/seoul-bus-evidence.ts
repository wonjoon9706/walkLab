import type { ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createSeoulBusProvider, SeoulBusHttpError, SeoulBusProviderStageError } from '../../server/tago/seoulBusProvider.js'
import { SeoulBusResponseError } from '../../server/tago/seoulBusResponseParser.js'
import {
  authenticateAllowedTransitUser,
  loadLocalEnvironment,
  parseCoordinate,
  readJsonBody,
  sendJson,
  type RequestWithBody,
} from '../../server/shared/localTransitAuth.js'

loadLocalEnvironment()

const cache = new Map<string, { expiresAt: number; value: unknown }>()
const inFlight = new Map<string, Promise<unknown>>()
export function resetSeoulBusEvidenceCacheForTests(): void {
  cache.clear()
  inFlight.clear()
}

export const seoulBusEvidenceTimeouts = { authMs: 5_000, upstreamMs: 10_000 } as const

async function withDeadline<T>(work: () => Promise<T>, milliseconds: number, controller: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new DOMException('Request deadline exceeded', 'TimeoutError'))
    }, milliseconds)
  })
  try { return await Promise.race([work(), deadline]) }
  finally { clearTimeout(timer!) }
}

function safeNetworkCode(error: unknown): string | null {
  const allowed = ['UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']
  for (let depth = 0; depth < 3 && typeof error === 'object' && error !== null; depth += 1) {
    if ('code' in error && typeof error.code === 'string' && allowed.includes(error.code)) return error.code
    error = 'cause' in error ? error.cause : null
  }
  return null
}

export default async function handler(request: RequestWithBody, response: ServerResponse): Promise<void> {
  const startedAt = Date.now()
  const requestId = randomUUID()
  let operation: string | null = null
  let stage = 'auth'
  let authMs = 0
  let upstreamMs = 0
  let keySource: 'seoul' | 'tago_fallback' | 'missing' = 'missing'
  let cacheStatus = 'miss'
  // 키·JWT·사용자 ID·좌표·노선 ID·인증 URL은 진단에 포함하지 않는다.
  function report(status: number, body: unknown, extra: Record<string, string | number | null> = {}) {
    response.setHeader('X-Smart-Arrival-Request-Id', requestId)
    response.setHeader('Server-Timing', `auth;dur=${authMs}, upstream;dur=${upstreamMs}`)
    const code = typeof body === 'object' && body !== null && 'code' in body ? body.code : null
    console.info(JSON.stringify({ event: 'seoul_bus_evidence', requestId, operation, stage,
      status, code, elapsedMs: Date.now() - startedAt, authMs, upstreamMs, keySource, cacheStatus, ...extra }))
    sendJson(response, status, body)
  }
  if (request.method !== 'POST') {
    report(405, { code: 'INVALID_REQUEST', message: 'POST 요청만 사용할 수 있습니다.' })
    return
  }
  const authController = new AbortController()
  let auth: Awaited<ReturnType<typeof authenticateAllowedTransitUser>>
  try {
    auth = await withDeadline(() => authenticateAllowedTransitUser(request, authController.signal),
      seoulBusEvidenceTimeouts.authMs, authController)
  } catch (error) {
    authMs = Date.now() - startedAt
    const timeout = authController.signal.aborted
    report(timeout ? 504 : 502, { code: timeout ? 'AUTH_REQUEST_TIMEOUT' : 'AUTH_SERVICE_UNAVAILABLE',
      message: '로그인 인증 서버 응답을 확인하지 못했습니다.' }, { networkCode: safeNetworkCode(error) })
    return
  }
  authMs = Date.now() - startedAt
  if (!auth.ok) { report(auth.statusCode, { code: auth.code, message: auth.message }); return }
  stage = 'validation'
  const seoulKey = process.env.SEOUL_BUS_SERVICE_KEY?.trim()
  const serviceKey = seoulKey || process.env.TAGO_SERVICE_KEY?.trim()
  keySource = seoulKey ? 'seoul' : serviceKey ? 'tago_fallback' : 'missing'
  if (!serviceKey) { report(503, { code: 'SERVER_NOT_CONFIGURED', message: '서울시 버스 인증키가 설정되지 않았습니다.' }); return }
  let body: unknown
  try { body = await readJsonBody(request) }
  catch { report(400, { code: 'INVALID_REQUEST', message: '요청 형식이 올바르지 않습니다.' }); return }
  const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
  operation = typeof record.operation === 'string' && ['nearby_stops', 'routes_at_stop', 'route_arrivals'].includes(record.operation)
    ? record.operation : null
  const coordinate = operation === 'nearby_stops' ? parseCoordinate(record.coordinate) : null
  const identifier = operation === 'routes_at_stop' ? record.arsId : operation === 'route_arrivals' ? record.routeId : null
  if (!(operation === 'nearby_stops' ? coordinate !== null
    : (operation === 'routes_at_stop' || operation === 'route_arrivals') &&
      typeof identifier === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(identifier))) {
    report(400, { code: 'INVALID_REQUEST', message: '버스 조회 파라미터를 확인해 주세요.' }); return
  }
  const requestKey = JSON.stringify([auth.userId, operation, coordinate, identifier])
  const now = Date.now()
  for (const [key, value] of cache) if (value.expiresAt <= now) cache.delete(key)
  const cached = cache.get(requestKey)
  if (cached !== undefined) { cacheStatus = 'hit'; report(200, cached.value); return }
  const provider = createSeoulBusProvider({ fetch, serviceKey, allowInsecureHttp: true })
  const upstreamStart = Date.now()
  stage = 'upstream'
  let pending = inFlight.get(requestKey)
  cacheStatus = pending === undefined ? 'miss' : 'shared'
  console.info(JSON.stringify({ event: 'seoul_bus_evidence_start', requestId, operation, stage, authMs, keySource, cacheStatus }))
  try {
    if (pending === undefined) {
      const controller = new AbortController()
      pending = withDeadline<unknown>(() => operation === 'nearby_stops' && coordinate !== null
        ? provider.getNearbyStops(coordinate, controller.signal)
        : operation === 'routes_at_stop' ? provider.getRoutesAtStop(String(identifier), controller.signal)
          : provider.getRouteArrivals(String(identifier), controller.signal),
      seoulBusEvidenceTimeouts.upstreamMs, controller)
      inFlight.set(requestKey, pending)
    }
    const value = await pending
    upstreamMs = Date.now() - upstreamStart
    // 도착정보는 클라이언트의 30초 캐시만 사용하여 원본 조회 시각을 유지한다.
    if (operation !== 'route_arrivals') {
      if (cache.size >= 100) cache.delete(cache.keys().next().value!)
      cache.set(requestKey, { value, expiresAt: Date.now() + 30_000 })
    }
    report(200, value)
  } catch (error) {
    upstreamMs = Date.now() - upstreamStart
    const cause = error instanceof SeoulBusProviderStageError ? error.originalError : error
    const timeout = typeof cause === 'object' && cause !== null && 'name' in cause &&
      (cause.name === 'AbortError' || cause.name === 'TimeoutError')
    const limited = cause instanceof SeoulBusHttpError && cause.status === 429
    const authFailed = cause instanceof SeoulBusHttpError && [401, 403].includes(cause.status) ||
      cause instanceof SeoulBusResponseError && /SERVICE_KEY|NOT REGISTERED|AUTHENTICATION|ACCESS DENIED|인증/iu.test(cause.message)
    const invalid = cause instanceof SeoulBusResponseError && cause.kind === 'invalid_response'
    const providerError = cause instanceof SeoulBusResponseError || cause instanceof SeoulBusHttpError
    report(timeout ? 504 : limited ? 429 : 502, {
      code: timeout ? 'REQUEST_TIMEOUT' : limited ? 'QUOTA_EXCEEDED'
        : authFailed ? 'SEOUL_BUS_AUTH_ERROR' : invalid ? 'INVALID_RESPONSE' : providerError ? 'SEOUL_BUS_API_ERROR' : 'NETWORK_ERROR',
      message: timeout ? '서울시 버스 응답 대기시간이 초과됐습니다.'
        : limited ? '서울시 버스 API 호출 한도를 초과했습니다.'
          : invalid ? '서울시 버스 응답 형식이 올바르지 않습니다.'
            : authFailed ? '서울시 버스 인증키 또는 접근 권한을 확인해 주세요.'
              : providerError ? '서울시 버스 제공기관에서 요청을 처리하지 못했습니다.' : '서울시 버스 서버에 연결하지 못했습니다.',
    }, { upstreamStatus: cause instanceof SeoulBusHttpError ? cause.status : null,
      providerCode: cause instanceof SeoulBusResponseError && /^\d{1,4}$/.test(cause.providerCode ?? '') ? cause.providerCode : null,
      networkCode: safeNetworkCode(cause) })
  } finally {
    if (inFlight.get(requestKey) === pending) inFlight.delete(requestKey)
  }
}
