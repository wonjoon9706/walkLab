import { describe, expect, it } from 'vitest'
import type { KakaoTransitRoute } from '../../domain/kakaoTransitRoute'
import type { WalkingSpeedModel } from '../../domain/walkingSpeedModel'
import type { AutomaticTransitEgressResult } from '../../domain/transitEgressPoint'
import type { KakaoEtaG8WalkEvidence } from './kakaoTransitEta'
import {
  calculateKakaoTransitEta,
  collectKakaoEtaG8WalkEvidence,
} from './kakaoTransitEta'

function route(walking: Array<{ distanceM: number; durationSeconds: number }>): KakaoTransitRoute {
  return {
    id: 'route',
    type: 'BUS_AND_SUBWAY',
    totalDistanceM: 10_000,
    totalDurationSeconds: 2_000,
    transferCount: 1,
    fare: null,
    steps: [
      {
        index: 0, mode: 'BUS', guidance: '', distanceM: 2_000,
        durationSeconds: 500, stops: [], vehicles: [], coordinates: [],
      },
      ...walking.map((step, index) => ({
        index: index + 1,
        mode: 'WALKING' as const,
        guidance: '',
        distanceM: step.distanceM,
        durationSeconds: step.durationSeconds,
        stops: [], vehicles: [], coordinates: [],
      })),
      {
        index: walking.length + 1, mode: 'SUBWAY', guidance: '', distanceM: 7_000,
        durationSeconds: 900, stops: [], vehicles: [], coordinates: [],
      },
    ],
  }
}

function model(speedMps: number | null, status: 'ready' | 'insufficient' = 'ready'): WalkingSpeedModel {
  return {
    algorithmVersion: 'recency-weighted-v1', status,
    estimatedSpeedMps: speedMps, simpleAverageSpeedMps: speedMps,
    validSessionCount: status === 'ready' ? 8 : 1, windowDays: 30,
    trainingPeriodStart: null, trainingPeriodEnd: null,
    lastUpdatedAt: null, calculatedAt: '2026-11-04T00:00:00.000Z',
    estimatedOneKilometerSeconds: speedMps === null ? null : 1_000 / speedMps,
    decisions: [],
  }
}

function g8Walk(
  scope: 'access' | 'egress',
  distanceM: number,
  providerDurationSeconds: number,
  endpointVerification: 'verified' | 'review_required' = 'verified',
): KakaoEtaG8WalkEvidence {
  return {
    scope,
    walkingRoute: {
      distanceM, providerDurationSeconds,
      coordinates: [
        { latitude: 37, longitude: 127 },
        { latitude: 37.001, longitude: 127.001 },
      ],
      provider: 'kakao-walking-route', requestedAt: '2026-11-04T00:00:00.000Z',
    },
    endpointVerification,
    startGapM: endpointVerification === 'verified' ? 0 : 57.2,
    destinationGapM: endpointVerification === 'verified' ? 0 : 37.7,
    internalTransitTime: 'not_applicable',
  }
}

describe('카카오 명시 WALKING 기반 1차 개인화 ETA', () => {
  it('원본 WALKING 시간만 G7 시간으로 치환하고 total-step 차이는 그대로 보존한다', () => {
    const result = calculateKakaoTransitEta(
      route([{ distanceM: 200, durationSeconds: 240 }, { distanceM: 100, durationSeconds: 120 }]),
      model(2),
    )

    expect(result.status).toBe('available')
    if (result.status !== 'available') return
    expect(result.estimate).toMatchObject({
      providerDurationSeconds: 2_000,
      providerWalkingDurationSeconds: 360,
      personalizedWalkingDurationSeconds: 150,
      appliedDurationSeconds: 1_790,
      stepDurationSumSeconds: 1_760,
      providerToStepDifferenceSeconds: 240,
      explicitWalkingStepCount: 2,
      explicitWalkingDistanceM: 300,
    })
    const personalizedStepSum = result.estimate.stepDurationSumSeconds -
      result.estimate.providerWalkingDurationSeconds +
      result.estimate.personalizedWalkingDurationSeconds
    expect(result.estimate.appliedDurationSeconds - personalizedStepSum).toBe(240)
  })

  it('실제 G7 속도에 따라 화면에 사용할 ETA가 달라진다', () => {
    const target = route([{ distanceM: 600, durationSeconds: 600 }])
    const fast = calculateKakaoTransitEta(target, model(2))
    const slow = calculateKakaoTransitEta(target, model(1))

    expect(fast.status).toBe('available')
    expect(slow.status).toBe('available')
    if (fast.status !== 'available' || slow.status !== 'available') return
    expect(fast.estimate.appliedDurationSeconds).toBe(1_700)
    expect(slow.estimate.appliedDurationSeconds).toBe(2_000)
  })

  it('G7 학습이 부족하면 기존 기본속도 fallback을 명시한다', () => {
    const result = calculateKakaoTransitEta(
      route([{ distanceM: 300, durationSeconds: 400 }]),
      model(null, 'insufficient'),
    )

    expect(result.status).toBe('available')
    if (result.status === 'available') {
      expect(result.estimate.speedProfile.source).toBe('default')
      expect(result.estimate.speedProfile.validSessionCount).toBe(1)
    }
  })

  it('명시 WALKING이 없거나 시간 구성요소가 모순되면 숫자를 만들지 않는다', () => {
    expect(calculateKakaoTransitEta(route([]), model(2))).toEqual({
      status: 'unavailable', reason: 'NO_EXPLICIT_WALKING_STEP',
    })
    const inconsistent = route([{ distanceM: 300, durationSeconds: 800 }])
    inconsistent.totalDurationSeconds = 1_000
    expect(calculateKakaoTransitEta(inconsistent, model(2))).toEqual({
      status: 'unavailable', reason: 'INCONSISTENT_DURATION_COMPONENTS',
    })
  })

  it('거리나 시간이 0인 WALKING은 개인화 가능한 구간으로 간주하지 않는다', () => {
    expect(calculateKakaoTransitEta(
      route([{ distanceM: 0, durationSeconds: 120 }]),
      model(2),
    )).toEqual({ status: 'unavailable', reason: 'INVALID_WALKING_STEP' })
  })

  it('30m 스냅 초과 G8도 유효한 polyline이면 추정에 사용하고 연결 상태를 보존한다', () => {
    const target = route([])
    const result = calculateKakaoTransitEta(
      target,
      model(2),
      [g8Walk('egress', 600, 500, 'review_required')],
    )

    expect(result.status).toBe('available')
    if (result.status !== 'available') return
    expect(result.estimate.appliedDurationSeconds).toBe(1_800)
    expect(result.estimate.g8Adjustments[0]).toMatchObject({
      application: 'provider_duration_assumed_in_total',
      personalizedDurationSeconds: 300,
      adjustmentSeconds: -200,
      endpointVerification: 'review_required',
      startGapM: 57.2,
      destinationGapM: 37.7,
    })
  })

  it('명시 접근 WALKING과 G8 접근이 겹치면 한 번만 치환한다', () => {
    const target = route([{ distanceM: 600, durationSeconds: 600 }])
    const walking = target.steps[1]
    target.steps = [walking, target.steps[0], target.steps[2]]
    const result = calculateKakaoTransitEta(
      target,
      model(2),
      [g8Walk('access', 400, 450)],
    )

    expect(result.status).toBe('available')
    if (result.status !== 'available') return
    expect(result.estimate.appliedDurationSeconds).toBe(1_600)
    expect(result.estimate.explicitWalkingStepCount).toBe(0)
    expect(result.estimate.g8Adjustments[0]).toMatchObject({
      application: 'replaced_overlapping_explicit_walking',
      providerDurationSeconds: 600,
      personalizedDurationSeconds: 200,
      overlappingStepIndexes: [1],
    })
  })

  it('이수역 직접 도보와 동작17 경로가 G7 속도에 따라 합리적으로 변한다', () => {
    const isuDirect = route([])
    isuDirect.totalDurationSeconds = 3_103
    const dongjak17 = route([
      { distanceM: 172, durationSeconds: 227 },
      { distanceM: 117, durationSeconds: 165 },
    ])
    dongjak17.totalDurationSeconds = 2_872
    const fastModel = model(5.7 / 3.6)
    const slowModel = model(1.25)

    const isuFast = calculateKakaoTransitEta(
      isuDirect, fastModel, [g8Walk('access', 1_159, 900)],
    )
    const isuSlow = calculateKakaoTransitEta(
      isuDirect, slowModel, [g8Walk('access', 1_159, 900)],
    )
    const dongjakFast = calculateKakaoTransitEta(dongjak17, fastModel, [
      g8Walk('access', 200, 180),
      g8Walk('egress', 245, 220, 'review_required'),
    ])
    const dongjakSlow = calculateKakaoTransitEta(dongjak17, slowModel, [
      g8Walk('access', 200, 180),
      g8Walk('egress', 245, 220, 'review_required'),
    ])

    for (const result of [isuFast, isuSlow, dongjakFast, dongjakSlow]) {
      expect(result.status).toBe('available')
    }
    if (
      isuFast.status !== 'available' || isuSlow.status !== 'available' ||
      dongjakFast.status !== 'available' || dongjakSlow.status !== 'available'
    ) return
    expect(isuFast.estimate.appliedDurationSeconds)
      .toBeLessThan(isuSlow.estimate.appliedDurationSeconds)
    expect(dongjakFast.estimate.appliedDurationSeconds)
      .toBeLessThan(dongjakSlow.estimate.appliedDurationSeconds)
    expect(isuFast.estimate.appliedDurationSeconds).toBe(2_935)
    expect(isuSlow.estimate.appliedDurationSeconds).toBe(3_131)
    expect(dongjakFast.estimate.appliedDurationSeconds).toBe(2_545)
    expect(dongjakSlow.estimate.appliedDurationSeconds).toBe(2_668)
    expect(dongjakFast.estimate.g8Adjustments[1].endpointVerification)
      .toBe('review_required')
  })

  it('review_required 결과에서 유효한 G8 후보가 하나일 때만 추정 증거로 채택한다', () => {
    const evidence = g8Walk('egress', 245, 220, 'review_required')
    const result: AutomaticTransitEgressResult = {
      status: 'review_required',
      reason: 'EGRESS_WALK_REVIEW_REQUIRED',
      detailReason: 'WALKING_ENDPOINT_MISMATCH',
      subwayCandidates: [],
      busCandidates: [{
        stopId: 'stop', arsId: 'ars', stopName: '하차정류장',
        coordinate: { latitude: 37, longitude: 127 },
        routeId: 'route', routeName: '17', distanceFromSearchAnchorM: 10,
        orderedStopNames: ['승차', '하차'], walkingRouteStatus: 'available',
        walkingRoute: evidence.walkingRoute, walkingDistanceM: 245,
        walkingProviderDurationSeconds: 220, startGapM: 57.2,
        destinationGapM: 37.7, walkingErrorCode: null,
      }],
    }

    expect(collectKakaoEtaG8WalkEvidence(null, result)).toEqual([
      expect.objectContaining({
        scope: 'egress', endpointVerification: 'review_required',
        startGapM: 57.2, destinationGapM: 37.7,
      }),
    ])
    result.busCandidates.push({ ...result.busCandidates[0], stopId: 'other' })
    expect(collectKakaoEtaG8WalkEvidence(null, result)).toEqual([])
  })

  it('G8 polyline이나 좌표가 비정상이면 추정에 포함하지 않는다', () => {
    const invalid = g8Walk('access', 500, 400)
    invalid.walkingRoute.coordinates = [{ latitude: 37, longitude: 127 }]

    expect(calculateKakaoTransitEta(route([]), model(2), [invalid])).toEqual({
      status: 'unavailable',
      reason: 'NO_EXPLICIT_WALKING_STEP',
    })
  })
})
