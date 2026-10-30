import type { GeoCoordinate } from '../../domain/walkingRoute'

export type CurrentLocationErrorCode =
  | 'PERMISSION_DENIED'
  | 'POSITION_UNAVAILABLE'
  | 'TIMEOUT'
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
  if (geolocation === undefined) {
    return Promise.reject(new CurrentLocationError('UNSUPPORTED'))
  }

  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords
        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          latitude < -90 ||
          latitude > 90 ||
          longitude < -180 ||
          longitude > 180
        ) {
          reject(new CurrentLocationError('POSITION_UNAVAILABLE'))
          return
        }
        resolve({ latitude, longitude })
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
        maximumAge: 30_000,
      },
    )
  })
}
