import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import {
  type BusArrivalErrorCode,
  type BusArrivalInfo,
  type BusArrivalRequest,
  type TagoCityCode,
} from '../../src/domain/busArrival.js'
import { TagoResponseError } from '../../src/services/transitArrival/tagoResponseParser.js'
import { resolveTagoBusArrival } from '../../server/tago/resolveBusArrival.js'
import { resolveSeoulBusArrival } from '../../server/tago/resolveSeoulBusArrival.js'
import {
  createSeoulBusProvider,
  SeoulBusHttpError,
  SeoulBusProviderStageError,
} from '../../server/tago/seoulBusProvider.js'
import { SeoulBusResponseError } from '../../server/tago/seoulBusResponseParser.js'
import {
  createTagoProvider,
  resetTagoProviderCacheForTests,
  TagoHttpError,
  TagoProviderStageError,
} from '../../server/tago/tagoProvider.js'

const REQUEST_TIMEOUT_MS = 8_000
const RESULT_CACHE_TTL_MS = 30_000
const CITY_CACHE_TTL_MS = 24 * 60 * 60 * 1_000
const MAX_RESULT_CACHE_ENTRIES = 100
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SEOUL_LONGITUDE_MIN = 126.73
const SEOUL_LONGITUDE_MAX = 127.27
const SEOUL_LATITUDE_MIN = 37.41
const SEOUL_LATITUDE_MAX = 37.72

interface RequestWithBody extends IncomingMessage {
  body?: unknown
}

interface AuthenticationResult {
  ok: boolean
  userId?: string
  statusCode?: 401 | 403 | 503
  code?: BusArrivalErrorCode
  message?: string
}

interface CachedResult {
  expiresAt: number
  value: BusArrivalInfo
}

const resultCache = new Map<string, CachedResult>()
const activeRequests = new Set<string>()
let cityCodeCache: { expiresAt: number; values: TagoCityCode[] } | null = null

function loadLocalDevelopmentEnvironment(): void {
  if (process.env.VERCEL === '1' || process.env.NODE_ENV === 'production') return
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
      message: '버스 도착정보 요청에 로그인 인증 정보가 없습니다.',
    }
  }
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!supabaseUrl || !publishableKey) {
    return {
      ok: false,
      statusCode: 503,
      code: 'SERVER_AUTH_NOT_CONFIGURED',
      message: '버스 도착정보 서버의 인증 설정이 없습니다.',
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
    return typeof request.body === 'string'
      ? JSON.parse(request.body)
      : request.body
  }
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text.length === 0 ? null : JSON.parse(text)
}

function readText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length > 0 && text.length <= maximumLength ? text : null
}

function parseCoordinate(
  value: unknown,
): { latitude: number; longitude: number } | null {
  if (typeof value !== 'object' || value === null) return null
  const coordinate = value as { latitude?: unknown; longitude?: unknown }
  return typeof coordinate.latitude === 'number' &&
    Number.isFinite(coordinate.latitude) &&
    coordinate.latitude >= -90 &&
    coordinate.latitude <= 90 &&
    typeof coordinate.longitude === 'number' &&
    Number.isFinite(coordinate.longitude) &&
    coordinate.longitude >= -180 &&
    coordinate.longitude <= 180
    ? { latitude: coordinate.latitude, longitude: coordinate.longitude }
    : null
}

function parseStop(value: unknown): BusArrivalRequest['boardingStop'] | null {
  if (typeof value !== 'object' || value === null) return null
  const stop = value as {
    providerStopId?: unknown
    name?: unknown
    coordinate?: unknown
  }
  const providerStopId = readText(stop.providerStopId, 100)
  const name = readText(stop.name, 100)
  const coordinate = parseCoordinate(stop.coordinate)
  return providerStopId === null || name === null || coordinate === null
    ? null
    : { providerStopId, name, coordinate }
}

function parseBusArrivalRequest(value: unknown): BusArrivalRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const body = value as {
    routeName?: unknown
    routeId?: unknown
    boardingStop?: unknown
    nextStop?: unknown
    alightingStop?: unknown
  }
  const routeName = readText(body.routeName, 100)
  const routeId = body.routeId === null ? null : readText(body.routeId, 100)
  const boardingStop = parseStop(body.boardingStop)
  const nextStop = body.nextStop === null ? null : parseStop(body.nextStop)
  const alightingStop = parseStop(body.alightingStop)
  if (
    routeName === null ||
    (body.routeId !== null && routeId === null) ||
    boardingStop === null ||
    (body.nextStop !== null && nextStop === null) ||
    alightingStop === null
  ) {
    return null
  }
  return {
    routeName,
    routeId,
    boardingStop,
    nextStop,
    alightingStop,
  }
}

function getRequestKey(userId: string, request: BusArrivalRequest): string {
  const boardingCoordinate = request.boardingStop.coordinate
  const alightingCoordinate = request.alightingStop.coordinate
  return [
    userId,
    request.routeName.normalize('NFKC').toLowerCase(),
    boardingCoordinate.latitude.toFixed(6),
    boardingCoordinate.longitude.toFixed(6),
    alightingCoordinate.latitude.toFixed(6),
    alightingCoordinate.longitude.toFixed(6),
  ].join('|')
}

function pruneResultCache(now: number): void {
  for (const [key, cached] of resultCache) {
    if (cached.expiresAt <= now) resultCache.delete(key)
  }
  while (resultCache.size >= MAX_RESULT_CACHE_ENTRIES) {
    const oldestKey = resultCache.keys().next().value
    if (typeof oldestKey !== 'string') break
    resultCache.delete(oldestKey)
  }
}

function providerError(
  error: unknown,
): { status: number; code: BusArrivalErrorCode; message: string } {
  if (error instanceof SeoulBusProviderStageError) {
    return providerError(error.originalError)
  }
  if (error instanceof SeoulBusResponseError) {
    return {
      status: 502,
      code: 'SEOUL_BUS_API_ERROR',
      message: error.kind === 'invalid_response'
        ? '서울시 버스 응답 형식이 올바르지 않습니다.'
        : '서울시 버스 API 요청이 거부되었습니다.',
    }
  }
  if (error instanceof SeoulBusHttpError) {
    if (error.status === 429) {
      return {
        status: 429,
        code: 'QUOTA_EXCEEDED',
        message: '서울시 버스 API 호출 한도를 초과했습니다.',
      }
    }
    return {
      status: 502,
      code: 'SEOUL_BUS_API_ERROR',
      message: '서울시 버스 API 연결에 실패했습니다.',
    }
  }
  if (error instanceof TagoProviderStageError) {
    return providerError(error.originalError)
  }
  if (error instanceof TagoResponseError) {
    if (['20', '30', '31'].includes(error.providerCode ?? '')) {
      return {
        status: 502,
        code: 'TAGO_AUTH_ERROR',
        message: 'TAGO 인증키와 활용신청 상태를 확인해 주세요.',
      }
    }
    if (['22', '23'].includes(error.providerCode ?? '')) {
      return {
        status: 429,
        code: 'QUOTA_EXCEEDED',
        message: 'TAGO API 호출 한도를 초과했습니다.',
      }
    }
    return {
      status: 502,
      code: error.kind === 'invalid_response' ? 'INVALID_RESPONSE' : 'NETWORK_ERROR',
      message: error.kind === 'invalid_response'
        ? 'TAGO 응답 형식이 올바르지 않습니다.'
        : 'TAGO API 요청이 실패했습니다.',
    }
  }
  if (error instanceof TagoHttpError) {
    if (error.status === 401 || error.status === 403) {
      return { status: 502, code: 'TAGO_AUTH_ERROR', message: 'TAGO 인증 요청이 거부되었습니다.' }
    }
    if (error.status === 429) {
      return { status: 429, code: 'QUOTA_EXCEEDED', message: 'TAGO API 호출 한도를 초과했습니다.' }
    }
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  ) {
    return { status: 504, code: 'REQUEST_TIMEOUT', message: 'TAGO 응답 대기시간이 초과되었습니다.' }
  }
  return { status: 502, code: 'NETWORK_ERROR', message: 'TAGO API에 연결하지 못했습니다.' }
}

function localDiagnosticsEnabled(): boolean {
  return process.env.VERCEL_ENV !== 'production' &&
    process.env.NODE_ENV !== 'production' &&
    process.env.TAGO_BUS_ARRIVAL_DIAGNOSTICS_ENABLED === 'true'
}

function localSeoulBusEnabled(): boolean {
  return process.env.VERCEL_ENV !== 'production' &&
    process.env.VERCEL_ENV !== 'preview' &&
    process.env.NODE_ENV !== 'production' &&
    process.env.SEOUL_BUS_API_LOCAL_ENABLED === 'true'
}

function isInSeoulServiceArea(request: BusArrivalRequest): boolean {
  const { latitude, longitude } = request.boardingStop.coordinate
  return longitude >= SEOUL_LONGITUDE_MIN &&
    longitude <= SEOUL_LONGITUDE_MAX &&
    latitude >= SEOUL_LATITUDE_MIN &&
    latitude <= SEOUL_LATITUDE_MAX
}

export function resetTagoBusArrivalStateForTests(): void {
  resultCache.clear()
  activeRequests.clear()
  cityCodeCache = null
  resetTagoProviderCacheForTests()
}

export default async function handler(
  request: RequestWithBody,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    sendJson(response, 405, { code: 'INVALID_REQUEST', message: 'POST 요청만 사용할 수 있습니다.' })
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

  const allowedUserId = process.env.TRANSIT_ALLOWED_USER_ID?.trim()
  if (allowedUserId === undefined || !UUID_PATTERN.test(allowedUserId)) {
    sendJson(response, 503, { code: 'SERVER_NOT_CONFIGURED', message: 'TAGO 허용 사용자 설정이 올바르지 않습니다.' })
    return
  }
  if (authenticated.userId !== allowedUserId) {
    sendJson(response, 403, { code: 'USER_NOT_ALLOWED', message: '이 계정은 TAGO API를 사용할 수 없습니다.' })
    return
  }
  if (
    process.env.VERCEL_ENV === 'production' &&
    process.env.TAGO_BUS_ARRIVAL_PRODUCTION_ENABLED !== 'true'
  ) {
    sendJson(response, 503, { code: 'PRODUCTION_DISABLED', message: 'Production TAGO 조회가 비활성화되어 있습니다.' })
    return
  }

  let body: unknown
  try {
    body = await readRequestBody(request)
  } catch {
    sendJson(response, 400, { code: 'INVALID_REQUEST', message: '버스 도착정보 요청 형식이 올바르지 않습니다.' })
    return
  }
  const parsedRequest = parseBusArrivalRequest(body)
  if (parsedRequest === null) {
    sendJson(response, 400, { code: 'INVALID_REQUEST', message: '버스 노선과 승차 정류장 정보를 확인해 주세요.' })
    return
  }

  const serviceKey = process.env.TAGO_SERVICE_KEY?.trim()
  if (!serviceKey) {
    sendJson(response, 503, { code: 'SERVER_NOT_CONFIGURED', message: 'TAGO 서버 인증키가 설정되지 않았습니다.' })
    return
  }

  const now = Date.now()
  const requestKey = getRequestKey(authenticated.userId, parsedRequest)
  pruneResultCache(now)
  const cached = resultCache.get(requestKey)
  if (cached !== undefined && cached.expiresAt > now) {
    sendJson(response, 200, cached.value)
    return
  }
  if (activeRequests.has(requestKey)) {
    sendJson(response, 409, { code: 'REQUEST_IN_PROGRESS', message: '같은 버스 도착정보를 이미 조회하고 있습니다.' })
    return
  }

  activeRequests.add(requestKey)
  const abortController = new AbortController()
  const timeoutId = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS)
  try {
    let result: BusArrivalInfo | null = null
    if (localSeoulBusEnabled() && isInSeoulServiceArea(parsedRequest)) {
      const seoulServiceKey =
        process.env.SEOUL_BUS_SERVICE_KEY?.trim() || serviceKey
      const seoulProvider = createSeoulBusProvider({
        fetch,
        serviceKey: seoulServiceKey,
        allowInsecureHttp: true,
      })
      const seoulResolution = await resolveSeoulBusArrival(
        parsedRequest,
        seoulProvider,
        abortController.signal,
        new Date(),
      )
      result = seoulResolution.result
    }

    if (result === null) {
      const provider = createTagoProvider({ fetch, serviceKey })
      let cityCodes: TagoCityCode[]
      if (cityCodeCache !== null && cityCodeCache.expiresAt > now) {
        cityCodes = cityCodeCache.values
      } else {
        cityCodes = await provider.getCityCodes(abortController.signal)
        cityCodeCache = { values: cityCodes, expiresAt: now + CITY_CACHE_TTL_MS }
      }
      result = await resolveTagoBusArrival(
        parsedRequest,
        provider,
        abortController.signal,
        new Date(),
        cityCodes,
        { diagnosticsEnabled: localDiagnosticsEnabled() },
      )
    }
    resultCache.set(requestKey, {
      value: result,
      expiresAt: now + RESULT_CACHE_TTL_MS,
    })
    sendJson(response, 200, result)
  } catch (error) {
    const mapped = providerError(error)
    const failedStage = error instanceof TagoProviderStageError ||
      error instanceof SeoulBusProviderStageError
      ? error.stage
      : null
    sendJson(response, mapped.status, {
      code: mapped.code,
      message: mapped.message,
      ...(localDiagnosticsEnabled() && failedStage !== null
        ? {
            diagnostics: {
              source: 'live',
              failedStage,
              outcomeReason: 'TAGO_REQUEST_OR_RESPONSE_ERROR',
            },
          }
        : {}),
    })
  } finally {
    clearTimeout(timeoutId)
    activeRequests.delete(requestKey)
  }
}
