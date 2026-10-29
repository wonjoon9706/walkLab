import Dexie, { type EntityTable } from 'dexie'
import type {
  DeletionCutoff,
  LocalMeta,
  LocalWalkSession,
  MeasurementEvent,
  PointQuality,
  RawGpsPoint,
  SessionMetrics,
  SyncItem,
} from '../../domain/measurement'

export interface WalkLabDatabase extends Dexie {
  meta: EntityTable<LocalMeta, 'key'>
  sessions: EntityTable<LocalWalkSession, 'id'>
  gpsPoints: EntityTable<RawGpsPoint, 'id'>
  measurementEvents: EntityTable<MeasurementEvent, 'id'>
  pointQuality: EntityTable<PointQuality, 'key'>
  sessionMetrics: EntityTable<SessionMetrics, 'key'>
  syncItems: EntityTable<SyncItem, 'key'>
  deletionCutoffs: EntityTable<DeletionCutoff, 'ownerUserId'>
}

export function createWalkLabDatabase(
  databaseName = 'walklab',
): WalkLabDatabase {
  const database = new Dexie(databaseName) as WalkLabDatabase

  database.version(1).stores({
    meta: '&key',
    sessions: '&id, ownerUserId, status, startedAt, [ownerUserId+startedAt]',
    gpsPoints: '&id, sessionId, [sessionId+sequenceNo]',
    measurementEvents: '&id, sessionId, eventType, occurredAt',
    pointQuality: '&key, sessionId, algorithmVersion',
    sessionMetrics: '&key, sessionId, algorithmVersion',
    syncItems: '&key, ownerUserId, state, sessionId, [ownerUserId+state]',
    deletionCutoffs: '&ownerUserId',
  })

  database.sessions.hook(
    'updating',
    (changes, _primaryKey, existingSession) => {
      if (
        'ownerUserId' in changes &&
        changes.ownerUserId !== existingSession.ownerUserId
      ) {
        throw new Error('LOCAL_SESSION_OWNER_IMMUTABLE')
      }
    },
  )

  return database
}

export const walkLabDatabase = createWalkLabDatabase()
