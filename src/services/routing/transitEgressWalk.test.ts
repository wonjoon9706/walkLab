import { describe, expect, it } from 'vitest'
import type { WalkingSpeedModel } from '../../domain/walkingSpeedModel'
import { buildTransitEgressWalk } from './transitEgressWalk'

const start = { latitude: 37, longitude: 127 }
const destination = { latitude: 37.001, longitude: 127.001 }

function model(status: 'ready' | 'insufficient'): WalkingSpeedModel {
  return {
    algorithmVersion: 'recency-weighted-v1',
    status,
    estimatedSpeedMps: status === 'ready' ? 1.5 : null,
    simpleAverageSpeedMps: null,
    validSessionCount: status === 'ready' ? 8 : 1,
    windowDays: 30,
    trainingPeriodStart: null,
    trainingPeriodEnd: null,
    lastUpdatedAt: null,
    calculatedAt: '2026-01-01T00:00:00.000Z',
    estimatedOneKilometerSeconds: null,
    decisions: [],
  }
}

function build(speed: Parameters<typeof buildTransitEgressWalk>[0]['speed']) {
  return buildTransitEgressWalk({
    routeId: 'route',
    routeTotalDurationSeconds: 1_800,
    lastTransitStepIndex: 2,
    mode: 'BUS',
    expectedAlightingName: '도착정류장',
    expectedRouteName: '테스트17',
    actualVehicleNames: ['테스트17'],
    alightingPoint: {
      mode: 'BUS',
      alightingPointName: '도착정류장',
      routeName: '테스트17',
      locationName: '도착정류장',
      coordinate: start,
      source: 'seoul_bus_stop',
      providerStopId: 'stop',
      arsId: '10000',
      providerRouteId: 'route-id',
      verification: 'verified_bus_stop',
      directionVerification: 'route_stop_order',
    },
    destination: {
      name: '목적지',
      coordinate: destination,
      source: 'user_selected_place',
      providerPlaceId: 'place-id',
    },
    walkingRoute: {
      distanceM: 300,
      providerDurationSeconds: 260,
      coordinates: [start, destination],
      provider: 'kakao-walking-route',
      requestedAt: '2026-01-01T00:00:00.000Z',
    },
    speed,
  })
}

describe('buildTransitEgressWalk speed evidence', () => {
  it('유효 G7 모델을 개인화 속도로 구분한다', () => {
    const result = build({ kind: 'g7_model', model: model('ready') })
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.egressWalk.speedBasis.kind).toBe('g7_personalized')
    expect(result.egressWalk.pureWalkingDurationSeconds).toBe(200)
  })

  it('미학습 G7 모델은 기본속도 fallback으로 구분한다', () => {
    const result = build({ kind: 'g7_model', model: model('insufficient') })
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.egressWalk.speedBasis.kind).toBe('g7_default_fallback')
  })

  it('참고속도를 개인화 결과로 표시하지 않는다', () => {
    const result = build({
      kind: 'reference_only',
      speedMps: 5.7 / 3.6,
      label: '테스트 참고속도',
    })
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.egressWalk.speedBasis.kind).toBe('reference_only')
    expect(result.egressWalk.personalizedTotalEtaSeconds).toBeNull()
  })
})
