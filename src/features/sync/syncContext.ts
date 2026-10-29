import { createContext, useContext } from 'react'
import type { SyncCoordinatorState } from '../../services/sync/syncCoordinator'

export interface SyncContextValue extends SyncCoordinatorState {
  runSync: (reason: string) => Promise<void>
  notifyPointSaved: (ownerUserId: string) => Promise<void>
  notifyMeasurementStopped: () => void
}

export const SyncContext = createContext<SyncContextValue | null>(null)

export function useSync(): SyncContextValue {
  const context = useContext(SyncContext)
  if (context === null) {
    throw new Error('useSync는 SyncProvider 안에서 사용해야 합니다.')
  }
  return context
}
