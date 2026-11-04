import { describe, expect, it, vi } from 'vitest'
import type { PlaceSearchResult } from '../../domain/walkingRoute'
import {
  createSubwayEntranceWalkingRouteCache,
  MAX_SUBWAY_ENTRANCE_G8_CANDIDATES,
  resolveSubwayEntranceCandidates,
} from './subwayEntranceResolution'

function place(index: number): PlaceSearchResult {
  return {
    id: `exit-${index}`,
    name: `테스트역 7호선 ${index}번출구`,
    address: '비식별 주소',
    roadAddress: null,
    categoryName: '교통,수송 > 지하철,전철 > 7호선 > 지하철출구',
    categoryGroupCode: 'SW8',
    coordinate: {
      latitude: 37 + index * 0.0001,
      longitude: 127,
    },
  }
}

describe('resolveSubwayEntranceCandidates request limit', () => {
  it('직선거리 사전순위 상위 5개만 G8 조회하고 최종값은 실제 경로에 맡긴다', async () => {
    const getWalkingRoute = vi.fn(async (request: {
      start: { latitude: number; longitude: number }
      destination: { latitude: number; longitude: number }
    }) => ({
      distanceM: 100,
      providerDurationSeconds: 90,
      coordinates: [request.start, request.destination],
      provider: 'kakao-walking-route' as const,
      requestedAt: '2026-01-01T00:00:00.000Z',
    }))
    const result = await resolveSubwayEntranceCandidates({
      places: Array.from({ length: 7 }, (_, index) => place(index + 1)),
      stationName: '테스트',
      lineName: '7호선',
      getWalkingRoute,
      createWalkingRequest: (candidate) => ({
        start: { latitude: 37, longitude: 127 },
        destination: candidate.coordinate,
      }),
    })

    expect(getWalkingRoute).toHaveBeenCalledTimes(
      MAX_SUBWAY_ENTRANCE_G8_CANDIDATES,
    )
    expect(result.evidence.filter(
      (candidate) => candidate.prefilterStatus === 'selected_for_g8',
    )).toHaveLength(5)
    expect(result.evidence.filter(
      (candidate) => candidate.prefilterStatus === 'skipped_by_limit',
    )).toHaveLength(2)
  })

  it('호출자가 공유 캐시를 제공하면 같은 좌표의 G8 요청을 재사용한다', async () => {
    const getWalkingRoute = vi.fn(async (request: {
      start: { latitude: number; longitude: number }
      destination: { latitude: number; longitude: number }
    }) => ({
      distanceM: 100,
      providerDurationSeconds: 90,
      coordinates: [request.start, request.destination],
      provider: 'kakao-walking-route' as const,
      requestedAt: '2026-01-01T00:00:00.000Z',
    }))
    const walkingRouteCache = createSubwayEntranceWalkingRouteCache()
    const input = {
      places: [place(1)],
      stationName: '테스트',
      lineName: '7호선',
      getWalkingRoute,
      createWalkingRequest: (candidate: PlaceSearchResult) => ({
        start: { latitude: 37, longitude: 127 },
        destination: candidate.coordinate,
      }),
      walkingRouteCache,
    }

    await resolveSubwayEntranceCandidates(input)
    await resolveSubwayEntranceCandidates(input)

    expect(getWalkingRoute).toHaveBeenCalledTimes(1)
  })
})
