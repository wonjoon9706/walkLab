import type { ServerResponse } from 'node:http'
import { createSeoulBusProvider } from '../../server/tago/seoulBusProvider.js'
import {
  authenticateAllowedTransitUser,
  isRemoteDeployment,
  loadLocalEnvironment,
  parseCoordinate,
  readJsonBody,
  sendJson,
  type RequestWithBody,
} from '../../server/shared/localTransitAuth.js'

loadLocalEnvironment()

export default async function handler(
  request: RequestWithBody,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'POST') {
    sendJson(response, 405, { code: 'INVALID_REQUEST', message: 'POST 요청만 사용할 수 있습니다.' })
    return
  }
  if (isRemoteDeployment()) {
    sendJson(response, 503, { code: 'PRODUCTION_DISABLED', message: '서울시 버스 증거 조회는 localhost에서만 사용할 수 있습니다.' })
    return
  }
  const auth = await authenticateAllowedTransitUser(request)
  if (!auth.ok) {
    sendJson(response, auth.statusCode, { code: auth.code, message: auth.message })
    return
  }
  const serviceKey = process.env.TAGO_SERVICE_KEY
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
  const provider = createSeoulBusProvider({
    fetch,
    serviceKey,
    allowInsecureHttp: true,
  })
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10_000)
  try {
    if (operation === 'nearby_stops') {
      const coordinate = parseCoordinate(record.coordinate)
      if (coordinate === null) throw new Error('INVALID_REQUEST')
      sendJson(response, 200, await provider.getNearbyStops(coordinate, controller.signal))
    } else if (operation === 'routes_at_stop' && typeof record.arsId === 'string') {
      sendJson(response, 200, await provider.getRoutesAtStop(record.arsId, controller.signal))
    } else if (operation === 'route_arrivals' && typeof record.routeId === 'string') {
      sendJson(response, 200, await provider.getRouteArrivals(record.routeId, controller.signal))
    } else {
      sendJson(response, 400, { code: 'INVALID_REQUEST', message: '버스 증거 조회 파라미터를 확인해 주세요.' })
    }
  } catch (error) {
    const invalid = error instanceof Error && error.message === 'INVALID_REQUEST'
    sendJson(response, invalid ? 400 : 502, {
      code: invalid ? 'INVALID_REQUEST' : 'NETWORK_ERROR',
      message: invalid ? '좌표를 확인해 주세요.' : '서울시 버스 증거 조회에 실패했습니다.',
    })
  } finally {
    clearTimeout(timeoutId)
  }
}
