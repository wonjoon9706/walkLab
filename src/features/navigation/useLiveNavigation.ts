import { useCallback, useEffect, useState } from 'react'
import type { StartLiveNavigationInput } from '../../domain/liveNavigation'
import { createGpsCollector } from '../../services/gps/gpsCollector'
import { createLiveNavigationManager } from '../../services/navigation/liveNavigationManager'
import type { LiveNavigationPositionSource } from '../../services/navigation/liveNavigationManager'
import { walkingRouteClient } from '../../services/routing/walkingRouteClient'

export function useLiveNavigation() {
  const [manager] = useState(() =>
    createLiveNavigationManager({
      createCollector() {
        if (navigator.geolocation === undefined) {
          throw new Error('GEOLOCATION_UNSUPPORTED')
        }
        return createGpsCollector(navigator.geolocation)
      },
      requestRoute: (start, destination) =>
        walkingRouteClient.getWalkingRoute({ start, destination }),
      getSecureContext: () => window.isSecureContext,
      now: () => new Date(),
      setInterval: (callback, milliseconds) =>
        window.setInterval(callback, milliseconds),
      clearInterval: (intervalId) => window.clearInterval(intervalId),
    }),
  )
  const [state, setState] = useState(() => manager.getState())

  useEffect(() => {
    const unsubscribe = manager.subscribe(setState)
    const updateVisibility = () => manager.setVisible(document.visibilityState === 'visible')
    updateVisibility()
    document.addEventListener('visibilitychange', updateVisibility)
    return () => {
      document.removeEventListener('visibilitychange', updateVisibility)
      unsubscribe()
      manager.dispose()
    }
  }, [manager])

  const start = useCallback(
    (input: StartLiveNavigationInput) => manager.start(input),
    [manager],
  )
  const startWithPositionSource = useCallback(
    (
      input: StartLiveNavigationInput,
      positionSource: LiveNavigationPositionSource,
    ) => manager.start(input, positionSource),
    [manager],
  )
  const stop = useCallback(() => manager.stop(), [manager])

  return { ...state, start, startWithPositionSource, stop }
}
