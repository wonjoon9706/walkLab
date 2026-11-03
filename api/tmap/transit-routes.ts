import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import {
  TransitRouteError,
  type TransitRouteErrorCode,
} from '../../src/domain/transitRoute.js'
import { parseTmapTransitRouteResponse } from '../../src/services/routing/tmapTransitRouteParser.js'

const TMAP_TRANSIT_URL = 'https://apis.openapi.sk.com/transit/routes'
const REQUEST_TIMEOUT_MS = 10_000
const MEMORY_REQUESTS_PER_MINUTE = 3
const MEMORY_DAILY_REQUEST_LIMIT = 20
const MEMORY_GLOBAL_DAILY_REQUEST_LIMIT = 50
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface TransitRequestBody {
  start?: { latitude?: unknown; longitude?: unknown }
  destination?: { latitude?: unknown; longitude?: unknown }
}

interface RequestWithBody extends IncomingMessage {
  body?: unknown
}

interface AuthenticationResult {
  ok: boolean
  userId?: string
  statusCode?: 401 | 403 | 503
  code?: TransitRouteErrorCode
  message?: string
}

interface RateLimitState {
  minuteStartedAt: number
  minuteCount: number
  dayKey: string
  dayCount: number
}

const memoryRateLimits = new Map<string, RateLimitState>()
const activeUsers = new Set<string>()
let memoryGlobalDayKey = ''
let memoryGlobalDayCount = 0

function loadLocalDevelopmentEnvironment(): void {
  if (process.env.VERCEL === '1' || process.env.NODE_ENV === 'production') {
    return
  }
  try {
    const content = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed.length === 0 || trimmed.startsWith('#')) continue
      const separatorIndex = trimmed.indexOf('=')
      if (separatorIndex <= 0) continue
      const name = trimmed.slice(0, separatorIndex).trim()
      const value = trimmed.slice(separatorIndex + 1).trim()
      if (process.env[name] === undefined) process.env[name] = value
    }
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : null
    if (code !== 'ENOENT') throw error
  }
}

loadLocalDevelopmentEnvironment()

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
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null
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
      message: '대중교통 경로 요청에 로그인 인증 정보가 없습니다.',
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
      message: '대중교통 경로 서버의 인증 설정이 없습니다.',
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

async function readRequestBody(request: RequestWithBody): Promise<unknown> {
  if (request.body !== undefined) {
    if (typeof request.body !== 'string') return request.body
    return JSON.parse(request.body)
  }
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text.length === 0 ? null : JSON.parse(text)
}

function parseCoordinate(
  coordinate: TransitRequestBody['start'],
): { latitude: number; longitude: number } | null {
  const latitude = coordinate?.latitude
  const longitude = coordinate?.longitude
  if (
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null
  }
  return { latitude, longitude }
}

function consumeMemoryRateLimit(userId: string, now: number): boolean {
  const dayKey = new Date(now).toISOString().slice(0, 10)
  if (memoryGlobalDayKey !== dayKey) {
    memoryGlobalDayKey = dayKey
    memoryGlobalDayCount = 0
  }
  if (memoryGlobalDayCount >= MEMORY_GLOBAL_DAILY_REQUEST_LIMIT) return false
  const current = memoryRateLimits.get(userId)
  if (current === undefined || current.dayKey !== dayKey) {
    memoryRateLimits.set(userId, {
      minuteStartedAt: now,
      minuteCount: 1,
      dayKey,
      dayCount: 1,
    })
    memoryGlobalDayCount += 1
    return true
  }
  if (current.dayCount >= MEMORY_DAILY_REQUEST_LIMIT) return false
  if (now - current.minuteStartedAt >= 60_000) {
    current.minuteStartedAt = now
    current.minuteCount = 1
  } else {
    if (current.minuteCount >= MEMORY_REQUESTS_PER_MINUTE) return false
    current.minuteCount += 1
  }
  current.dayCount += 1
  memoryGlobalDayCount += 1
  return true
}

function getProviderErrorCode(status: number): TransitRouteErrorCode {
  if (status === 401 || status === 403) return 'TMAP_AUTH_ERROR'
  if (status === 429) return 'QUOTA_EXCEEDED'
  if (status === 400) return 'ROUTE_NOT_FOUND'
  return 'NETWORK_ERROR'
}

export default async function handler(
  request: RequestWithBody,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    sendJson(response, 405, {
      code: 'INVALID_REQUEST',
      message: 'POST 요청만 사용할 수 있습니다.',
    })
    return
  }

  const authenticated = await authenticateRequest(request)
  if (!authenticated.ok || authenticated.userId === undefined) {
    sendJson(response, authenticated.statusCode ?? 401, {
      code: authenticated.code,
      message: authenticated.message,
    })
    return
  }

  const allowedUserId = process.env.TMAP_TRANSIT_ALLOWED_USER_ID?.trim()
  if (allowedUserId === undefined || !UUID_PATTERN.test(allowedUserId)) {
    sendJson(response, 503, {
      code: 'SERVER_NOT_CONFIGURED',
      message: 'TMAP 허용 사용자 설정이 올바르지 않습니다.',
    })
    return
  }
  if (authenticated.userId !== allowedUserId) {
    sendJson(response, 403, {
      code: 'USER_NOT_ALLOWED',
      message: '이 계정은 TMAP 대중교통 API를 사용할 수 없습니다.',
    })
    return
  }

  // 영속 저장소 없는 메모리 제한은 Vercel 인스턴스 사이에서 공유되지 않는다.
  // 허용 사용자 확인 후 Production 사용 여부도 명시적으로 켜야 한다.
  if (
    process.env.VERCEL_ENV === 'production' &&
    process.env.TMAP_TRANSIT_PRODUCTION_ENABLED !== 'true'
  ) {
    sendJson(response, 503, {
      code: 'PRODUCTION_DISABLED',
      message: '대중교통 API의 서버 측 사용량 제한을 준비 중입니다.',
    })
    return
  }
  if (activeUsers.has(authenticated.userId)) {
    sendJson(response, 409, {
      code: 'QUOTA_EXCEEDED',
      message: '같은 대중교통 경로 요청이 이미 진행 중입니다.',
    })
    return
  }

  let body: unknown
  try {
    body = await readRequestBody(request)
  } catch {
    sendJson(response, 400, {
      code: 'INVALID_REQUEST',
      message: '대중교통 경로 요청 형식이 올바르지 않습니다.',
    })
    return
  }
  const requestBody =
    typeof body === 'object' && body !== null
      ? (body as TransitRequestBody)
      : null
  const start = parseCoordinate(requestBody?.start)
  const destination = parseCoordinate(requestBody?.destination)
  if (start === null || destination === null) {
    sendJson(response, 400, {
      code: 'INVALID_REQUEST',
      message: '출발지와 목적지 좌표를 확인해 주세요.',
    })
    return
  }

  const appKey = process.env.TMAP_TRANSIT_APP_KEY
  if (!appKey) {
    sendJson(response, 503, {
      code: 'SERVER_NOT_CONFIGURED',
      message: 'TMAP 대중교통 서버 설정이 완료되지 않았습니다.',
    })
    return
  }
  if (!consumeMemoryRateLimit(authenticated.userId, Date.now())) {
    sendJson(response, 429, {
      code: 'QUOTA_EXCEEDED',
      message: '대중교통 경로 조회 한도를 초과했습니다.',
    })
    return
  }

  activeUsers.add(authenticated.userId)
  const abortController = new AbortController()
  const timeoutId = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS)
  try {
    const providerResponse = await fetch(TMAP_TRANSIT_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        appKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        startX: start.longitude.toString(),
        startY: start.latitude.toString(),
        endX: destination.longitude.toString(),
        endY: destination.latitude.toString(),
        count: 5,
        lang: 0,
        format: 'json',
      }),
      signal: abortController.signal,
    })
    let providerBody: unknown = null
    try {
      providerBody = await providerResponse.json()
    } catch {
      // 아래 상태별 오류 또는 응답 형식 오류로 처리한다.
    }
    if (!providerResponse.ok) {
      const code = getProviderErrorCode(providerResponse.status)
      sendJson(response, code === 'QUOTA_EXCEEDED' ? 429 : 502, {
        code,
        message:
          code === 'TMAP_AUTH_ERROR'
            ? 'TMAP 앱 키와 Premium 상품 권한을 확인해 주세요.'
            : code === 'QUOTA_EXCEEDED'
              ? 'TMAP API 호출 한도를 초과했습니다.'
              : code === 'ROUTE_NOT_FOUND'
                ? '선택한 위치의 대중교통 경로를 찾지 못했습니다.'
                : 'TMAP 대중교통 API 요청에 실패했습니다.',
      })
      return
    }
    const result = parseTmapTransitRouteResponse(providerBody)
    sendJson(response, 200, result)
  } catch (error) {
    if (error instanceof TransitRouteError) {
      sendJson(response, error.code === 'ROUTE_NOT_FOUND' ? 422 : 502, {
        code: error.code,
        message: error.message,
      })
    } else if (error instanceof Error && error.name === 'AbortError') {
      sendJson(response, 504, {
        code: 'REQUEST_TIMEOUT',
        message: 'TMAP 대중교통 경로 요청 시간이 초과되었습니다.',
      })
    } else {
      sendJson(response, 502, {
        code: 'NETWORK_ERROR',
        message: 'TMAP 대중교통 API에 연결하지 못했습니다.',
      })
    }
  } finally {
    clearTimeout(timeoutId)
    activeUsers.delete(authenticated.userId)
  }
}
