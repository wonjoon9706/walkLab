import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  LocalWalkSession,
  MeasurementEvent,
  RawGpsPoint,
} from '../../domain/measurement'
import { supabaseClient } from './supabaseClient'

export type RemoteFailureKind =
  | 'transient'
  | 'auth'
  | 'forbidden'
  | 'validation'
  | 'deletion'

export interface RemoteFailure {
  kind: RemoteFailureKind
  code: string
}

export interface RemoteWriteResult {
  confirmedIds: string[]
  failure: RemoteFailure | null
}

export interface RemoteSyncRepository {
  getDeletionCutoff: (ownerUserId: string) => Promise<string | null>
  syncSession: (session: LocalWalkSession) => Promise<RemoteWriteResult>
  syncPoints: (
    ownerUserId: string,
    points: RawGpsPoint[],
  ) => Promise<RemoteWriteResult>
  syncEvents: (
    ownerUserId: string,
    events: MeasurementEvent[],
  ) => Promise<RemoteWriteResult>
}

interface ErrorShape {
  code?: string | number
  status?: string | number
  message?: string
}

function getErrorShape(error: unknown): ErrorShape {
  return typeof error === 'object' && error !== null
    ? (error as ErrorShape)
    : {}
}

export function toRemoteFailure(error: unknown): RemoteFailure {
  const shape = getErrorShape(error)
  const code = String(shape.code ?? shape.status ?? 'NETWORK_ERROR')
  const message = shape.message ?? ''

  if (message.includes('SESSION_SUPPRESSED_BY_DELETION')) {
    return { kind: 'deletion', code: 'SESSION_SUPPRESSED_BY_DELETION' }
  }

  if (code === '401' || code === 'PGRST301' || code === 'JWT_EXPIRED') {
    return { kind: 'auth', code }
  }

  if (code === '403' || code === '42501') {
    return { kind: 'forbidden', code }
  }

  if (
    code === '429' ||
    /^5\d\d$/.test(code) ||
    code === 'NETWORK_ERROR' ||
    error instanceof TypeError
  ) {
    return { kind: 'transient', code }
  }

  return { kind: 'validation', code }
}

function requireClient(client: SupabaseClient | null): SupabaseClient {
  if (client === null) {
    throw new Error('SUPABASE_NOT_CONFIGURED')
  }
  return client
}

function sameTimestamp(
  serverValue: string | null,
  localValue: string | null,
): boolean {
  if (serverValue === null || localValue === null) {
    return serverValue === localValue
  }
  return new Date(serverValue).getTime() === new Date(localValue).getTime()
}

export function toWalkSessionRow(session: LocalWalkSession) {
  return {
    id: session.id,
    user_id: session.ownerUserId,
    installation_id: session.installationId,
    status: session.status,
    started_at: session.startedAt,
    ended_at: session.endedAt,
    source_platform: session.sourcePlatform,
    app_version: session.appVersion,
    schema_version: session.schemaVersion,
  }
}

export function toGpsPointRow(ownerUserId: string, point: RawGpsPoint) {
  return {
    id: point.id,
    session_id: point.sessionId,
    user_id: ownerUserId,
    sequence_no: point.sequenceNo,
    measured_at: point.measuredAt,
    received_at: point.receivedAt,
    latitude: point.latitude,
    longitude: point.longitude,
    accuracy_m: point.accuracyM,
    altitude_m: point.altitudeM,
    altitude_accuracy_m: point.altitudeAccuracyM,
    device_speed_mps: point.deviceSpeedMps,
    heading_deg: point.headingDeg,
    schema_version: point.schemaVersion,
  }
}

export function toMeasurementEventRow(
  ownerUserId: string,
  event: MeasurementEvent,
) {
  return {
    id: event.id,
    session_id: event.sessionId,
    user_id: ownerUserId,
    event_type: event.eventType,
    occurred_at: event.occurredAt,
    received_at: event.receivedAt,
    error_code: event.errorCode,
    details: event.details,
    schema_version: event.schemaVersion,
  }
}

export function createRemoteSyncRepository(
  client: SupabaseClient | null,
): RemoteSyncRepository {
  return {
    async getDeletionCutoff(ownerUserId) {
      const configuredClient = requireClient(client)
      const { data, error } = await configuredClient
        .from('user_data_deletion_cutoffs')
        .select('reject_sessions_started_at_or_before')
        .eq('user_id', ownerUserId)
        .maybeSingle()

      if (error !== null) {
        throw toRemoteFailure(error)
      }

      return data?.reject_sessions_started_at_or_before ?? null
    },

    async syncSession(session) {
      const configuredClient = requireClient(client)
      const row = toWalkSessionRow(session)
      let failure: RemoteFailure | null = null
      try {
        const insertResult = await configuredClient
          .from('walk_sessions')
          .insert(row)

        if (insertResult.error !== null) {
          const insertFailure = toRemoteFailure(insertResult.error)

          if (insertFailure.code === '23505') {
            const updateResult = await configuredClient
              .from('walk_sessions')
              .update({
                status: row.status,
                ended_at: row.ended_at,
                updated_at: session.updatedAt,
              })
              .eq('id', row.id)
              .eq('user_id', row.user_id)

            if (updateResult.error !== null) {
              failure = toRemoteFailure(updateResult.error)
            }
          } else {
            failure = insertFailure
          }
        }
      } catch (error) {
        failure = toRemoteFailure(error)
      }

      const confirmation = await configuredClient
        .from('walk_sessions')
        .select('id,status,ended_at')
        .eq('id', row.id)
        .eq('user_id', row.user_id)
        .maybeSingle()

      if (confirmation.error !== null) {
        throw toRemoteFailure(confirmation.error)
      }

      const confirmed =
        confirmation.data?.id === row.id &&
        confirmation.data.status === row.status &&
        sameTimestamp(confirmation.data.ended_at, row.ended_at)

      return {
        confirmedIds: confirmed ? [row.id] : [],
        failure: confirmed ? null : failure ?? { kind: 'transient', code: 'NOT_CONFIRMED' },
      }
    },

    async syncPoints(ownerUserId, points) {
      const configuredClient = requireClient(client)
      const rows = points.map((point) => toGpsPointRow(ownerUserId, point))
      let failure: RemoteFailure | null = null
      try {
        const writeResult = await configuredClient
          .from('gps_points')
          .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })

        if (writeResult.error !== null) {
          failure = toRemoteFailure(writeResult.error)
        }
      } catch (error) {
        failure = toRemoteFailure(error)
      }

      const ids = rows.map((row) => row.id)
      const confirmation = await configuredClient
        .from('gps_points')
        .select('id')
        .eq('user_id', ownerUserId)
        .in('id', ids)

      if (confirmation.error !== null) {
        throw toRemoteFailure(confirmation.error)
      }

      const confirmedIds = (confirmation.data ?? []).map((row) => row.id)
      return {
        confirmedIds,
        failure:
          confirmedIds.length === ids.length
            ? null
            : failure ?? { kind: 'transient', code: 'NOT_CONFIRMED' },
      }
    },

    async syncEvents(ownerUserId, events) {
      const configuredClient = requireClient(client)
      const rows = events.map((event) =>
        toMeasurementEventRow(ownerUserId, event),
      )
      let failure: RemoteFailure | null = null
      try {
        const writeResult = await configuredClient
          .from('measurement_events')
          .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })

        if (writeResult.error !== null) {
          failure = toRemoteFailure(writeResult.error)
        }
      } catch (error) {
        failure = toRemoteFailure(error)
      }

      const ids = rows.map((row) => row.id)
      const confirmation = await configuredClient
        .from('measurement_events')
        .select('id')
        .eq('user_id', ownerUserId)
        .in('id', ids)

      if (confirmation.error !== null) {
        throw toRemoteFailure(confirmation.error)
      }

      const confirmedIds = (confirmation.data ?? []).map((row) => row.id)
      return {
        confirmedIds,
        failure:
          confirmedIds.length === ids.length
            ? null
            : failure ?? { kind: 'transient', code: 'NOT_CONFIRMED' },
      }
    },
  }
}

export const remoteSyncRepository = createRemoteSyncRepository(supabaseClient)
