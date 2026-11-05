import type { ServerResponse } from 'node:http'
import { parseKakaoTransitRouteResponse } from '../../src/services/routing/kakaoTransitRouteParser.js'
import {
  authenticateAllowedTransitUser,
  isRemoteDeployment,
  loadLocalEnvironment,
  parseCoordinate,
  readJsonBody,
  sendJson,
  type RequestWithBody,
} from '../../server/shared/localTransitAuth.js'

const KAKAO_TRANSIT_URL = 'https://dapi.kakao.com/v2/routing/publictraffic'
const REQUEST_TIMEOUT_MS = 10_000
const activeUsers = new Set<string>()

loadLocalEnvironment()

export default async function handler(
  request: RequestWithBody,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    sendJson(response, 405, { code: 'INVALID_REQUEST', message: 'POST 요청만 사용할 수 있습니다.' })
    return
  }
  if (isRemoteDeployment()) {
    sendJson(response, 503, { code: 'PRODUCTION_DISABLED', message: '카카오 대중교통 경로는 localhost 개발 환경에서만 사용할 수 있습니다.' })
    return
  }
  const auth = await authenticateAllowedTransitUser(request)
  if (!auth.ok) {
    sendJson(response, auth.statusCode, { code: auth.code, message: auth.message })
    return
  }
  if (activeUsers.has(auth.userId)) {
    sendJson(response, 409, { code: 'QUOTA_EXCEEDED', message: '이전 카카오 경로 요청이 진행 중입니다.' })
    return
  }
  let body: unknown
  try {
    body = await readJsonBody(request)
  } catch {
    sendJson(response, 400, { code: 'INVALID_REQUEST', message: '요청 형식이 올바르지 않습니다.' })
    return
  }
  const start = parseCoordinate((body as { start?: unknown } | null)?.start)
  const destination = parseCoordinate((body as { destination?: unknown } | null)?.destination)
  if (start === null || destination === null) {
    sendJson(response, 400, { code: 'INVALID_REQUEST', message: '출발지와 목적지 좌표를 확인해 주세요.' })
    return
  }
  const key = process.env.KAKAO_REST_API_KEY
  if (!key) {
    sendJson(response, 503, { code: 'SERVER_NOT_CONFIGURED', message: '카카오 REST API 키가 설정되지 않았습니다.' })
    return
  }

  const url = new URL(KAKAO_TRANSIT_URL)
  url.searchParams.set('start_x', start.longitude.toString())
  url.searchParams.set('start_y', start.latitude.toString())
  url.searchParams.set('end_x', destination.longitude.toString())
  url.searchParams.set('end_y', destination.latitude.toString())
  url.searchParams.set('input_coord', 'WGS84')
  url.searchParams.set('output_coord', 'WGS84')
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  activeUsers.add(auth.userId)
  try {
    const providerResponse = await fetch(url, {
      headers: { Authorization: `KakaoAK ${key}` },
      signal: controller.signal,
    })
    const providerBody: unknown = await providerResponse.json().catch(() => null)
    if (!providerResponse.ok) {
      const code = providerResponse.status === 401 || providerResponse.status === 403
        ? 'KAKAO_AUTH_ERROR'
        : providerResponse.status === 429
          ? 'QUOTA_EXCEEDED'
          : 'NETWORK_ERROR'
      sendJson(response, providerResponse.status === 429 ? 429 : 502, {
        code,
        message: code === 'KAKAO_AUTH_ERROR'
          ? '카카오 REST API 권한을 확인해 주세요.'
          : '카카오 대중교통 경로 조회에 실패했습니다.',
      })
      return
    }
    sendJson(response, 200, parseKakaoTransitRouteResponse(providerBody))
  } catch (error) {
    const timeout = error instanceof Error && error.name === 'AbortError'
    sendJson(response, timeout ? 504 : 502, {
      code: timeout ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
      message: timeout ? '카카오 경로 조회 시간이 초과됐습니다.' : '카카오 경로 서버에 연결하지 못했습니다.',
    })
  } finally {
    clearTimeout(timeoutId)
    activeUsers.delete(auth.userId)
  }
}
