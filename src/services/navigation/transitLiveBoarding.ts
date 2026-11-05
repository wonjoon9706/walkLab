import type { LiveNavigationState } from '../../domain/liveNavigation'
import type { WalkingRoute } from '../../domain/walkingRoute'
import type { WalkingSpeedModel } from '../../domain/walkingSpeedModel'
import type { FirstBoardingAccessEstimate } from '../routing/transitBoarding'
import { selectWalkingSpeedProfile } from '../routing/walkingEta'
import { liveNavigationConfig } from './liveNavigationConfig'

export interface TransitLiveWalkingContext {
  routeId: string | null
  isRecording: boolean
  guidanceEnded?: boolean
  navigation: LiveNavigationState | undefined
}

export function getLiveFirstBoardingAccess(
  routeId: string,
  walkingRoute: WalkingRoute,
  context: TransitLiveWalkingContext | undefined,
  model: WalkingSpeedModel | null,
  now: number,
): FirstBoardingAccessEstimate | undefined {
  const unavailable: FirstBoardingAccessEstimate = { source: 'unavailable', durationSeconds: null }
  if (context === undefined || context.routeId !== routeId) return undefined
  if (!context.isRecording) return context.guidanceEnded ? unavailable : undefined
  const navigation = context.navigation
  if (navigation === undefined || !navigation.isActive || navigation.route !== walkingRoute || navigation.isReferenceRoute ||
    !['moving', 'stationary'].includes(navigation.status)) return unavailable
  const age = now - Date.parse(navigation.lastPositionAt ?? '')
  if (!Number.isFinite(age) || age < -5_000 || age >= liveNavigationConfig.staleAfterSeconds * 1000 ||
    navigation.currentAccuracyM === null || !Number.isFinite(navigation.currentAccuracyM) || navigation.currentAccuracyM < 0 ||
    navigation.currentAccuracyM > liveNavigationConfig.maximumAccuracyM ||
    navigation.remainingDistanceM === null || !Number.isFinite(navigation.remainingDistanceM) || navigation.remainingDistanceM < 0) return unavailable
  if (navigation.status === 'moving' && navigation.speedSource === 'recent_blended' && navigation.pace !== 'checking' &&
    navigation.recentSpeedMps !== null && Number.isFinite(navigation.recentSpeedMps) && navigation.recentSpeedMps > 0 &&
    navigation.remainingDurationSeconds !== null && Number.isFinite(navigation.remainingDurationSeconds) && navigation.remainingDurationSeconds >= 0) {
    return { source: 'live_pace', durationSeconds: navigation.remainingDurationSeconds }
  }
  // 현재 속도 확인 중/정지 중에는 남은 경로거리와 기존 G7/default만 사용한다.
  const profile = selectWalkingSpeedProfile(model)
  return { source: 'g7_remaining', durationSeconds: Math.ceil(navigation.remainingDistanceM / profile.speedMps) }
}
