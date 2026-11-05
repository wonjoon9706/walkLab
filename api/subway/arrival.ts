import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import type {
  SubwayArrivalErrorCode,
  SubwayArrivalInfo,
  SubwayArrivalRequest,
  SubwayTrainType,
} from '../../src/domain/subwayArrival.js'
import { resolveSeoulSubwayArrival } from '../../server/subway/resolveSeoulSubwayArrival.js'
import {
  createSeoulSubwayProvider,
  SeoulSubwayHttpError,
} from '../../server/subway/seoulSubwayProvider.js'
import { SeoulSubwayResponseError } from '../../server/subway/seoulSubwayResponseParser.js'

const REQUEST_TIMEOUT_MS = 8_000
const RESULT_CACHE_TTL_MS = 30_000
const MAX_RESULT_CACHE_ENTRIES = 100
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface RequestWithBody extends IncomingMessage {
  body?: unknown
}

interface CachedResult {
  expiresAt: number
  value: SubwayArrivalInfo
}

const resultCache = new Map<string, CachedResult>()
const activeRequests = new Set<string>()

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
    const code = typeof error === 'object' && error !== null && 'code' in error
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

async function authenticateRequest(request: IncomingMessage): Promise<{
  ok: boolean
  userId?: string
  status: number
  code?: SubwayArrivalErrorCode
  message?: string
}> {
  const token = getBearerToken(request)
  if (token === null) {
    return {
      ok: false,
      status: 401,
      code: 'AUTH_HEADER_MISSING',
      message: '지하철 도착정보 요청에 로그인 인증정보가 없습니다.',
    }
  }
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!supabaseUrl || !publishableKey) {
    return {
      ok: false,
      status: 503,
      code: 'SERVER_AUTH_NOT_CONFIGURED',
      message: '지하철 도착정보 서버 인증 설정이 없습니다.',
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
      status: 401,
      code: 'AUTH_TOKEN_INVALID',
      message: '로그인 인증정보가 만료됐거나 올바르지 않습니다.',
    }
  }
  return { ok: true, userId: data.user.id, status: 200 }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readText(value: unknown, maximumLength = 100): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length > 0 && text.length <= maximumLength ? text : null
}

function parseStation(value: unknown) {
  if (!isRecord(value)) return null
  const providerStationId = value.providerStationId === null
    ? null
    : readText(value.providerStationId)
  const name = readText(value.name)
  return (value.providerStationId !== null && providerStationId === null) || name === null
    ? null
    : { providerStationId, name }
}

function parseRequest(value: unknown): SubwayArrivalRequest | null {
  if (!isRecord(value)) return null
  const routeName = value.routeName === null ? null : readText(value.routeName)
  const trainType: SubwayTrainType | null =
    value.trainType === 'normal' || value.trainType === 'express'
      ? value.trainType
      : null
  const boardingStation = parseStation(value.boardingStation)
  const nextStation = parseStation(value.nextStation)
  const alightingStation = parseStation(value.alightingStation)
  if (
    (value.routeName !== null && routeName === null) ||
    trainType === null ||
    boardingStation === null ||
    nextStation === null ||
    alightingStation === null
  ) {
    return null
  }
  return {
    routeName,
    trainType,
    boardingStation,
    nextStation,
    alightingStation,
  }
}

function getRequestKey(userId: string, request: SubwayArrivalRequest): string {
  return [
    userId,
    request.routeName,
    request.trainType,
    request.boardingStation.name.normalize('NFKC').toLowerCase(),
    request.nextStation.name.normalize('NFKC').toLowerCase(),
    request.alightingStation.name.normalize('NFKC').toLowerCase(),
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

function mapProviderError(error: unknown): {
  status: number
  code: SubwayArrivalErrorCode
  message: string
} {
  if (error instanceof SeoulSubwayResponseError) {
    if (error.providerCode?.startsWith('ERROR-') === true) {
      return {
        status: 502,
        code: 'SEOUL_SUBWAY_API_ERROR',
        message: '서울시 지하철 API 인증 또는 요청 설정을 확인해 주세요.',
      }
    }
    return {
      status: 502,
      code: error.kind === 'invalid_response'
        ? 'INVALID_RESPONSE'
        : 'SEOUL_SUBWAY_API_ERROR',
      message: error.kind === 'invalid_response'
        ? '서울시 지하철 응답 형식이 올바르지 않습니다.'
        : '서울시 지하철 API 요청이 실패했습니다.',
    }
  }
  if (error instanceof SeoulSubwayHttpError) {
    if (error.status === 429) {
      return {
        status: 429,
        code: 'QUOTA_EXCEEDED',
        message: '서울시 지하철 API 호출 한도를 초과했습니다.',
      }
    }
    return {
      status: 502,
      code: 'SEOUL_SUBWAY_API_ERROR',
      message: '서울시 지하철 API 연결에 실패했습니다.',
    }
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  ) {
    return {
      status: 504,
      code: 'REQUEST_TIMEOUT',
      message: '서울시 지하철 응답 대기시간이 초과됐습니다.',
    }
  }
  return {
    status: 502,
    code: 'NETWORK_ERROR',
    message: '서울시 지하철 API에 연결하지 못했습니다.',
  }
}

export function resetSubwayArrivalStateForTests(): void {
  resultCache.clear()
  activeRequests.clear()
}

export default async function handler(
  request: RequestWithBody,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    sendJson(response, 405, {
      code: 'INVALID_REQUEST', message: 'POST 요청만 사용할 수 있습니다.',
    })
    return
  }

  const authenticated = await authenticateRequest(request)
  if (!authenticated.ok || authenticated.userId === undefined) {
    sendJson(response, authenticated.status, {
      code: authenticated.code, message: authenticated.message,
    })
    return
  }

  const allowedUserId = process.env.TRANSIT_ALLOWED_USER_ID?.trim()
  if (allowedUserId === undefined || !UUID_PATTERN.test(allowedUserId)) {
    sendJson(response, 503, {
      code: 'SERVER_NOT_CONFIGURED',
      message: '지하철 도착정보 허용 사용자 설정이 올바르지 않습니다.',
    })
    return
  }
  if (authenticated.userId !== allowedUserId) {
    sendJson(response, 403, {
      code: 'USER_NOT_ALLOWED',
      message: '이 계정은 지하철 도착정보 API를 사용할 수 없습니다.',
    })
    return
  }

  if (
    process.env.VERCEL_ENV === 'production' ||
    process.env.VERCEL_ENV === 'preview' ||
    process.env.NODE_ENV === 'production' ||
    process.env.SEOUL_SUBWAY_REALTIME_LOCAL_ENABLED !== 'true'
  ) {
    sendJson(response, 503, {
      code: 'PRODUCTION_DISABLED',
      message: process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview' || process.env.NODE_ENV === 'production'
        ? '서울시 지하철의 안전한 운영 통신이 확인되지 않아 실시간 정보를 제공하지 않습니다.'
        : '서울시 지하철 실시간 조회가 로컬에서 활성화되지 않았습니다.',
    })
    return
  }

  const serviceKey = process.env.SEOUL_SUBWAY_REALTIME_KEY?.trim()
  if (!serviceKey) {
    sendJson(response, 503, {
      code: 'SERVER_NOT_CONFIGURED',
      message: '서울시 지하철 서버 인증키가 설정되지 않았습니다.',
    })
    return
  }

  let body: unknown
  try {
    body = await readRequestBody(request)
  } catch {
    sendJson(response, 400, {
      code: 'INVALID_REQUEST', message: '지하철 도착정보 요청 형식이 올바르지 않습니다.',
    })
    return
  }
  const parsedRequest = parseRequest(body)
  if (parsedRequest === null) {
    sendJson(response, 400, {
      code: 'INVALID_REQUEST',
      message: '지하철 노선과 승차·다음·하차역 정보를 확인해 주세요.',
    })
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
    sendJson(response, 409, {
      code: 'REQUEST_IN_PROGRESS',
      message: '같은 지하철 도착정보를 이미 조회하고 있습니다.',
    })
    return
  }

  activeRequests.add(requestKey)
  const abortController = new AbortController()
  const timeoutId = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS)
  try {
    const provider = createSeoulSubwayProvider({
      fetch,
      serviceKey,
      allowInsecureHttp: true,
    })
    const result = await resolveSeoulSubwayArrival(
      parsedRequest,
      provider,
      abortController.signal,
      new Date(),
    )
    resultCache.set(requestKey, {
      value: result,
      expiresAt: now + RESULT_CACHE_TTL_MS,
    })
    sendJson(response, 200, result)
  } catch (error) {
    const mapped = mapProviderError(error)
    sendJson(response, mapped.status, {
      code: mapped.code,
      message: mapped.message,
    })
  } finally {
    clearTimeout(timeoutId)
    activeRequests.delete(requestKey)
  }
}
