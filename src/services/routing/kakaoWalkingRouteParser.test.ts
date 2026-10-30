import { describe, expect, it } from 'vitest'
import { WalkingRouteError } from '../../domain/walkingRoute'
import { parseKakaoWalkingRouteResponse } from './kakaoWalkingRouteParser'

const requestedAt = new Date('2026-10-30T01:00:00.000Z')

describe('카카오 도보 경로 응답 파서', () => {
  it('공식 [x, y] 좌표를 경도와 위도로 변환하고 중복 경계점을 제거한다', () => {
    const route = parseKakaoWalkingRouteResponse(
      {
        status: 'OK',
        route: {
          properties: { totalDistance: 1250, totalTime: 900 },
          legs: [
            {
              steps: [
                { path: { points: [[127.1, 37.5], [127.2, 37.6]] } },
                { path: { points: [[127.2, 37.6], [127.3, 37.7]] } },
              ],
            },
          ],
        },
      },
      requestedAt,
    )

    expect(route.distanceM).toBe(1250)
    expect(route.providerDurationSeconds).toBe(900)
    expect(route.coordinates).toEqual([
      { longitude: 127.1, latitude: 37.5 },
      { longitude: 127.2, latitude: 37.6 },
      { longitude: 127.3, latitude: 37.7 },
    ])
    expect(route.requestedAt).toBe(requestedAt.toISOString())
  })

  it('경로 없음 상태를 성공 경로로 만들지 않는다', () => {
    expect(() =>
      parseKakaoWalkingRouteResponse({ status: 'ROUTE_RESULT_NOT_FOUND' }),
    ).toThrowError(WalkingRouteError)

    try {
      parseKakaoWalkingRouteResponse({ status: 'ROUTE_RESULT_NOT_FOUND' })
    } catch (error) {
      expect(error).toMatchObject({ code: 'ROUTE_NOT_FOUND' })
    }
  })

  it.each([
    { status: 'OK' },
    {
      status: 'OK',
      route: {
        properties: { totalDistance: 0, totalTime: 0 },
        legs: [],
      },
    },
    {
      status: 'OK',
      route: {
        properties: { totalDistance: 100, totalTime: 60 },
        legs: [{ steps: [{ path: { points: [['127', '37']] } }] }],
      },
    },
  ])('잘못된 응답을 거부한다', (response) => {
    expect(() => parseKakaoWalkingRouteResponse(response)).toThrowError(
      WalkingRouteError,
    )
  })
})
