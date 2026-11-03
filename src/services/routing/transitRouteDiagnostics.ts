import type { TransitItinerary } from '../../domain/transitRoute'
import type { GeoCoordinate } from '../../domain/walkingRoute'
import { calculateCoordinateGapM } from './walkingRouteDiagnostics'

export interface LastWalkingLegDiagnostic {
  provider: 'tmap-transit'
  destinationCoordinate: GeoCoordinate
  startName: string
  startCoordinate: GeoCoordinate | null
  endName: string
  endCoordinate: GeoCoordinate | null
  distanceM: number
  durationSeconds: number
  parsedPathPointCount: number
  parsedPathDistanceM: number | null
  straightLineDistanceM: number | null
  destinationGapM: number | null
  previousTransitStopName: string | null
  previousTransitStopCoordinate: GeoCoordinate | null
}

function calculatePathDistanceM(coordinates: GeoCoordinate[]): number | null {
  if (coordinates.length < 2) return null
  let distanceM = 0
  for (let index = 1; index < coordinates.length; index += 1) {
    distanceM += calculateCoordinateGapM(
      coordinates[index - 1],
      coordinates[index],
    )
  }
  return distanceM
}

export function getLastWalkingLegDiagnostic(
  itinerary: TransitItinerary,
  destinationCoordinate: GeoCoordinate,
): LastWalkingLegDiagnostic | null {
  const lastLegIndex = itinerary.legs.length - 1
  const lastLeg = itinerary.legs[lastLegIndex]
  if (lastLeg?.mode !== 'WALK') return null

  const previousLeg = itinerary.legs[lastLegIndex - 1]
  const previousStop = previousLeg?.stops?.at(-1)
  const previousTransitStopCoordinate = previousStop?.coordinate ??
    previousLeg?.endCoordinate ?? null
  const startCoordinate = lastLeg.startCoordinate ?? null
  const endCoordinate = lastLeg.endCoordinate ?? null

  return {
    provider: 'tmap-transit',
    destinationCoordinate,
    startName: lastLeg.startName,
    startCoordinate,
    endName: lastLeg.endName,
    endCoordinate,
    distanceM: lastLeg.distanceM,
    durationSeconds: lastLeg.durationSeconds,
    parsedPathPointCount: lastLeg.coordinates.length,
    parsedPathDistanceM: calculatePathDistanceM(lastLeg.coordinates),
    straightLineDistanceM:
      startCoordinate === null || endCoordinate === null
        ? null
        : calculateCoordinateGapM(startCoordinate, endCoordinate),
    destinationGapM: endCoordinate === null
      ? null
      : calculateCoordinateGapM(endCoordinate, destinationCoordinate),
    previousTransitStopName: previousStop?.name ?? previousLeg?.endName ?? null,
    previousTransitStopCoordinate,
  }
}
