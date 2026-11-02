import type { GeoCoordinate, WalkingRoute } from '../../domain/walkingRoute'

const EARTH_RADIUS_M = 6_371_008.8

export interface WalkingRouteEndpointGaps {
  startGapM: number
  destinationGapM: number
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

export function calculateCoordinateGapM(
  first: GeoCoordinate,
  second: GeoCoordinate,
): number {
  const latitudeDelta = toRadians(second.latitude - first.latitude)
  const longitudeDelta = toRadians(second.longitude - first.longitude)
  const firstLatitude = toRadians(first.latitude)
  const secondLatitude = toRadians(second.latitude)
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(haversine))
}

export function calculateWalkingRouteEndpointGaps(
  route: WalkingRoute,
  requestedStart: GeoCoordinate,
  requestedDestination: GeoCoordinate,
): WalkingRouteEndpointGaps | null {
  const routeStart = route.coordinates[0]
  const routeDestination = route.coordinates.at(-1)
  if (routeStart === undefined || routeDestination === undefined) return null

  return {
    startGapM: calculateCoordinateGapM(requestedStart, routeStart),
    destinationGapM: calculateCoordinateGapM(
      requestedDestination,
      routeDestination,
    ),
  }
}
