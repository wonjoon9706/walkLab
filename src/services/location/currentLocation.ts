import type { GeoCoordinate } from '../../domain/walkingRoute'

export interface CurrentLocationFix {
  coordinate: GeoCoordinate
  accuracyM: number | null
  measuredAt: string
}

export type CurrentLocationErrorCode =
  | 'PERMISSION_DENIED'
  | 'POSITION_UNAVAILABLE'
  | 'TIMEOUT'
  | 'STALE_POSITION'
  | 'UNSUPPORTED'

export class CurrentLocationError extends Error {
  constructor(public readonly code: CurrentLocationErrorCode) {
    super(code)
    this.name = 'CurrentLocationError'
  }
}

export function getCurrentLocation(
  geolocation: Geolocation | undefined = navigator.geolocation,
): Promise<GeoCoordinate> {
  return getCurrentLocationFix(geolocation).then((fix) => fix.coordinate)
}

export function getCurrentLocationFix(
  geolocation: Geolocation | undefined = navigator.geolocation,
): Promise<CurrentLocationFix> {
  if (geolocation === undefined) {
    return Promise.reject(new CurrentLocationError('UNSUPPORTED'))
  }

  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords
        const measuredAtMs = position.timestamp
        const positionAgeMs = Date.now() - measuredAtMs
        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          latitude < -90 ||
          latitude > 90 ||
          longitude < -180 ||
          longitude > 180 ||
          !Number.isFinite(measuredAtMs)
        ) {
          reject(new CurrentLocationError('POSITION_UNAVAILABLE'))
          return
        }
        if (positionAgeMs < -5_000 || positionAgeMs > 15_000) {
          reject(new CurrentLocationError('STALE_POSITION'))
          return
        }
        resolve({
          coordinate: { latitude, longitude },
          accuracyM:
            Number.isFinite(position.coords.accuracy) &&
            position.coords.accuracy >= 0
              ? position.coords.accuracy
              : null,
          measuredAt: new Date(measuredAtMs).toISOString(),
        })
      },
      (error) => {
        const codeByPositionError: Record<number, CurrentLocationErrorCode> = {
          1: 'PERMISSION_DENIED',
          2: 'POSITION_UNAVAILABLE',
          3: 'TIMEOUT',
        }
        reject(
          new CurrentLocationError(
            codeByPositionError[error.code] ?? 'POSITION_UNAVAILABLE',
          ),
        )
      },
      {
        enableHighAccuracy: true,
        timeout: 15_000,
        maximumAge: 0,
      },
    )
  })
}
