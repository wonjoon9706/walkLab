import { describe, expect, it } from 'vitest'
import type { SubwayEntranceCandidateEvidence } from '../../domain/transitBoardingPoint'
import type { WalkingSpeedModel } from '../../domain/walkingSpeedModel'
import type { WalkingRoute } from '../../domain/walkingRoute'
import { recommendSubwayEntrance } from './subwayEntranceSelection'

function candidate(
  id: string,
  options: Partial<SubwayEntranceCandidateEvidence> = {},
): SubwayEntranceCandidateEvidence {
  return {
    place: {
      id,
      name: `테스트역 7호선 ${id}번출구`,
      address: '비식별 주소',
      roadAddress: null,
      categoryName: '교통,수송 > 지하철,전철 > 7호선 > 지하철출구',
      categoryGroupCode: 'SW8',
      coordinate: { latitude: 37, longitude: 127 },
    },
    closureStatus: 'unknown',
    stationNameMatches: true,
    lineMatches: true,
    entranceCategoryMatches: true,
    walkingRouteStatus: 'available',
    walkingRoute: null,
    prefilterStatus: 'selected_for_g8',
    straightDistanceM: 100,
    walkingDistanceM: 200,
    walkingProviderDurationSeconds: 180,
    startGapM: 0,
    destinationGapM: 0,
    walkingErrorCode: null,
    selectionDurationSeconds: null,
    selectionTimeBasis: null,
    selectionRank: null,
    ...options,
  }
}

function route(): WalkingRoute {
  return {
    distanceM: 200,
    providerDurationSeconds: 180,
    coordinates: [
      { latitude: 37, longitude: 127 },
      { latitude: 37.001, longitude: 127.001 },
    ],
    provider: 'kakao-walking-route',
    requestedAt: '2026-01-01T00:00:00.000Z',
  }
}

function routes(...ids: string[]): Map<string, WalkingRoute> {
  return new Map(ids.map((id) => [id, route()]))
}

function readyModel(): WalkingSpeedModel {
  return {
    algorithmVersion: 'recency-weighted-v1',
    status: 'ready',
    estimatedSpeedMps: 1.5,
    simpleAverageSpeedMps: 1.4,
    validSessionCount: 8,
    windowDays: 30,
    trainingPeriodStart: null,
    trainingPeriodEnd: null,
    lastUpdatedAt: null,
    calculatedAt: '2026-01-01T00:00:00.000Z',
    estimatedOneKilometerSeconds: 667,
    decisions: [],
  }
}

const providerSpeed = {
  kind: 'reference_only' as const,
  speedMps: 5.7 / 3.6,
  label: '참고값은 순위에 사용하지 않음',
}

describe('recommendSubwayEntrance', () => {
  it('유효 후보 중 G8 공급자 보행시간이 가장 짧은 출입구를 추천한다', () => {
    const slower = candidate('2', { walkingProviderDurationSeconds: 240 })
    const faster = candidate('1', { walkingProviderDurationSeconds: 160 })
    const result = recommendSubwayEntrance(
      [slower, faster],
      routes('1', '2'),
      providerSpeed,
    )

    expect(result?.selected.place.id).toBe('1')
    expect(result?.selected.selectionTimeBasis).toBe('g8_provider')
    expect(result?.selectionConfidence).toBe('provisional')
    expect(result?.internalStationTimeIncluded).toBe(false)
  })

  it('직선거리가 가까워도 실제 G8 경로가 느린 후보를 선택하지 않는다', () => {
    const straightNear = candidate('near', {
      straightDistanceM: 50,
      walkingProviderDurationSeconds: 300,
    })
    const straightFar = candidate('far', {
      straightDistanceM: 120,
      walkingProviderDurationSeconds: 180,
    })
    const result = recommendSubwayEntrance(
      [straightNear, straightFar],
      routes('near', 'far'),
      providerSpeed,
    )

    expect(result?.selected.place.id).toBe('far')
  })

  it('폐쇄·G8 실패·30m 초과 스냅 후보를 순위에서 제외한다', () => {
    const closed = candidate('closed', { closureStatus: 'confirmed_closed' })
    const failed = candidate('failed', { walkingRouteStatus: 'failed' })
    const badSnap = candidate('bad-snap', { destinationGapM: 31 })
    const valid = candidate('valid')
    const result = recommendSubwayEntrance(
      [closed, failed, badSnap, valid],
      routes('closed', 'failed', 'bad-snap', 'valid'),
      providerSpeed,
    )

    expect(result?.selected.place.id).toBe('valid')
    expect(closed.selectionRank).toBeNull()
    expect(failed.selectionRank).toBeNull()
    expect(badSnap.selectionRank).toBeNull()
  })

  it('시간·오차·거리가 같으면 장소 ID로 결정적인 동률 처리를 한다', () => {
    const second = candidate('b')
    const first = candidate('a')
    const result = recommendSubwayEntrance(
      [second, first],
      routes('a', 'b'),
      providerSpeed,
    )

    expect(result?.selected.place.id).toBe('a')
    expect(first.selectionRank).toBe(1)
    expect(second.selectionRank).toBe(2)
  })

  it('유효 후보가 없으면 임의 선택하지 않는다', () => {
    const result = recommendSubwayEntrance(
      [candidate('failed', { walkingRouteStatus: 'failed' })],
      routes('failed'),
      providerSpeed,
    )
    expect(result).toBeNull()
  })

  it('유효 G7 모델이 있으면 개인 보행시간으로 순위를 정한다', () => {
    const providerFast = candidate('provider-fast', {
      walkingDistanceM: 300,
      walkingProviderDurationSeconds: 150,
    })
    const personalFast = candidate('personal-fast', {
      walkingDistanceM: 180,
      walkingProviderDurationSeconds: 200,
    })
    const result = recommendSubwayEntrance(
      [providerFast, personalFast],
      routes('provider-fast', 'personal-fast'),
      { kind: 'g7_model', model: readyModel() },
    )

    expect(result?.selected.place.id).toBe('personal-fast')
    expect(result?.selected.selectionTimeBasis).toBe('g7_personalized')
  })

  it('접근과 하차는 서로 다른 외부 보행조건으로 독립 추천된다', () => {
    const entranceA = candidate('a', { walkingProviderDurationSeconds: 100 })
    const entranceB = candidate('b', { walkingProviderDurationSeconds: 200 })
    const exitA = candidate('a', { walkingProviderDurationSeconds: 220 })
    const exitB = candidate('b', { walkingProviderDurationSeconds: 90 })

    const access = recommendSubwayEntrance(
      [entranceA, entranceB],
      routes('a', 'b'),
      providerSpeed,
    )
    const egress = recommendSubwayEntrance(
      [exitA, exitB],
      routes('a', 'b'),
      providerSpeed,
    )

    expect(access?.selected.place.id).toBe('a')
    expect(egress?.selected.place.id).toBe('b')
  })
})
