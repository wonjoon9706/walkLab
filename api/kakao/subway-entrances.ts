import type { ServerResponse } from 'node:http'
import {
  authenticateAllowedTransitUser,
  isKakaoTransitEnabled,
  loadLocalEnvironment,
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
  if (!isKakaoTransitEnabled()) {
    sendJson(response, 503, { code: 'PRODUCTION_DISABLED', message: '이 환경의 카카오 출입구 검색이 활성화되지 않았습니다.' })
    return
  }
  const auth = await authenticateAllowedTransitUser(request)
  if (!auth.ok) {
    sendJson(response, auth.statusCode, { code: auth.code, message: auth.message })
    return
  }
  const key = process.env.KAKAO_REST_API_KEY
  if (!key) {
    sendJson(response, 503, { code: 'SERVER_NOT_CONFIGURED', message: '카카오 REST API 키가 설정되지 않았습니다.' })
    return
  }
  let body: unknown
  try {
    body = await readJsonBody(request)
  } catch {
    body = null
  }
  const query = typeof body === 'object' && body !== null &&
    typeof (body as { query?: unknown }).query === 'string'
    ? (body as { query: string }).query.trim()
    : ''
  if (query.length < 2 || query.length > 80) {
    sendJson(response, 400, { code: 'INVALID_REQUEST', message: '출입구 검색어를 확인해 주세요.' })
    return
  }
  const url = new URL('https://dapi.kakao.com/v2/local/search/keyword.json')
  url.searchParams.set('query', query)
  url.searchParams.set('size', '15')
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8_000)
  try {
    const providerResponse = await fetch(url, {
      headers: { Authorization: `KakaoAK ${key}` },
      signal: controller.signal,
    })
    const providerBody: unknown = await providerResponse.json().catch(() => null)
    if (!providerResponse.ok || typeof providerBody !== 'object' || providerBody === null) {
      const code = providerResponse.status === 401 || providerResponse.status === 403
        ? 'KAKAO_AUTH_ERROR' : providerResponse.status === 429 ? 'QUOTA_EXCEEDED' : 'NETWORK_ERROR'
      sendJson(response, code === 'QUOTA_EXCEEDED' ? 429 : 502, {
        code,
        message: code === 'KAKAO_AUTH_ERROR' ? '카카오 장소검색 인증키 또는 권한을 확인해 주세요.'
          : code === 'QUOTA_EXCEEDED' ? '카카오 장소검색 호출 한도를 초과했습니다.'
            : '카카오 출입구 검색에 실패했습니다.',
      })
      return
    }
    const documents = Array.isArray((providerBody as { documents?: unknown }).documents)
      ? (providerBody as { documents: Array<Record<string, unknown>> }).documents
      : []
    const places = documents.flatMap((document) => {
      const latitude = Number(document.y)
      const longitude = Number(document.x)
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        typeof document.id !== 'string' || typeof document.place_name !== 'string') return []
      return [{
        id: document.id,
        name: document.place_name,
        address: typeof document.address_name === 'string' ? document.address_name : '',
        roadAddress: typeof document.road_address_name === 'string' && document.road_address_name.length > 0
          ? document.road_address_name
          : null,
        categoryName: typeof document.category_name === 'string' ? document.category_name : '',
        categoryGroupCode: typeof document.category_group_code === 'string'
          ? document.category_group_code
          : '',
        coordinate: { latitude, longitude },
      }]
    })
    sendJson(response, 200, places)
  } catch (error) {
    const timeout = error instanceof Error && error.name === 'AbortError'
    sendJson(response, timeout ? 504 : 502, {
      code: timeout ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
      message: timeout ? '출입구 검색 시간이 초과됐습니다.' : '출입구 검색 서버에 연결하지 못했습니다.',
    })
  } finally {
    clearTimeout(timeoutId)
  }
}
