import type {
  TransitEtaEstimate,
  TransitItinerary,
} from '../../domain/transitRoute'
import type { WalkingSpeedModel } from '../../domain/walkingSpeedModel'
import { selectWalkingSpeedProfile } from './walkingEta'

export interface TransitDurationAudit {
  legDurationSumSeconds: number
  providerToLegDifferenceSeconds: number
  personalizationAdjustmentSeconds: number
}

export function auditTransitDurations(
  itinerary: TransitItinerary,
  estimate: TransitEtaEstimate,
): TransitDurationAudit {
  const legDurationSumSeconds = itinerary.legs.reduce(
    (sum, leg) => sum + leg.durationSeconds,
    0,
  )
  return {
    legDurationSumSeconds,
    providerToLegDifferenceSeconds:
      itinerary.totalDurationSeconds - legDurationSumSeconds,
    personalizationAdjustmentSeconds:
      estimate.appliedDurationSeconds - itinerary.totalDurationSeconds,
  }
}

export function calculateTransitEta(
  itinerary: TransitItinerary,
  model: WalkingSpeedModel | null,
  calculatedAt: Date = new Date(),
): TransitEtaEstimate {
  if (
    !Number.isFinite(itinerary.totalDurationSeconds) ||
    itinerary.totalDurationSeconds <= 0 ||
    !Number.isFinite(itinerary.totalWalkDurationSeconds) ||
    itinerary.totalWalkDurationSeconds < 0 ||
    !Number.isFinite(itinerary.totalWalkDistanceM) ||
    itinerary.totalWalkDistanceM < 0 ||
    Number.isNaN(calculatedAt.getTime())
  ) {
    throw new Error('INVALID_TRANSIT_ITINERARY')
  }

  const speedProfile = selectWalkingSpeedProfile(model)
  const nonWalkingDurationSeconds = Math.max(
    0,
    itinerary.totalDurationSeconds - itinerary.totalWalkDurationSeconds,
  )
  const canPersonalize =
    speedProfile.source === 'personalized' &&
    itinerary.totalWalkDistanceM > 0
  const personalizedWalkDurationSeconds = canPersonalize
    ? itinerary.totalWalkDistanceM / speedProfile.speedMps
    : null
  const appliedDurationSeconds =
    personalizedWalkDurationSeconds === null
      ? itinerary.totalDurationSeconds
      : nonWalkingDurationSeconds + personalizedWalkDurationSeconds

  return {
    providerDurationSeconds: itinerary.totalDurationSeconds,
    appliedDurationSeconds,
    personalizedWalkDurationSeconds,
    arrivalAt: new Date(
      calculatedAt.getTime() + appliedDurationSeconds * 1000,
    ).toISOString(),
    speedProfile,
  }
}
