import type {
  PointQualityResult,
  WalkHistoryItem,
  WalkMetricsResult,
} from '../../domain/history'
import type { LocalWalkSession, RawGpsPoint } from '../../domain/measurement'
import { supabaseClient } from './supabaseClient'
import type { SupabaseClient } from '@supabase/supabase-js'

const PAGE_SIZE = 1000

export interface RemoteHistoryRepository {
  listCompletedSessions: (ownerUserId: string) => Promise<WalkHistoryItem[]>
  getCompletedSession: (
    ownerUserId: string,
    sessionId: string,
  ) => Promise<LocalWalkSession | null>
  listSessionPoints: (
    ownerUserId: string,
    sessionId: string,
  ) => Promise<RawGpsPoint[]>
  saveAnalysis: (
    ownerUserId: string,
    quality: PointQualityResult[],
    metrics: WalkMetricsResult,
  ) => Promise<void>
}

interface SessionRow {
  id: string
  user_id: string
  installation_id: string
  status: LocalWalkSession['status']
  started_at: string
  ended_at: string | null
  source_platform: string
  app_version: string
  schema_version: 1
  created_at: string
  updated_at: string
}

interface PointRow {
  id: string
  session_id: string
  sequence_no: number
  measured_at: string
  received_at: string
  latitude: number
  longitude: number
  accuracy_m: number
  altitude_m: number | null
  altitude_accuracy_m: number | null
  device_speed_mps: number | null
  heading_deg: number | null
  schema_version: 1
}

function requireClient(client: SupabaseClient | null): SupabaseClient {
  if (client === null) {
    throw new Error('SUPABASE_NOT_CONFIGURED')
  }
  return client
}

function toLocalSession(row: SessionRow): LocalWalkSession {
  return {
    id: row.id,
    ownerUserId: row.user_id,
    installationId: row.installation_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    sourcePlatform: row.source_platform,
    appVersion: row.app_version,
    schemaVersion: row.schema_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toRawPoint(row: PointRow): RawGpsPoint {
  return {
    id: row.id,
    sessionId: row.session_id,
    sequenceNo: row.sequence_no,
    measuredAt: row.measured_at,
    receivedAt: row.received_at,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyM: row.accuracy_m,
    altitudeM: row.altitude_m,
    altitudeAccuracyM: row.altitude_accuracy_m,
    deviceSpeedMps: row.device_speed_mps,
    headingDeg: row.heading_deg,
    schemaVersion: row.schema_version,
  }
}

function calculateDurationSeconds(startedAt: string, endedAt: string): number {
  return Math.max(0, (Date.parse(endedAt) - Date.parse(startedAt)) / 1000)
}

export function createRemoteHistoryRepository(
  client: SupabaseClient | null,
): RemoteHistoryRepository {
  return {
    async listCompletedSessions(ownerUserId) {
      const configuredClient = requireClient(client)
      const { data, error } = await configuredClient
        .from('walk_sessions')
        .select(
          'id,user_id,installation_id,status,started_at,ended_at,source_platform,app_version,schema_version,created_at,updated_at',
        )
        .eq('user_id', ownerUserId)
        .eq('status', 'completed')
        .not('ended_at', 'is', null)
        .order('started_at', { ascending: false })

      if (error !== null) {
        throw new Error('HISTORY_SESSION_QUERY_FAILED')
      }

      const rows = (data ?? []) as SessionRow[]
      return Promise.all(
        rows.map(async (row) => {
          const pointCountResult = await configuredClient
            .from('gps_points')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', ownerUserId)
            .eq('session_id', row.id)

          if (pointCountResult.error !== null) {
            throw new Error('HISTORY_POINT_COUNT_FAILED')
          }

          return {
            id: row.id,
            startedAt: row.started_at,
            endedAt: row.ended_at as string,
            durationSeconds: calculateDurationSeconds(
              row.started_at,
              row.ended_at as string,
            ),
            pointCount: pointCountResult.count ?? 0,
            source: 'server' as const,
          }
        }),
      )
    },

    async getCompletedSession(ownerUserId, sessionId) {
      const configuredClient = requireClient(client)
      const { data, error } = await configuredClient
        .from('walk_sessions')
        .select(
          'id,user_id,installation_id,status,started_at,ended_at,source_platform,app_version,schema_version,created_at,updated_at',
        )
        .eq('id', sessionId)
        .eq('user_id', ownerUserId)
        .eq('status', 'completed')
        .maybeSingle()

      if (error !== null) {
        throw new Error('HISTORY_SESSION_DETAIL_FAILED')
      }
      return data === null ? null : toLocalSession(data as SessionRow)
    },

    async listSessionPoints(ownerUserId, sessionId) {
      const configuredClient = requireClient(client)
      const points: RawGpsPoint[] = []
      let from = 0

      while (true) {
        const { data, error } = await configuredClient
          .from('gps_points')
          .select(
            'id,session_id,sequence_no,measured_at,received_at,latitude,longitude,accuracy_m,altitude_m,altitude_accuracy_m,device_speed_mps,heading_deg,schema_version',
          )
          .eq('user_id', ownerUserId)
          .eq('session_id', sessionId)
          .order('sequence_no', { ascending: true })
          .order('measured_at', { ascending: true })
          .range(from, from + PAGE_SIZE - 1)

        if (error !== null) {
          throw new Error('HISTORY_POINTS_QUERY_FAILED')
        }

        const page = (data ?? []) as PointRow[]
        points.push(...page.map(toRawPoint))
        if (page.length < PAGE_SIZE) {
          break
        }
        from += PAGE_SIZE
      }

      return points
    },

    async saveAnalysis(ownerUserId, quality, metrics) {
      const configuredClient = requireClient(client)

      for (let index = 0; index < quality.length; index += 500) {
        const batch = quality.slice(index, index + 500).map((result) => ({
          point_id: result.pointId,
          session_id: result.sessionId,
          user_id: ownerUserId,
          algorithm_version: result.algorithmVersion,
          status: result.status,
          reasons: result.reasons,
          included_in_filtered_path: result.includedInFilteredPath,
          evaluated_at: result.evaluatedAt,
        }))
        const qualityResult = await configuredClient
          .from('point_quality')
          .upsert(batch, {
            onConflict: 'point_id,algorithm_version',
            ignoreDuplicates: true,
          })

        if (qualityResult.error !== null) {
          throw new Error('POINT_QUALITY_SAVE_FAILED')
        }
      }

      const metricsResult = await configuredClient
        .from('session_metrics')
        .upsert(
          {
            session_id: metrics.sessionId,
            user_id: ownerUserId,
            algorithm_version: metrics.algorithmVersion,
            quality_algorithm_version: metrics.qualityAlgorithmVersion,
            duration_s: metrics.durationSeconds,
            raw_distance_m: metrics.rawDistanceM,
            filtered_distance_m: metrics.filteredDistanceM,
            average_speed_mps: metrics.averageSpeedMps,
            pace_seconds_per_km: metrics.paceSecondsPerKm,
            altitude_min_m: metrics.altitudeMinM,
            altitude_max_m: metrics.altitudeMaxM,
            altitude_sample_count: metrics.altitudeSampleCount,
            raw_point_count: metrics.rawPointCount,
            filtered_point_count: metrics.filteredPointCount,
            calculated_at: metrics.calculatedAt,
          },
          {
            onConflict: 'session_id,algorithm_version',
            ignoreDuplicates: true,
          },
        )

      if (metricsResult.error !== null) {
        throw new Error('SESSION_METRICS_SAVE_FAILED')
      }
    },
  }
}

export const remoteHistoryRepository = createRemoteHistoryRepository(
  supabaseClient,
)
