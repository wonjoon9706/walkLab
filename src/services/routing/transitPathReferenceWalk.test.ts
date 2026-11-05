import { describe, expect, it, vi } from 'vitest'
import type { KakaoTransitRoute } from '../../domain/kakaoTransitRoute'
import type { WalkingRoute } from '../../domain/walkingRoute'
import { resolveTransitPathReferenceWalk } from './transitPathReferenceWalk'

const start = { latitude: 37, longitude: 127 }
const end = { latitude: 37.01, longitude: 127.01 }
const route: KakaoTransitRoute = {
  id: 'synthetic', type: 'BUS', totalDistanceM: 1_000, totalDurationSeconds: 1_000,
  transferCount: 0, fare: null, steps: [{ index: 3, mode: 'BUS', guidance: 'test',
    distanceM: 1_000, durationSeconds: 800, coordinates: [start, end],
    stops: [{ index: 0, name: '승차' }, { index: 1, name: '하차' }],
    vehicles: [{ index: 0, name: '17', type: null }],
  }],
}
const walking: WalkingRoute = { distanceM: 200, providerDurationSeconds: 180,
  coordinates: [start, end], provider: 'kakao-walking-route', requestedAt: '2026-01-01T00:00:00Z' }

describe('카카오 원본 구간 끝점 참고 도보', () => {
  it.each(['access', 'egress'] as const)('%s 구간 대응·출처를 보존하고 정류장 ID를 생성하지 않는다', async (scope) => {
    const getWalking = vi.fn().mockImplementation(async (request) => ({ ...walking,
      coordinates: [request.start, request.destination] }))
    const result = await resolveTransitPathReferenceWalk(route, scope, { latitude: 37.02, longitude: 127.02 },
      getWalking, new AbortController().signal)
    expect(result.referenceWalk).toMatchObject({ scope, stepIndex: 3,
      source: 'kakao_bus_path_endpoint', verification: 'unverified_boarding_point' })
    expect(result.referenceWalk).not.toHaveProperty('stopId')
    expect(scope === 'access' ? result.referenceWalk?.requestedDestination : result.referenceWalk?.requestedStart)
      .toEqual(scope === 'access' ? start : end)
  })

  it('원본 좌표가 없거나 비정상·복수 차량이면 G8을 요청하지 않는다', async () => {
    const getWalking = vi.fn()
    for (const step of [
      { ...route.steps[0], coordinates: [] },
      { ...route.steps[0], coordinates: [start, { latitude: NaN, longitude: 127 }] },
      { ...route.steps[0], vehicles: [...route.steps[0].vehicles, { index: 1, name: '18', type: null }] },
    ]) {
      expect(await resolveTransitPathReferenceWalk({ ...route, steps: [step] }, 'access', start,
        getWalking, new AbortController().signal)).toEqual({})
    }
    expect(getWalking).not.toHaveBeenCalled()
  })

  it('G8 오류와 유효 polyline 없는 성공 응답을 구분한다', async () => {
    const signal = new AbortController().signal
    expect(await resolveTransitPathReferenceWalk(route, 'access', start,
      async () => { throw new Error('failed') }, signal)).toEqual({ referenceWalkIssue: 'G8_REQUEST_FAILED' })
    expect(await resolveTransitPathReferenceWalk(route, 'access', start,
      async () => ({ ...walking, coordinates: [] }), signal)).toEqual({ referenceWalkIssue: 'G8_EVIDENCE_EXCLUDED' })
  })

  it('취소된 요청으로 추가 G8을 실행하지 않는다', async () => {
    const controller = new AbortController()
    controller.abort()
    const getWalking = vi.fn()
    await resolveTransitPathReferenceWalk(route, 'egress', end, getWalking, controller.signal)
    expect(getWalking).not.toHaveBeenCalled()
  })
})
