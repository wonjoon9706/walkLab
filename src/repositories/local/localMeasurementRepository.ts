import type {
  LocalWalkSession,
  MeasurementEvent,
  MeasurementEventType,
  MeasurementStatus,
  RawGpsPoint,
  SyncEntityType,
  SyncItem,
} from '../../domain/measurement'
import {
  walkLabDatabase,
  type WalkLabDatabase,
} from './walkLabDatabase'

const APP_VERSION = '0.0.0'
const SCHEMA_VERSION = 1 as const
const INSTALLATION_ID_KEY = 'installation_id'

export interface CreateSessionInput {
  id: string
  ownerUserId: string
  startedAt: string
  sourcePlatform: string
  eventId: string
}

export interface SaveEventInput {
  id: string
  sessionId: string
  ownerUserId: string
  eventType: MeasurementEventType
  occurredAt: string
  receivedAt: string
  errorCode?: string | null
  details?: MeasurementEvent['details']
}

export interface LocalMeasurementRepository {
  createSession: (input: CreateSessionInput) => Promise<LocalWalkSession>
  setSessionStatus: (
    ownerUserId: string,
    sessionId: string,
    status: MeasurementStatus,
    endedAt?: string | null,
  ) => Promise<void>
  savePoint: (
    ownerUserId: string,
    point: RawGpsPoint,
    startedEvent?: MeasurementEvent,
  ) => Promise<void>
  saveEvent: (input: SaveEventInput) => Promise<void>
  recoverInterruptedSessions: (ownerUserId: string) => Promise<number>
  getSession: (
    ownerUserId: string,
    sessionId: string,
  ) => Promise<LocalWalkSession | undefined>
  listSessions: (ownerUserId: string) => Promise<LocalWalkSession[]>
  listPoints: (
    ownerUserId: string,
    sessionId: string,
  ) => Promise<RawGpsPoint[]>
  listEvents: (
    ownerUserId: string,
    sessionId: string,
  ) => Promise<MeasurementEvent[]>
}

function createSyncItem(
  ownerUserId: string,
  entityType: SyncEntityType,
  entityId: string,
  sessionId: string,
  now: string,
): SyncItem {
  return {
    key: `${entityType}:${entityId}`,
    ownerUserId,
    entityType,
    entityId,
    sessionId,
    state: 'pending',
    attemptCount: 0,
    nextRetryAt: null,
    lastErrorCode: null,
    serverConfirmedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

function createEvent(input: SaveEventInput): MeasurementEvent {
  return {
    id: input.id,
    sessionId: input.sessionId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt,
    errorCode: input.errorCode ?? null,
    details: input.details ?? null,
    schemaVersion: SCHEMA_VERSION,
  }
}

async function requireOwnedSession(
  database: WalkLabDatabase,
  ownerUserId: string,
  sessionId: string,
): Promise<LocalWalkSession> {
  const session = await database.sessions.get(sessionId)

  if (session === undefined || session.ownerUserId !== ownerUserId) {
    throw new Error('LOCAL_SESSION_OWNER_MISMATCH')
  }

  return session
}

async function getInstallationId(
  database: WalkLabDatabase,
): Promise<string> {
  const existing = await database.meta.get(INSTALLATION_ID_KEY)

  if (existing !== undefined) {
    return existing.value
  }

  const installationId = crypto.randomUUID()

  try {
    await database.meta.add({
      key: INSTALLATION_ID_KEY,
      value: installationId,
    })
    return installationId
  } catch {
    const concurrentlyCreated = await database.meta.get(INSTALLATION_ID_KEY)

    if (concurrentlyCreated === undefined) {
      throw new Error('INSTALLATION_ID_SAVE_FAILED')
    }

    return concurrentlyCreated.value
  }
}

export function createLocalMeasurementRepository(
  database: WalkLabDatabase,
): LocalMeasurementRepository {
  return {
    async createSession(input) {
      const installationId = await getInstallationId(database)
      const session: LocalWalkSession = {
        id: input.id,
        ownerUserId: input.ownerUserId,
        status: 'starting',
        startedAt: input.startedAt,
        endedAt: null,
        installationId,
        sourcePlatform: input.sourcePlatform,
        appVersion: APP_VERSION,
        schemaVersion: SCHEMA_VERSION,
        createdAt: input.startedAt,
        updatedAt: input.startedAt,
      }
      const event = createEvent({
        id: input.eventId,
        sessionId: input.id,
        ownerUserId: input.ownerUserId,
        eventType: 'measurement_start_requested',
        occurredAt: input.startedAt,
        receivedAt: input.startedAt,
      })

      // 세션, 시작 이벤트와 각각의 전송 대기 항목은 함께 저장되어야 한다.
      await database.transaction(
        'rw',
        database.sessions,
        database.measurementEvents,
        database.syncItems,
        async () => {
          await database.sessions.add(session)
          await database.measurementEvents.add(event)
          await database.syncItems.bulkAdd([
            createSyncItem(
              input.ownerUserId,
              'session',
              session.id,
              session.id,
              input.startedAt,
            ),
            createSyncItem(
              input.ownerUserId,
              'measurement_event',
              event.id,
              session.id,
              input.startedAt,
            ),
          ])
        },
      )

      return session
    },

    async setSessionStatus(ownerUserId, sessionId, status, endedAt = null) {
      const now = new Date().toISOString()

      await database.transaction(
        'rw',
        database.sessions,
        database.syncItems,
        async () => {
          await requireOwnedSession(database, ownerUserId, sessionId)
          await database.sessions.update(sessionId, {
            status,
            endedAt,
            updatedAt: now,
          })

          const syncKey = `session:${sessionId}`
          await database.syncItems.update(syncKey, {
            state: 'pending',
            updatedAt: now,
          })
        },
      )
    },

    async savePoint(ownerUserId, point, startedEvent) {
      await database.transaction(
        'rw',
        database.sessions,
        database.gpsPoints,
        database.measurementEvents,
        database.syncItems,
        async () => {
          await requireOwnedSession(database, ownerUserId, point.sessionId)
          // 원본은 add만 사용해 같은 ID를 덮어쓰지 않는다.
          await database.gpsPoints.add(point)
          await database.syncItems.add(
            createSyncItem(
              ownerUserId,
              'gps_point',
              point.id,
              point.sessionId,
              point.receivedAt,
            ),
          )

          if (startedEvent !== undefined) {
            await database.measurementEvents.add(startedEvent)
            await database.syncItems.add(
              createSyncItem(
                ownerUserId,
                'measurement_event',
                startedEvent.id,
                point.sessionId,
                startedEvent.receivedAt,
              ),
            )
          }
        },
      )
    },

    async saveEvent(input) {
      const event = createEvent(input)

      await database.transaction(
        'rw',
        database.sessions,
        database.measurementEvents,
        database.syncItems,
        async () => {
          await requireOwnedSession(
            database,
            input.ownerUserId,
            input.sessionId,
          )
          await database.measurementEvents.add(event)
          await database.syncItems.add(
            createSyncItem(
              input.ownerUserId,
              'measurement_event',
              event.id,
              event.sessionId,
              event.receivedAt,
            ),
          )
        },
      )
    },

    async recoverInterruptedSessions(ownerUserId) {
      const activeSessions = await database.sessions
        .where('ownerUserId')
        .equals(ownerUserId)
        .filter(
          (session) =>
            session.status === 'starting' || session.status === 'recording',
        )
        .toArray()

      for (const session of activeSessions) {
        const now = new Date().toISOString()
        await database.transaction(
          'rw',
          database.sessions,
          database.measurementEvents,
          database.syncItems,
          async () => {
            await requireOwnedSession(database, ownerUserId, session.id)
            const event = createEvent({
              id: crypto.randomUUID(),
              sessionId: session.id,
              ownerUserId,
              eventType: 'measurement_interrupted',
              occurredAt: now,
              receivedAt: now,
            })
            await database.sessions.update(session.id, {
              status: 'interrupted',
              updatedAt: now,
            })
            await database.measurementEvents.add(event)
            await database.syncItems.update(`session:${session.id}`, {
              state: 'pending',
              updatedAt: now,
            })
            await database.syncItems.add(
              createSyncItem(
                ownerUserId,
                'measurement_event',
                event.id,
                session.id,
                now,
              ),
            )
          },
        )
      }

      return activeSessions.length
    },

    async getSession(ownerUserId, sessionId) {
      const session = await database.sessions.get(sessionId)
      return session?.ownerUserId === ownerUserId ? session : undefined
    },

    async listSessions(ownerUserId) {
      return database.sessions
        .where('ownerUserId')
        .equals(ownerUserId)
        .reverse()
        .sortBy('startedAt')
    },

    async listPoints(ownerUserId, sessionId) {
      const session = await database.sessions.get(sessionId)

      if (session?.ownerUserId !== ownerUserId) {
        return []
      }

      return database.gpsPoints
        .where('sessionId')
        .equals(sessionId)
        .sortBy('sequenceNo')
    },

    async listEvents(ownerUserId, sessionId) {
      const session = await database.sessions.get(sessionId)

      if (session?.ownerUserId !== ownerUserId) {
        return []
      }

      return database.measurementEvents
        .where('sessionId')
        .equals(sessionId)
        .sortBy('occurredAt')
    },
  }
}

export const localMeasurementRepository = createLocalMeasurementRepository(
  walkLabDatabase,
)
