import type { RawGpsPoint } from '../../domain/measurement'
import { isValidCoordinate } from '../../services/analysis/walkingAnalysis'

export interface RouteCoordinate {
  latitude: number
  longitude: number
}

export function getRouteCoordinates(
  points: RawGpsPoint[],
): RouteCoordinate[] {
  return points
    .filter(isValidCoordinate)
    .map((point) => ({
      latitude: point.latitude,
      longitude: point.longitude,
    }))
}
