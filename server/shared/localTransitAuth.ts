import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadEnvFile } from 'node:process'
import { createClient } from '@supabase/supabase-js'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface RequestWithBody extends IncomingMessage {
  body?: unknown
}

export function loadLocalEnvironment(): void {
  if (isRemoteDeployment()) {
    return
  }
  try {
    loadEnvFile('.env.local')
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : null
    if (code !== 'ENOENT') throw error
  }
}

export function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(body))
}

export async function readJsonBody(request: RequestWithBody): Promise<unknown> {
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

export async function authenticateAllowedTransitUser(
  request: IncomingMessage,
  signal?: AbortSignal,
): Promise<
  | { ok: true; userId: string }
  | { ok: false; statusCode: 401 | 403 | 503; code: string; message: string }
> {
  const authorization = request.headers.authorization
  const token = typeof authorization === 'string' && authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''
  if (token.length === 0) {
    return { ok: false, statusCode: 401, code: 'AUTH_HEADER_MISSING', message: '로그인 인증정보가 없습니다.' }
  }
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!supabaseUrl || !publishableKey) {
    return { ok: false, statusCode: 503, code: 'SERVER_AUTH_NOT_CONFIGURED', message: '서버 인증 설정이 없습니다.' }
  }
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(signal === undefined ? {} : { global: {
      fetch: (input, init) => fetch(input, { ...init, signal }),
    } }),
  })
  const { data, error } = await client.auth.getUser(token)
  if (error !== null || data.user === null) {
    return { ok: false, statusCode: 401, code: 'AUTH_TOKEN_INVALID', message: '로그인 인증정보가 만료됐거나 올바르지 않습니다.' }
  }
  const allowedUserId = process.env.TRANSIT_ALLOWED_USER_ID?.trim()
  if (allowedUserId === undefined || !UUID_PATTERN.test(allowedUserId)) {
    return { ok: false, statusCode: 503, code: 'SERVER_NOT_CONFIGURED', message: '대중교통 허용 사용자 설정이 올바르지 않습니다.' }
  }
  if (data.user.id !== allowedUserId) {
    return { ok: false, statusCode: 403, code: 'USER_NOT_ALLOWED', message: '이 계정은 개발용 대중교통 API를 사용할 수 없습니다.' }
  }
  return { ok: true, userId: data.user.id }
}

export function isRemoteDeployment(): boolean {
  return process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview' ||
    process.env.NODE_ENV === 'production'
}

export function isKakaoTransitEnabled(): boolean {
  // 공개 VITE 설정은 UI 선택에만 사용하며 서버 허용 여부에는 사용하지 않는다.
  return !isRemoteDeployment() || process.env.KAKAO_TRANSIT_PRODUCTION_ENABLED === 'true'
}

export function parseCoordinate(value: unknown): {
  latitude: number
  longitude: number
} | null {
  if (typeof value !== 'object' || value === null) return null
  const latitude = (value as { latitude?: unknown }).latitude
  const longitude = (value as { longitude?: unknown }).longitude
  return typeof latitude === 'number' && Number.isFinite(latitude) &&
    latitude >= -90 && latitude <= 90 &&
    typeof longitude === 'number' && Number.isFinite(longitude) &&
    longitude >= -180 && longitude <= 180
    ? { latitude, longitude }
    : null
}
