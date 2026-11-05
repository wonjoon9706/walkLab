import { describe, expect, it } from 'vitest'
import type { LiveNavigationState } from '../../domain/liveNavigation'
import type { WalkingRoute } from '../../domain/walkingRoute'
import { getLiveFirstBoardingAccess } from './transitLiveBoarding'

const now = Date.parse('2026-11-05T01:00:00Z')
const route: WalkingRoute = { distanceM: 1000, providerDurationSeconds: 900,
  provider: 'kakao-walking-route', requestedAt: new Date(now).toISOString(),
  coordinates: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.01 }] }
function walkingNavigation(): LiveNavigationState {
  return { isActive: true, status: 'moving', route, isReferenceRoute: false,
    currentPosition: { latitude: 0, longitude: 0.005 }, currentAccuracyM: 5,
    remainingCoordinates: [], remainingDistanceM: 450, progressRatio: 0.55,
    recentSpeedMps: 1.7, appliedSpeedMps: 1.6, baselineSpeed: null, pace: 'similar',
    speedSource: 'recent_blended', remainingDurationSeconds: 270,
    arrivalAt: new Date(now + 270_000).toISOString(), lastPositionAt: new Date(now).toISOString(),
    rerouteCount: 0, message: null }
}

describe('G9 남은 도보시간을 첫 버스 판단에 연결', () => {
  it('동일 안내 경로의 기존 안정화된 남은 시간을 재사용한다', () => {
    const navigation = walkingNavigation()
    expect(getLiveFirstBoardingAccess('route', route, { routeId: 'route', isRecording: true, navigation }, null, now))
      .toEqual({ source: 'live_pace', durationSeconds: 270 })
  })
  it('경로가 다르거나 안내 전이면 기존 계산을 유지한다', () => {
    const navigation = walkingNavigation()
    expect(getLiveFirstBoardingAccess('other', route, { routeId: 'route', isRecording: true, navigation }, null, now)).toBeUndefined()
    expect(getLiveFirstBoardingAccess('route', route, { routeId: 'route', isRecording: false, navigation }, null, now)).toBeUndefined()
    expect(getLiveFirstBoardingAccess('route', route, { routeId: 'route', isRecording: false, guidanceEnded: true, navigation }, null, now)?.source).toBe('unavailable')
  })
  it('속도 확인 중에는 전체 1000m가 아닌 남은 450m에 G7/default를 적용한다', () => {
    const navigation = { ...walkingNavigation(), recentSpeedMps: null, speedSource: 'default' as const, pace: 'checking' as const }
    const value = getLiveFirstBoardingAccess('route', route, { routeId: 'route', isRecording: true, navigation }, null, now)!
    expect(value.source).toBe('g7_remaining')
    expect(value.durationSeconds).toBe(338)
    const model = { algorithmVersion: 'recency-weighted-v1' as const, status: 'ready' as const,
      estimatedSpeedMps: 1.5, simpleAverageSpeedMps: 1.5, validSessionCount: 3, windowDays: 30 as const,
      trainingPeriodStart: null, trainingPeriodEnd: null, lastUpdatedAt: null,
      calculatedAt: new Date(now).toISOString(), estimatedOneKilometerSeconds: 1000 / 1.5, decisions: [] }
    expect(getLiveFirstBoardingAccess('route', route, { routeId: 'route', isRecording: true, navigation }, model, now))
      .toEqual({ source: 'g7_remaining', durationSeconds: 300 })
  })
  it.each(['stale', 'off_route', 'gps_unstable', 'starting', 'error'] as const)('%s는 전체 출발 도보로 돌아가 잘못 판단하지 않는다', (status) => {
    expect(getLiveFirstBoardingAccess('route', route,
      { routeId: 'route', isRecording: true, navigation: { ...walkingNavigation(), status } }, null, now))
      .toEqual({ source: 'unavailable', durationSeconds: null })
  })
  it('낡은 GPS·참고 연결·다른 G8 경로는 판단에 사용하지 않는다', () => {
    const context = { routeId: 'route', isRecording: true, navigation: walkingNavigation() }
    expect(getLiveFirstBoardingAccess('route', route, context, null, now + 21_000)?.source).toBe('unavailable')
    expect(getLiveFirstBoardingAccess('route', { ...route }, context, null, now)?.source).toBe('unavailable')
    expect(getLiveFirstBoardingAccess('route', route, { ...context, navigation: { ...context.navigation, isReferenceRoute: true } }, null, now)?.source).toBe('unavailable')
  })
})
