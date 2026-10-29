import type {
  LocalWalkSession,
  MeasurementEvent,
  RawGpsPoint,
  SyncEntityType,
  SyncItem,
} from '../../domain/measurement'
import type { LocalMeasurementRepository } from '../../repositories/local/localMeasurementRepository'
import type {
  RemoteFailure,
  RemoteSyncRepository,
  RemoteWriteResult,
} from '../../repositories/remote/remoteSyncRepository'
import type { AuthenticatedUser } from '../auth/authService'

export type SyncUiStatus =
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'partial'
  | 'auth_required'
  | 'offline'
  | 'error'

export interface SyncCoordinatorState {
  status: SyncUiStatus
  pendingCount: number
  confirmedCount: number
  failedCount: number
  lastSyncedAt: string | null
  message: string | null
}

export interface SyncCoordinator {
  getState: () => SyncCoordinatorState
  subscribe: (listener: (state: SyncCoordinatorState) => void) => () => void
  run: (reason: string) => Promise<void>
  notifyPointSaved: (ownerUserId: string) => Promise<void>
  notifyMeasurementStopped: () => void
  dispose: () => void
}

export interface SyncCoordinatorDependencies {
  localRepository: LocalMeasurementRepository
  remoteRepository: RemoteSyncRepository
  getCurrentUser: () => Promise<AuthenticatedUser | null>
  refreshCurrentUser: () => Promise<AuthenticatedUser | null>
  getOnline: () => boolean
  now: () => Date
  sleep: (milliseconds: number) => Promise<void>
  setTimer: (callback: () => void, milliseconds: number) => number
  clearTimer: (timerId: number) => void
}

const retryDelays = [5_000, 30_000, 120_000]

const initialState: SyncCoordinatorState = {
  status: 'idle',
  pendingCount: 0,
  confirmedCount: 0,
  failedCount: 0,
  lastSyncedAt: null,
  message: null,
}

function isRemoteFailure(error: unknown): error is RemoteFailure {
  return (
    typeof error === 'object' &&
    error !== null &&
    'kind' in error &&
    'code' in error
  )
}

function normalizeFailure(error: unknown): RemoteFailure {
  return isRemoteFailure(error)
    ? error
    : { kind: 'transient', code: 'NETWORK_ERROR' }
}

function keysForIds(items: SyncItem[], ids: string[]): string[] {
  const idSet = new Set(ids)
  return items
    .filter((item) => idSet.has(item.entityId))
    .map((item) => item.key)
}

export function createSyncCoordinator(
  dependencies: SyncCoordinatorDependencies,
): SyncCoordinator {
  let state = initialState
  let runningPromise: Promise<void> | null = null
  let rerunRequested = false
  let debounceTimer: number | null = null
  const listeners = new Set<(state: SyncCoordinatorState) => void>()

  function publish(next: Partial<SyncCoordinatorState>) {
    state = { ...state, ...next }
    listeners.forEach((listener) => listener(state))
  }

  async function updateSummary(ownerUserId: string) {
    const summary = await dependencies.localRepository.getSyncSummary(ownerUserId)
    publish({
      pendingCount:
        summary.pending + summary.syncing + summary.retry_wait + summary.auth_required,
      confirmedCount: summary.confirmed,
      failedCount:
        summary.failed + summary.owner_mismatch + summary.suppressed_by_deletion,
    })
  }

  async function setRemainingFailure(
    items: SyncItem[],
    failure: RemoteFailure,
  ) {
    const keys = items.map((item) => item.key)

    if (failure.kind === 'auth') {
      await dependencies.localRepository.setSyncItemsState(
        keys,
        'auth_required',
        failure.code,
      )
      return
    }

    if (failure.kind === 'forbidden') {
      await dependencies.localRepository.setSyncItemsState(
        keys,
        'owner_mismatch',
        failure.code,
      )
      return
    }

    if (failure.kind === 'deletion') {
      await dependencies.localRepository.setSyncItemsState(
        keys,
        'suppressed_by_deletion',
        failure.code,
      )
      return
    }

    if (failure.kind === 'validation') {
      await dependencies.localRepository.setSyncItemsState(
        keys,
        'failed',
        failure.code,
      )
      return
    }

    await dependencies.localRepository.setSyncItemsState(
      keys,
      'retry_wait',
      failure.code,
    )
  }

  async function syncBatch<T>(
    ownerUserId: string,
    items: SyncItem[],
    entities: T[],
    getId: (entity: T) => string,
    write: (entitiesToWrite: T[]) => Promise<RemoteWriteResult>,
  ) {
    let remainingItems = items
    let remainingEntities = entities
    let authRefreshUsed = false
    let transientRetryIndex = 0

    while (remainingItems.length > 0) {
      await dependencies.localRepository.setSyncItemsState(
        remainingItems.map((item) => item.key),
        'syncing',
      )
      let result: RemoteWriteResult

      try {
        result = await write(remainingEntities)
      } catch (error) {
        result = { confirmedIds: [], failure: normalizeFailure(error) }
      }

      const confirmedKeys = keysForIds(remainingItems, result.confirmedIds)
      await dependencies.localRepository.setSyncItemsState(
        confirmedKeys,
        'confirmed',
      )

      const confirmedIdSet = new Set(result.confirmedIds)
      remainingItems = remainingItems.filter(
        (item) => !confirmedIdSet.has(item.entityId),
      )
      remainingEntities = remainingEntities.filter(
        (entity) => !confirmedIdSet.has(getId(entity)),
      )

      if (remainingItems.length === 0) {
        return
      }

      const failure =
        result.failure ?? { kind: 'transient', code: 'NOT_CONFIRMED' }

      if (failure.kind === 'auth' && !authRefreshUsed) {
        authRefreshUsed = true
        const refreshedUser = await dependencies.refreshCurrentUser()
        if (refreshedUser?.id === ownerUserId) {
          continue
        }
      }

      if (
        failure.kind === 'transient' &&
        transientRetryIndex < retryDelays.length
      ) {
        const delay = retryDelays[transientRetryIndex]
        transientRetryIndex += 1
        await dependencies.sleep(delay)
        continue
      }

      await setRemainingFailure(remainingItems, failure)
      return
    }
  }

  async function syncSessions(ownerUserId: string) {
    const items = (await dependencies.localRepository.listPendingSyncItems(
      ownerUserId,
    )).filter((item) => item.entityType === 'session')

    for (const item of items) {
      const session = await dependencies.localRepository.getSession(
        ownerUserId,
        item.entityId,
      )

      if (session === undefined) {
        await dependencies.localRepository.setSyncItemsState(
          [item.key],
          'failed',
          'LOCAL_ENTITY_MISSING',
        )
        continue
      }

      await syncBatch<LocalWalkSession>(
        ownerUserId,
        [item],
        [session],
        (value) => value.id,
        async ([value]) => dependencies.remoteRepository.syncSession(value),
      )
    }
  }

  async function loadDeletionCutoff(ownerUserId: string) {
    let transientRetryIndex = 0
    let authRefreshUsed = false

    while (true) {
      try {
        return await dependencies.remoteRepository.getDeletionCutoff(ownerUserId)
      } catch (error) {
        const failure = normalizeFailure(error)

        if (failure.kind === 'auth' && !authRefreshUsed) {
          authRefreshUsed = true
          const refreshedUser = await dependencies.refreshCurrentUser()
          if (refreshedUser?.id === ownerUserId) {
            continue
          }
        }

        if (
          failure.kind === 'transient' &&
          transientRetryIndex < retryDelays.length
        ) {
          const delay = retryDelays[transientRetryIndex]
          transientRetryIndex += 1
          await dependencies.sleep(delay)
          continue
        }

        throw failure
      }
    }
  }

  async function syncChildren(
    ownerUserId: string,
    entityType: Exclude<SyncEntityType, 'session'>,
    batchSize: number,
  ) {
    const pendingItems = await dependencies.localRepository.listPendingSyncItems(
      ownerUserId,
    )
    const allItems = await dependencies.localRepository.listSyncItems(
      ownerUserId,
    )
    const confirmedSessionIds = new Set(
      allItems
        .filter(
          (item) =>
            item.entityType === 'session' && item.state === 'confirmed',
        )
        .map((item) => item.sessionId),
    )
    const pending = pendingItems.filter(
      (item) =>
        item.entityType === entityType &&
        confirmedSessionIds.has(item.sessionId),
    )

    for (let index = 0; index < pending.length; index += batchSize) {
      const batch = pending.slice(index, index + batchSize)

      if (entityType === 'gps_point') {
        const points = await dependencies.localRepository.listPointsByIds(
          ownerUserId,
          batch.map((item) => item.entityId),
        )
        const pointIds = new Set(points.map((point) => point.id))
        const validItems = batch.filter((item) => pointIds.has(item.entityId))
        const missingKeys = batch
          .filter((item) => !pointIds.has(item.entityId))
          .map((item) => item.key)
        await dependencies.localRepository.setSyncItemsState(
          missingKeys,
          'failed',
          'LOCAL_ENTITY_MISSING',
        )
        await syncBatch<RawGpsPoint>(
          ownerUserId,
          validItems,
          points,
          (point) => point.id,
          (values) => dependencies.remoteRepository.syncPoints(ownerUserId, values),
        )
      } else {
        const events = await dependencies.localRepository.listEventsByIds(
          ownerUserId,
          batch.map((item) => item.entityId),
        )
        const eventIds = new Set(events.map((event) => event.id))
        const validItems = batch.filter((item) => eventIds.has(item.entityId))
        const missingKeys = batch
          .filter((item) => !eventIds.has(item.entityId))
          .map((item) => item.key)
        await dependencies.localRepository.setSyncItemsState(
          missingKeys,
          'failed',
          'LOCAL_ENTITY_MISSING',
        )
        await syncBatch<MeasurementEvent>(
          ownerUserId,
          validItems,
          events,
          (event) => event.id,
          (values) => dependencies.remoteRepository.syncEvents(ownerUserId, values),
        )
      }
    }
  }

  async function runInternal() {
    if (!dependencies.getOnline()) {
      publish({ status: 'offline', message: '인터넷 연결 후 자동으로 다시 동기화합니다.' })
      return
    }

    let user: AuthenticatedUser | null
    try {
      user = await dependencies.getCurrentUser()
    } catch {
      publish({
        status: 'auth_required',
        message: '로그인 상태를 확인하지 못해 동기화를 보류했습니다.',
      })
      return
    }
    if (user === null) {
      publish({ status: 'auth_required', message: '로그인 후 동기화를 다시 시작합니다.' })
      return
    }

    publish({ status: 'syncing', message: '저장한 GPS 데이터를 동기화하고 있습니다.' })
    await dependencies.localRepository.prepareSyncItems(user.id)

    let cutoff: string | null
    try {
      cutoff = await loadDeletionCutoff(user.id)
    } catch (error) {
      const failure = normalizeFailure(error)
      const items = await dependencies.localRepository.listPendingSyncItems(user.id)
      await setRemainingFailure(items, failure)
      await updateSummary(user.id)
      publish({
        status: failure.kind === 'auth' ? 'auth_required' : 'error',
        message: '삭제 기준을 확인하지 못해 동기화를 보류했습니다.',
      })
      return
    }

    if (cutoff !== null) {
      await dependencies.localRepository.saveDeletionCutoff(user.id, cutoff)
      await dependencies.localRepository.suppressSessionsAtOrBefore(user.id, cutoff)
    }

    await syncSessions(user.id)
    await syncChildren(user.id, 'gps_point', 100)
    await syncChildren(user.id, 'measurement_event', 50)
    await updateSummary(user.id)

    const hasProblems = state.pendingCount > 0 || state.failedCount > 0
    publish({
      status: hasProblems ? 'partial' : 'synced',
      lastSyncedAt: dependencies.now().toISOString(),
      message: hasProblems
        ? '일부 데이터는 다음 연결 시 다시 동기화합니다.'
        : '저장한 데이터가 서버에 확인되었습니다.',
    })
  }

  const coordinator: SyncCoordinator = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },
    run() {
      if (runningPromise !== null) {
        return runningPromise
      }

      runningPromise = runInternal()
        .catch(() => {
          publish({
            status: 'error',
            message: '동기화 처리 중 오류가 발생했습니다. 로컬 원본은 유지됩니다.',
          })
        })
        .finally(() => {
          runningPromise = null
          if (rerunRequested) {
            rerunRequested = false
            void coordinator.run('queued_trigger')
          }
        })
      return runningPromise
    },
    async notifyPointSaved(ownerUserId) {
      if (runningPromise !== null) {
        rerunRequested = true
      }
      const pendingPoints = (
        await dependencies.localRepository.listPendingSyncItems(ownerUserId)
      ).filter((item) => item.entityType === 'gps_point').length

      if (pendingPoints >= 20) {
        if (debounceTimer !== null) {
          dependencies.clearTimer(debounceTimer)
          debounceTimer = null
        }
        void coordinator.run('point_batch')
        return
      }

      if (debounceTimer !== null) {
        dependencies.clearTimer(debounceTimer)
      }
      debounceTimer = dependencies.setTimer(() => {
        debounceTimer = null
        void coordinator.run('point_debounce')
      }, 10_000)
    },
    notifyMeasurementStopped() {
      if (runningPromise !== null) {
        rerunRequested = true
      }
      void coordinator.run('measurement_stopped')
    },
    dispose() {
      if (debounceTimer !== null) {
        dependencies.clearTimer(debounceTimer)
      }
    },
  }

  return coordinator
}
