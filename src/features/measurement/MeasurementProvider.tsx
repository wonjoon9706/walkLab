import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useAuth } from '../auth/authContext'
import { localMeasurementRepository } from '../../repositories/local/localMeasurementRepository'
import { createGpsCollector } from '../../services/gps/gpsCollector'
import {
  createMeasurementManager,
  type MeasurementManager,
  type MeasurementManagerDependencies,
} from './measurementManager'
import {
  MeasurementContext,
  type MeasurementContextValue,
} from './measurementContext'
import { useSync } from '../sync/syncContext'

interface MeasurementProviderProps {
  children: ReactNode
  dependencies?: MeasurementManagerDependencies
}

function getSourcePlatform(): string {
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
  const isSafari = /Safari/.test(navigator.userAgent) && !/CriOS/.test(navigator.userAgent)

  return isIos && isSafari ? 'web-ios-safari' : 'web-browser'
}

function createDefaultDependencies(
  notifyPointSaved: (ownerUserId: string) => Promise<void>,
  notifyMeasurementStopped: () => void,
): MeasurementManagerDependencies {
  return {
    repository: localMeasurementRepository,
    createCollector() {
      if (navigator.geolocation === undefined) {
        throw new Error('GEOLOCATION_UNSUPPORTED')
      }

      return createGpsCollector(navigator.geolocation)
    },
    getOnline: () => navigator.onLine,
    getSecureContext: () => window.isSecureContext,
    getSourcePlatform,
    now: () => new Date(),
    createId: () => crypto.randomUUID(),
    onPointSaved: (ownerUserId) => {
      void notifyPointSaved(ownerUserId)
    },
    onMeasurementStopped: notifyMeasurementStopped,
  }
}

export function MeasurementProvider({
  children,
  dependencies,
}: MeasurementProviderProps) {
  const { status: authStatus, user, confirmCurrentUser } = useAuth()
  const { notifyPointSaved, notifyMeasurementStopped } = useSync()
  const [manager] = useState<MeasurementManager>(() =>
    createMeasurementManager(
      dependencies ??
        createDefaultDependencies(
          notifyPointSaved,
          notifyMeasurementStopped,
        ),
    ),
  )
  const [measurementState, setMeasurementState] = useState(
    () => manager.getState(),
  )

  useEffect(() => manager.subscribe(setMeasurementState), [manager])

  useEffect(() => {
    if (authStatus === 'authenticated' && user !== null) {
      void manager.recover(user.id)
    }
  }, [authStatus, manager, user])

  useEffect(() => {
    function handleOnline() {
      manager.updateNetworkStatus(true)
    }

    function handleOffline() {
      manager.updateNetworkStatus(false)
    }

    function handleVisibilityChange() {
      manager.recordVisibility(document.visibilityState === 'visible')
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      manager.dispose()
    }
  }, [manager])

  const startMeasurement = useCallback(
    () => manager.start({ user, confirmCurrentUser }),
    [confirmCurrentUser, manager, user],
  )

  const stopMeasurement = useCallback(() => manager.stop(), [manager])
  const isActive =
    measurementState.status === 'starting' ||
    measurementState.status === 'recording'

  const value = useMemo<MeasurementContextValue>(
    () => ({
      ...measurementState,
      isActive,
      startMeasurement,
      stopMeasurement,
    }),
    [isActive, measurementState, startMeasurement, stopMeasurement],
  )

  return (
    <MeasurementContext.Provider value={value}>
      {children}
    </MeasurementContext.Provider>
  )
}
