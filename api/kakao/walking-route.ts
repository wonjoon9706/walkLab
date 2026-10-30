import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadEnvFile } from 'node:process'
import { createClient } from '@supabase/supabase-js'
import { WalkingRouteError } from '../../src/domain/walkingRoute'
import { parseKakaoWalkingRouteResponse } from '../../src/services/routing/kakaoWalkingRouteParser'

const KAKAO_WALKING_ROUTE_URL = 'https://dapi.kakao.com/v2/routing/walk'
const REQUEST_TIMEOUT_MS = 10_000
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_REQUESTS = 20

function loadLocalDevelopmentEnvironment(): void {
  if (
    process.env.VITEST ||
    process.env.VERCEL_ENV === 'production' ||
    process.env.VERCEL_ENV === 'preview'
  ) {
    return
  }

  try {
    // Vite와 Vercel Function은 별도 프로세스이므로 로컬 함수도 같은 파일을 읽는다.
    loadEnvFile('.env.local')
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : null
    if (code !== 'ENOENT') throw error
  }
}

loadLocalDevelopmentEnvironment()

type AuthenticationResult =
  | { ok: true; userId: string }
  | {
      ok: false
      statusCode: 401 | 503
      code:
        | 'AUTH_HEADER_MISSING'
        | 'AUTH_TOKEN_INVALID'
        | 'SERVER_AUTH_NOT_CONFIGURED'
      message: string
    }

interface RateLimitState {
  windowStartedAt: number
  count: number
}

const rateLimits = new Map<string, RateLimitState>()

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(body))
}

function getBearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    return null
  }
  const token = header.slice('Bearer '.length).trim()
  return token.length > 0 ? token : null
}

async function authenticateRequest(
  request: IncomingMessage,
): Promise<AuthenticationResult> {
  const token = getBearerToken(request)
  if (token === null) {
    return {
      ok: false,
      statusCode: 401,
      code: 'AUTH_HEADER_MISSING',
      message: '경로 요청에 로그인 인증 정보가 없습니다.',
    }
  }

  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!supabaseUrl || !publishableKey) {
    return {
      ok: false,
      statusCode: 503,
      code: 'SERVER_AUTH_NOT_CONFIGURED',
      message: '경로 서버의 Supabase 인증 설정이 없습니다.',
    }
  }

  const client = createClient(supabaseUrl, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  const { data, error } = await client.auth.getUser(token)
  if (error !== null || data.user === null) {
    return {
      ok: false,
      statusCode: 401,
      code: 'AUTH_TOKEN_INVALID',
      message: '로그인 인증 정보가 만료되었거나 올바르지 않습니다.',
    }
  }
  return { ok: true, userId: data.user.id }
}

function consumeRateLimit(userId: string, now: number): boolean {
  const current = rateLimits.get(userId)
  if (
    current === undefined ||
    now - current.windowStartedAt >= RATE_LIMIT_WINDOW_MS
  ) {
    rateLimits.set(userId, { windowStartedAt: now, count: 1 })
    return true
  }
  if (current.count >= RATE_LIMIT_REQUESTS) return false
  current.count += 1
  return true
}

function parseCoordinate(
  value: string | null,
  minimum: number,
  maximum: number,
): number | null {
  if (value === null || value.trim().length === 0) return null
  const numberValue = Number(value)
  return Number.isFinite(numberValue) &&
    numberValue >= minimum &&
    numberValue <= maximum
    ? numberValue
    : null
}

function distanceBetweenCoordinatesM(
  firstLatitude: number,
  firstLongitude: number,
  secondLatitude: number,
  secondLongitude: number,
): number {
  const earthRadiusM = 6_371_000
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180
  const latitudeDelta = toRadians(secondLatitude - firstLatitude)
  const longitudeDelta = toRadians(secondLongitude - firstLongitude)
  const firstLatitudeRadians = toRadians(firstLatitude)
  const secondLatitudeRadians = toRadians(secondLatitude)
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitudeRadians) *
      Math.cos(secondLatitudeRadians) *
      Math.sin(longitudeDelta / 2) ** 2
  return 2 * earthRadiusM * Math.asin(Math.sqrt(haversine))
}

function mapWalkingRouteError(error: WalkingRouteError): number {
  switch (error.code) {
    case 'POINTS_TOO_CLOSE':
    case 'INVALID_REQUEST':
      return 400
    case 'ROUTE_NOT_FOUND':
      return 422
    default:
      return 502
  }
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    sendJson(response, 405, {
      code: 'INVALID_REQUEST',
      message: 'GET 요청만 사용할 수 있습니다.',
    })
    return
  }

  const authenticated = await authenticateRequest(request)
  if (!authenticated.ok) {
    sendJson(response, authenticated.statusCode, {
      code: authenticated.code,
      message: authenticated.message,
    })
    return
  }
  if (!consumeRateLimit(authenticated.userId, Date.now())) {
    sendJson(response, 429, {
      code: 'QUOTA_EXCEEDED',
      message: '경로 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
    })
    return
  }

  const requestUrl = new URL(request.url ?? '/', 'http://localhost')
  const startLongitude = parseCoordinate(
    requestUrl.searchParams.get('start_x'),
    -180,
    180,
  )
  const startLatitude = parseCoordinate(
    requestUrl.searchParams.get('start_y'),
    -90,
    90,
  )
  const endLongitude = parseCoordinate(
    requestUrl.searchParams.get('end_x'),
    -180,
    180,
  )
  const endLatitude = parseCoordinate(
    requestUrl.searchParams.get('end_y'),
    -90,
    90,
  )

  if (
    startLongitude === null ||
    startLatitude === null ||
    endLongitude === null ||
    endLatitude === null
  ) {
    sendJson(response, 400, {
      code: 'INVALID_REQUEST',
      message: '출발지와 목적지 좌표를 확인해 주세요.',
    })
    return
  }
  if (
    distanceBetweenCoordinatesM(
      startLatitude,
      startLongitude,
      endLatitude,
      endLongitude,
    ) < 10
  ) {
    sendJson(response, 400, {
      code: 'POINTS_TOO_CLOSE',
      message: '출발지와 목적지가 너무 가깝습니다.',
    })
    return
  }

  const restApiKey = process.env.KAKAO_REST_API_KEY
  if (!restApiKey) {
    sendJson(response, 503, {
      code: 'SERVER_NOT_CONFIGURED',
      message: '도보 경로 서버 설정이 완료되지 않았습니다.',
    })
    return
  }

  const kakaoUrl = new URL(KAKAO_WALKING_ROUTE_URL)
  kakaoUrl.searchParams.set('start_x', startLongitude.toString())
  kakaoUrl.searchParams.set('start_y', startLatitude.toString())
  kakaoUrl.searchParams.set('end_x', endLongitude.toString())
  kakaoUrl.searchParams.set('end_y', endLatitude.toString())
  kakaoUrl.searchParams.set('input_coord', 'WGS84')
  kakaoUrl.searchParams.set('output_coord', 'WGS84')
  kakaoUrl.searchParams.set('route_mode', 'BROAD_FIRST')

  const abortController = new AbortController()
  const timeoutId = setTimeout(
    () => abortController.abort(),
    REQUEST_TIMEOUT_MS,
  )

  try {
    const kakaoResponse = await fetch(kakaoUrl, {
      headers: { Authorization: `KakaoAK ${restApiKey}` },
      signal: abortController.signal,
    })

    if (kakaoResponse.status === 401 || kakaoResponse.status === 403) {
      sendJson(response, 502, {
        code: 'KAKAO_AUTH_ERROR',
        message: '카카오 도보 경로 API 권한을 확인해 주세요.',
      })
      return
    }
    if (kakaoResponse.status === 429) {
      sendJson(response, 429, {
        code: 'QUOTA_EXCEEDED',
        message: '카카오 API 호출 한도를 초과했습니다.',
      })
      return
    }
    if (!kakaoResponse.ok) {
      sendJson(response, 502, {
        code: 'NETWORK_ERROR',
        message: '카카오 도보 경로 API 요청에 실패했습니다.',
      })
      return
    }

    let body: unknown
    try {
      body = await kakaoResponse.json()
    } catch {
      sendJson(response, 502, {
        code: 'INVALID_RESPONSE',
        message: '카카오 도보 경로 응답 형식이 올바르지 않습니다.',
      })
      return
    }
    const route = parseKakaoWalkingRouteResponse(body)
    sendJson(response, 200, route)
  } catch (error) {
    if (error instanceof WalkingRouteError) {
      sendJson(response, mapWalkingRouteError(error), {
        code: error.code,
        message: error.message,
      })
      return
    }
    if (error instanceof Error && error.name === 'AbortError') {
      sendJson(response, 504, {
        code: 'REQUEST_TIMEOUT',
        message: '카카오 도보 경로 요청 시간이 초과되었습니다.',
      })
      return
    }
    sendJson(response, 502, {
      code: 'NETWORK_ERROR',
      message: '카카오 도보 경로 API에 연결하지 못했습니다.',
    })
  } finally {
    clearTimeout(timeoutId)
  }
}
