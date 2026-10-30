import type { WalkingSpeedModel } from '../../domain/walkingSpeedModel'
import type {
  WalkingEtaEstimate,
  WalkingSpeedProfile,
} from '../../domain/walkingRoute'
import {
  walkingEtaConfig,
  type WalkingEtaConfig,
} from './walkingEtaConfig'

function isPositiveFinite(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0
}

export function selectWalkingSpeedProfile(
  model: WalkingSpeedModel | null,
  config: WalkingEtaConfig = walkingEtaConfig,
): WalkingSpeedProfile {
  if (
    model?.status === 'ready' &&
    isPositiveFinite(model.estimatedSpeedMps)
  ) {
    return {
      speedMps: model.estimatedSpeedMps,
      source: 'personalized',
      modelVersion: model.algorithmVersion,
      validSessionCount: model.validSessionCount,
    }
  }

  if (!isPositiveFinite(config.defaultWalkingSpeedMps)) {
    throw new Error('INVALID_DEFAULT_WALKING_SPEED')
  }

  return {
    speedMps: config.defaultWalkingSpeedMps,
    source: 'default',
    modelVersion: 'default-v1',
    validSessionCount: model?.validSessionCount ?? 0,
  }
}

export function calculateWalkingEta(
  distanceM: number,
  providerDurationSeconds: number,
  model: WalkingSpeedModel | null,
  calculatedAt: Date = new Date(),
  config: WalkingEtaConfig = walkingEtaConfig,
): WalkingEtaEstimate {
  if (!Number.isFinite(distanceM) || distanceM <= 0) {
    throw new Error('INVALID_ROUTE_DISTANCE')
  }
  if (
    !Number.isFinite(providerDurationSeconds) ||
    providerDurationSeconds <= 0
  ) {
    throw new Error('INVALID_PROVIDER_DURATION')
  }
  if (Number.isNaN(calculatedAt.getTime())) {
    throw new Error('INVALID_CALCULATION_TIME')
  }

  const speedProfile = selectWalkingSpeedProfile(model, config)
  const appliedDurationSeconds = distanceM / speedProfile.speedMps
  const defaultDurationSeconds = distanceM / config.defaultWalkingSpeedMps

  return {
    appliedDurationSeconds,
    defaultDurationSeconds,
    providerDurationSeconds,
    arrivalAt: new Date(
      calculatedAt.getTime() + appliedDurationSeconds * 1000,
    ).toISOString(),
    calculatedAt: calculatedAt.toISOString(),
    speedProfile,
  }
}
