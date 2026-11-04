import type { GeoCoordinate, WalkingRoute } from './walkingRoute'

export const transitReferenceWalkPresentation = {
  strokeColor: '#d97706',
  strokeStyle: 'dot',
  requestedStartMarkerColor: '#6750a4',
  routeStartMarkerColor: '#d97706',
  routeEndMarkerColor: '#f59e0b',
  requestedDestinationMarkerColor: '#9f3a62',
} as const

export interface TransitReferenceWalkOverlay {
  id: string
  scope: 'access' | 'egress'
  label: string
  coordinates: GeoCoordinate[]
  distanceM: number
  providerDurationSeconds: number
  requestedStart: GeoCoordinate
  requestedDestination: GeoCoordinate
  startGapM: number
  destinationGapM: number
}

export interface TransitReferenceWalkInput {
  id: string
  scope: 'access' | 'egress'
  label: string
  walkingRoute: WalkingRoute
  requestedStart: GeoCoordinate
  requestedDestination: GeoCoordinate
  startGapM: number | null
  destinationGapM: number | null
}
