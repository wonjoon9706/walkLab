import { describe, expect, it, vi } from 'vitest'
import { createKakaoTransitRouteClient } from './kakaoTransitRouteClient'

const request = {
  start: { latitude: 37, longitude: 127 },
  destination: { latitude: 37.1, longitude: 127.1 },
}

describe('카카오 경로 요청 실패 구분', () => {
  it('연결 실패 후 자동 재시도하지 않는다', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('offline'))
    const client = createKakaoTransitRouteClient({ fetch, getAccessToken: async () => 'test-token' })
    await expect(client.getTransitRoutes(request)).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('인증 SDK가 멈춰도 25초 뒤 오류를 반환하며 경로 요청을 보내지 않는다', async () => {
    vi.useFakeTimers()
    try {
      const fetch = vi.fn()
      const client = createKakaoTransitRouteClient({
        fetch, getAccessToken: () => new Promise(() => undefined),
      })
      const failure = expect(client.getTransitRoutes(request)).rejects.toMatchObject({
        code: 'REQUEST_TIMEOUT', message: expect.stringContaining('로그인 인증'),
      })
      await vi.advanceTimersByTimeAsync(25_000)
      await failure
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('인증 대기 중 취소되면 늦은 토큰으로 경로 요청을 보내지 않는다', async () => {
    let finishAuth: (token: string) => void = () => undefined
    const fetch = vi.fn()
    const client = createKakaoTransitRouteClient({
      fetch, getAccessToken: () => new Promise((resolve) => { finishAuth = resolve }),
    })
    const controller = new AbortController()
    const failure = expect(client.getTransitRoutes(request, { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await failure
    finishAuth('test-token')
    await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('카카오 응답 대기도 25초 뒤 종료한다', async () => {
    vi.useFakeTimers()
    try {
      const fetch = vi.fn(() => new Promise<Response>(() => undefined))
      const client = createKakaoTransitRouteClient({ fetch, getAccessToken: async () => 'test-token' })
      const failure = expect(client.getTransitRoutes(request)).rejects.toMatchObject({
        code: 'REQUEST_TIMEOUT', message: expect.stringContaining('카카오 경로'),
      })
      await vi.advanceTimersByTimeAsync(25_000)
      await failure
      expect(fetch).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
