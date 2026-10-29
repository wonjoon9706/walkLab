export interface GpsCollector {
  start: (
    onPosition: PositionCallback,
    onError: PositionErrorCallback,
  ) => void
  stop: () => void
  isRunning: () => boolean
}

const gpsOptions: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 15_000,
}

export function createGpsCollector(
  geolocation: Geolocation,
): GpsCollector {
  let watchId: number | null = null

  return {
    start(onPosition, onError) {
      if (watchId !== null) {
        throw new Error('GPS_WATCH_ALREADY_RUNNING')
      }

      watchId = geolocation.watchPosition(
        onPosition,
        onError,
        gpsOptions,
      )
    },

    stop() {
      if (watchId === null) {
        return
      }

      geolocation.clearWatch(watchId)
      watchId = null
    },

    isRunning() {
      return watchId !== null
    },
  }
}
