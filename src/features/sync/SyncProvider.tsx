import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/authContext'
import { localMeasurementRepository } from '../../repositories/local/localMeasurementRepository'
import { remoteSyncRepository } from '../../repositories/remote/remoteSyncRepository'
import {
  createSyncCoordinator,
  type SyncCoordinator,
  type SyncCoordinatorDependencies,
} from '../../services/sync/syncCoordinator'
import { SyncContext, type SyncContextValue } from './syncContext'

interface SyncProviderProps {
  children: ReactNode
  dependencies?: SyncCoordinatorDependencies
}

export function SyncProvider({ children, dependencies }: SyncProviderProps) {
  const {
    status: authStatus,
    confirmCurrentUser,
    refreshCurrentUser,
  } = useAuth()
  const [coordinator] = useState<SyncCoordinator>(() =>
    createSyncCoordinator(
      dependencies ?? {
        localRepository: localMeasurementRepository,
        remoteRepository: remoteSyncRepository,
        getCurrentUser: confirmCurrentUser,
        refreshCurrentUser,
        getOnline: () => navigator.onLine,
        now: () => new Date(),
        sleep: (milliseconds) =>
          new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
        setTimer: (callback, milliseconds) =>
          window.setTimeout(callback, milliseconds),
        clearTimer: (timerId) => window.clearTimeout(timerId),
      },
    ),
  )
  const [syncState, setSyncState] = useState(() => coordinator.getState())

  useEffect(() => coordinator.subscribe(setSyncState), [coordinator])

  useEffect(() => {
    if (authStatus === 'authenticated') {
      void coordinator.run('app_start_or_auth_restored')
    }
  }, [authStatus, coordinator])

  useEffect(() => {
    function handleOnline() {
      void coordinator.run('online')
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void coordinator.run('visible')
      }
    }

    window.addEventListener('online', handleOnline)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      coordinator.dispose()
    }
  }, [coordinator])

  const value = useMemo<SyncContextValue>(
    () => ({
      ...syncState,
      runSync: (reason) => coordinator.run(reason),
      notifyPointSaved: (ownerUserId) =>
        coordinator.notifyPointSaved(ownerUserId),
      notifyMeasurementStopped: () => coordinator.notifyMeasurementStopped(),
    }),
    [coordinator, syncState],
  )

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}
