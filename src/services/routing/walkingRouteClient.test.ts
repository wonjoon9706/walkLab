import { describe, expect, it, vi } from 'vitest'
import { WalkingRouteError } from '../../domain/walkingRoute'
import {
  createWalkingRouteClient,
  getSupabaseAccessToken,
} from './walkingRouteClient'

const routeResponse = {
  distanceM: 1000,
  providerDurationSeconds: 720,
  coordinates: [
    { longitude: 127.1, latitude: 37.5 },
    { longitude: 127.2, latitude: 37.6 },
  ],
  provider: 'kakao-walking-route' as const,
  requestedAt: '2026-10-30T00:00:00.000Z',
}

describe('도보 경로 API 클라이언트', () => {
  it('경도 x, 위도 y 순서와 로그인 토큰으로 서버 함수를 호출한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(routeResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const client = createWalkingRouteClient({
      fetch: fetchMock,
      getAccessToken: vi.fn().mockResolvedValue('temporary-access-token'),
    })

    await expect(
      client.getWalkingRoute({
        start: { longitude: 127.11, latitude: 37.51 },
        destination: { longitude: 127.22, latitude: 37.62 },
      }),
    ).resolves.toEqual(routeResponse)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('start_x=127.11')
    expect(url).toContain('start_y=37.51')
    expect(url).toContain('end_x=127.22')
    expect(url).toContain('end_y=37.62')
    expect(init.headers).toEqual({
      Authorization: 'Bearer temporary-access-token',
    })
  })

  it('로그인 세션이 없으면 외부 요청을 하지 않는다', async () => {
    const fetchMock = vi.fn()
    const client = createWalkingRouteClient({
      fetch: fetchMock,
      getAccessToken: vi.fn().mockResolvedValue(null),
    })

    await expect(
      client.getWalkingRoute({
        start: { longitude: 127, latitude: 37 },
        destination: { longitude: 128, latitude: 38 },
      }),
    ).rejects.toMatchObject({ code: 'AUTH_SESSION_MISSING' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('유효기간이 임박한 세션을 갱신한 뒤 새 토큰을 사용한다', async () => {
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: 'old-token',
              expires_at: 100,
            },
          },
          error: null,
        }),
        refreshSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'new-token' } },
          error: null,
        }),
      },
    }

    await expect(
      getSupabaseAccessToken(
        client as never,
        new Date(100_000),
      ),
    ).resolves.toBe('new-token')
    expect(client.auth.refreshSession).toHaveBeenCalledOnce()
  })

  it('유효한 세션은 불필요하게 갱신하지 않는다', async () => {
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: 'valid-token',
              expires_at: 10_000,
            },
          },
          error: null,
        }),
        refreshSession: vi.fn(),
      },
    }

    await expect(
      getSupabaseAccessToken(client as never, new Date(100_000)),
    ).resolves.toBe('valid-token')
    expect(client.auth.refreshSession).not.toHaveBeenCalled()
  })

  it('서버 오류 코드를 성공 결과로 처리하지 않는다', async () => {
    const client = createWalkingRouteClient({
      fetch: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 'QUOTA_EXCEEDED',
            message: '호출 한도를 초과했습니다.',
          }),
          { status: 429 },
        ),
      ),
      getAccessToken: vi.fn().mockResolvedValue('token'),
    })

    await expect(
      client.getWalkingRoute({
        start: { longitude: 127, latitude: 37 },
        destination: { longitude: 128, latitude: 38 },
      }),
    ).rejects.toBeInstanceOf(WalkingRouteError)
  })

  it('네트워크 실패를 구분한다', async () => {
    const client = createWalkingRouteClient({
      fetch: vi.fn().mockRejectedValue(new TypeError('network failed')),
      getAccessToken: vi.fn().mockResolvedValue('token'),
    })

    await expect(
      client.getWalkingRoute({
        start: { longitude: 127, latitude: 37 },
        destination: { longitude: 128, latitude: 38 },
      }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })
})
