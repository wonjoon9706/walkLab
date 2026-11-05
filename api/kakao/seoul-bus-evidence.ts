import type { ServerResponse } from 'node:http'
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

export default async function handler(
  request: RequestWithBody,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'POST') {
    sendJson(response, 405, { code: 'INVALID_REQUEST', message: 'POST 요청만 사용할 수 있습니다.' })
    return
  }
  const auth = await authenticateAllowedTransitUser(request)
  if (!auth.ok) {
    sendJson(response, auth.statusCode, { code: auth.code, message: auth.message })
    return
  }
  const serviceKey = process.env.SEOUL_BUS_SERVICE_KEY?.trim() || process.env.TAGO_SERVICE_KEY?.trim()
  if (!serviceKey) {
    sendJson(response, 503, { code: 'SERVER_NOT_CONFIGURED', message: '서울시 버스 인증키가 설정되지 않았습니다.' })
    return
  }
  let body: unknown
  try {
    body = await readJsonBody(request)
  } catch {
    sendJson(response, 400, { code: 'INVALID_REQUEST', message: '요청 형식이 올바르지 않습니다.' })
    return
  }
  const record = typeof body === 'object' && body !== null
    ? body as Record<string, unknown>
    : {}
  const operation = record.operation
  const coordinate = operation === 'nearby_stops' ? parseCoordinate(record.coordinate) : null
  const identifier = operation === 'routes_at_stop' ? record.arsId
    : operation === 'route_arrivals' ? record.routeId : null
  if (!(operation === 'nearby_stops' ? coordinate !== null
    : (operation === 'routes_at_stop' || operation === 'route_arrivals') &&
      typeof identifier === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(identifier))) {
    sendJson(response, 400, { code: 'INVALID_REQUEST', message: '버스 조회 파라미터를 확인해 주세요.' })
    return
  }
  const requestKey = JSON.stringify([auth.userId, operation, coordinate, identifier])
  const now = Date.now()
  for (const [key, value] of cache) if (value.expiresAt <= now) cache.delete(key)
  const cached = cache.get(requestKey)
  if (cached !== undefined) { sendJson(response, 200, cached.value); return }
  const provider = createSeoulBusProvider({
    fetch,
    serviceKey,
    allowInsecureHttp: true,
  })
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10_000)
  let pending = inFlight.get(requestKey)
  try {
    if (pending === undefined) {
      pending = operation === 'nearby_stops' && coordinate !== null
        ? provider.getNearbyStops(coordinate, controller.signal)
        : operation === 'routes_at_stop'
          ? provider.getRoutesAtStop(String(identifier), controller.signal)
          : provider.getRouteArrivals(String(identifier), controller.signal)
      inFlight.set(requestKey, pending)
    }
    const value = await pending
    // 도착정보는 기존 클라이언트의 30초 캐시만 사용한다. 서버에서 다시 캐시해
    // 원래 조회 시각을 새 시각처럼 보이게 하는 이중 캐시는 추가하지 않는다.
    if (operation !== 'route_arrivals') {
      if (cache.size >= 100) cache.delete(cache.keys().next().value!)
      cache.set(requestKey, { value, expiresAt: Date.now() + 30_000 })
    }
    sendJson(response, 200, value)
  } catch (error) {
    const cause = error instanceof SeoulBusProviderStageError ? error.originalError : error
    const timeout = typeof cause === 'object' && cause !== null && 'name' in cause &&
      (cause.name === 'AbortError' || cause.name === 'TimeoutError')
    const limited = cause instanceof SeoulBusHttpError && cause.status === 429
    const authFailed = cause instanceof SeoulBusHttpError && [401, 403].includes(cause.status)
    const invalid = cause instanceof SeoulBusResponseError && cause.kind === 'invalid_response'
    const providerError = cause instanceof SeoulBusResponseError || cause instanceof SeoulBusHttpError
    sendJson(response, timeout ? 504 : limited ? 429 : 502, {
      code: timeout ? 'REQUEST_TIMEOUT' : limited ? 'QUOTA_EXCEEDED'
        : authFailed ? 'SEOUL_BUS_AUTH_ERROR' : invalid ? 'INVALID_RESPONSE' : providerError ? 'SEOUL_BUS_API_ERROR' : 'NETWORK_ERROR',
      message: timeout ? '서울시 버스 응답 대기시간이 초과됐습니다.'
        : limited ? '서울시 버스 API 호출 한도를 초과했습니다.'
          : invalid ? '서울시 버스 응답 형식이 올바르지 않습니다.'
            : authFailed ? '서울시 버스 인증키 또는 접근 권한을 확인해 주세요.'
              : providerError ? '서울시 버스 제공기관에서 요청을 처리하지 못했습니다.'
              : '서울시 버스 서버에 연결하지 못했습니다.',
    })
  } finally {
    if (inFlight.get(requestKey) === pending) inFlight.delete(requestKey)
    clearTimeout(timeoutId)
  }
}
