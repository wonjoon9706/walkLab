import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { createRemoteHistoryRepository } from './historyRepository'

function createPointRow(sequenceNo: number) {
  const measuredAt = new Date(Date.UTC(2026, 9, 30, 0, 0, sequenceNo)).toISOString()
  return {
    id: `point-${sequenceNo}`,
    session_id: 'session-1',
    sequence_no: sequenceNo,
    measured_at: measuredAt,
    received_at: measuredAt,
    latitude: 37.5,
    longitude: 127.1,
    accuracy_m: 5,
    altitude_m: null,
    altitude_accuracy_m: null,
    device_speed_mps: null,
    heading_deg: null,
    schema_version: 1,
  }
}

describe('RemoteHistoryRepository', () => {
  it('GPS 지점이 1000개를 넘으면 다음 페이지까지 조회한다', async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => createPointRow(index + 1))
    const requestedRanges: Array<[number, number]> = []
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      range: vi.fn(async (from: number, to: number) => {
        requestedRanges.push([from, to])
        return { data: rows.slice(from, to + 1), error: null }
      }),
    }
    const client = {
      from: vi.fn(() => query),
    } as unknown as SupabaseClient
    const repository = createRemoteHistoryRepository(client)

    const points = await repository.listSessionPoints('user-1', 'session-1')

    expect(requestedRanges).toEqual([
      [0, 999],
      [1000, 1999],
    ])
    expect(points).toHaveLength(1001)
    expect(points[0].sequenceNo).toBe(1)
    expect(points[1000].sequenceNo).toBe(1001)
  })
})
