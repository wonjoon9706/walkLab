import type { KakaoTransitRouteResult } from '../../domain/kakaoTransitRoute'
import { TransitRouteError } from '../../domain/transitRoute'
import type { GeoCoordinate } from '../../domain/walkingRoute'
import { getSupabaseAccessToken } from './walkingRouteClient'

interface Dependencies {
  fetch: typeof fetch
  getAccessToken(): Promise<string | null>
}

export type KakaoTransitRequestStage = 'auth' | 'request' | 'response'

// 인증 SDK의 대기와 응답 본문 처리도 요청 수명에 포함한다.
// 취소 뒤 늦게 도착한 토큰으로 새 외부 요청을 시작하지 않는다.
function waitForRequest<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('Request aborted', 'AbortError'))
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}

function isResult(value: unknown): value is KakaoTransitRouteResult {
  if (typeof value !== 'object' || value === null) return false
  const result = value as Partial<KakaoTransitRouteResult>
  return result.provider === 'kakao-map-publictraffic' &&
    typeof result.requestedAt === 'string' &&
    Array.isArray(result.routes) &&
    result.routes.length > 0 &&
    result.routes.every((route) =>
      typeof route?.id === 'string' &&
      typeof route.totalDurationSeconds === 'number' &&
      Array.isArray(route.steps) &&
      route.steps.every((step) => Array.isArray(step.coordinates)),
    )
}

export function createKakaoTransitRouteClient(dependencies: Dependencies) {
  return {
    async getTransitRoutes(request: {
      start: GeoCoordinate
      destination: GeoCoordinate
    }, options: {
      signal?: AbortSignal
      onStageChange?: (stage: KakaoTransitRequestStage) => void
    } = {}): Promise<KakaoTransitRouteResult> {
      const controller = new AbortController()
      const signal = controller.signal
      const abort = () => controller.abort()
      options.signal?.addEventListener('abort', abort, { once: true })
      if (options.signal?.aborted) controller.abort()
      const timer = setTimeout(abort, 25_000)
      let phase: 'auth' | 'route' = 'auth'
      try {
        signal.throwIfAborted()
        options.onStageChange?.('auth')
        const token = await waitForRequest(dependencies.getAccessToken(), signal)
        signal.throwIfAborted()
        if (token === null) throw new TransitRouteError('AUTH_SESSION_MISSING', '로그인이 필요합니다.')
        phase = 'route'
        options.onStageChange?.('request')
        const response = await waitForRequest(dependencies.fetch('/api/kakao/transit-routes', {
          signal,
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
        }), signal)
        options.onStageChange?.('response')
        const body: unknown = await waitForRequest(response.json().catch(() => null), signal)
        if (!response.ok) {
          const code = typeof body === 'object' && body !== null &&
            typeof (body as { code?: unknown }).code === 'string'
            ? (body as { code: string }).code
            : 'NETWORK_ERROR'
          const allowedCode = [
            'AUTH_HEADER_MISSING', 'AUTH_TOKEN_INVALID', 'SERVER_AUTH_NOT_CONFIGURED',
            'SERVER_NOT_CONFIGURED', 'USER_NOT_ALLOWED', 'PRODUCTION_DISABLED',
            'INVALID_REQUEST', 'KAKAO_AUTH_ERROR', 'QUOTA_EXCEEDED',
            'REQUEST_TIMEOUT', 'NETWORK_ERROR', 'INVALID_RESPONSE',
          ].includes(code)
            ? code as ConstructorParameters<typeof TransitRouteError>[0]
            : 'NETWORK_ERROR'
          const message = typeof body === 'object' && body !== null &&
            typeof (body as { message?: unknown }).message === 'string'
            ? (body as { message: string }).message
            : '카카오 대중교통 경로를 불러오지 못했습니다.'
          throw new TransitRouteError(allowedCode, message)
        }
        if (!isResult(body)) {
          throw new TransitRouteError('INVALID_RESPONSE', '카카오 경로 응답 형식이 올바르지 않습니다.')
        }
        return body
      } catch (error) {
        if (options.signal?.aborted) {
          throw new DOMException('Request canceled', 'AbortError')
        }
        if (signal.aborted) {
          throw new TransitRouteError('REQUEST_TIMEOUT', phase === 'auth'
            ? '로그인 인증 확인 시간이 초과되었습니다. 다시 검색해 주세요.'
            : '카카오 경로 조회 시간이 초과되었습니다. 다시 검색해 주세요.')
        }
        if (error instanceof TransitRouteError) throw error
        throw new TransitRouteError('NETWORK_ERROR', phase === 'auth'
          ? '로그인 인증 정보를 확인하지 못했습니다. 다시 로그인해 주세요.'
          : '카카오 경로 서버에 연결하지 못했습니다.')
      } finally {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', abort)
      }
    },
  }
}

export const kakaoTransitRouteClient = createKakaoTransitRouteClient({
  fetch: window.fetch.bind(window),
  getAccessToken: getSupabaseAccessToken,
})
