import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MeasurementContextValue } from '../measurement/measurementContext'
import { createMeasurementManager } from '../measurement/measurementManager'
import { createLocalMeasurementRepository } from '../../repositories/local/localMeasurementRepository'
import { createWalkLabDatabase } from '../../repositories/local/walkLabDatabase'
import { useTransitAccessRecording } from './useTransitAccessRecording'
import type { WalkingRoute } from '../../domain/walkingRoute'
import type { LocalMeasurementRepository } from '../../repositories/local/localMeasurementRepository'

const shared = vi.hoisted(() => ({ measurement: null as MeasurementContextValue | null, repository: null as LocalMeasurementRepository | null }))
vi.mock('../measurement/measurementContext', () => ({ useMeasurement: () => shared.measurement }))
vi.mock('../sync/syncContext', () => ({ useSync: () => ({ status: 'idle', lastSyncedAt: null }) }))
vi.mock('../../repositories/local/localMeasurementRepository', async (original) => ({
  ...await original<typeof import('../../repositories/local/localMeasurementRepository')>(),
  localMeasurementRepository: {
    getSession: (ownerId: string, sessionId: string) => shared.repository!.getSession(ownerId, sessionId),
    listPoints: (ownerId: string, sessionId: string) => shared.repository!.listPoints(ownerId, sessionId),
    listSyncItems: (ownerId: string) => shared.repository!.listSyncItems(ownerId),
  },
}))

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('첫 승차 기록과 실시간 페이스의 동일 GPS 연결', () => {
  it('시작 전 GPS 없음 → G2 watcher 하나로 페이스 계산 → 자동 종료 및 원본 저장', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-05T00:00:00Z'))
    vi.stubGlobal('isSecureContext', true)
    const database = createWalkLabDatabase(`live-pace-${crypto.randomUUID()}`)
    const repository = createLocalMeasurementRepository(database)
    shared.repository = repository
    let emit: PositionCallback = () => undefined
    const startGps = vi.fn((callback: PositionCallback) => { emit = callback })
    const stopGps = vi.fn()
    const user = { id: 'synthetic-owner', email: null }
    const manager = createMeasurementManager({
      repository, createCollector: () => ({ start: startGps, stop: stopGps, isRunning: () => true }),
      getOnline: () => true, getSecureContext: () => true, getSourcePlatform: () => 'web-browser',
      now: () => new Date(), createId: () => crypto.randomUUID(),
    })
    const startMeasurement: MeasurementContextValue['startMeasurement'] = vi.fn((mode, details) => manager.start({ user, confirmCurrentUser: async () => user, mode, details }))
    const stopMeasurement = vi.fn(() => manager.stop())
    shared.measurement = { ...manager.getState(), isActive: false, startMeasurement, stopMeasurement,
      getMeasurementState: manager.getState, subscribeGps: manager.subscribeGps }
    const walkingRoute: WalkingRoute = { distanceM: 111, providerDurationSeconds: 90,
      coordinates: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.001 }],
      provider: 'kakao-walking-route', requestedAt: new Date().toISOString() }
    const view = renderHook(() => useTransitAccessRecording())
    try {
      expect(startGps).not.toHaveBeenCalled()
      await act(async () => {
        await view.result.current.start('route', { name: '테스트 정류장', mode: 'BUS', source: 'seoul_bus_stop', coordinate: walkingRoute.coordinates[1] }, {
          route: walkingRoute, destination: walkingRoute.coordinates[1], forceInitialReroute: false, allowReroute: false,
          baselineSpeed: { speedMps: 1.4, source: 'personalized', modelVersion: 'recency-weighted-v1', validSessionCount: 3 },
        })
      })
      const send = async (longitude: number, seconds: number) => {
        vi.setSystemTime(new Date(Date.parse('2026-11-05T00:00:00Z') + seconds * 1000))
        await act(async () => {
          emit({ timestamp: Date.now(), coords: { latitude: 0, longitude, accuracy: 5,
            speed: 1, altitude: null, altitudeAccuracy: null, heading: null } } as GeolocationPosition)
        })
      }
      for (let i = 0; i < 10; i += 1) await send(i * 0.00002, i * 2)
      expect(view.result.current.navigation).toMatchObject({ status: 'moving', pace: 'slower', recentSpeedMps: 1, speedSource: 'recent_blended' })
      expect(startGps).toHaveBeenCalledOnce()
      // 실제 이동 가능한 간격의 GPS로 접근하여 기존 40m·3회 도착 조건을 충족한다.
      for (let i = 10; i < 40 && view.result.current.state.phase === 'recording'; i += 1) await send(i * 0.00002, i * 2)
      await waitFor(() => expect(view.result.current.state.phase).toBe('saved'))
      expect(view.result.current.navigation.isActive).toBe(false)
      expect(stopMeasurement).toHaveBeenCalledOnce()
      expect(stopGps).toHaveBeenCalledOnce()
      const points = await repository.listPoints(user.id, view.result.current.state.sessionId!)
      expect(points.length).toBeGreaterThan(30)
      expect(points.at(-1)?.longitude).toBeGreaterThan(0.00064)
      expect(view.result.current.state.serverSync).toBe('pending')
    } finally {
      view.unmount()
      database.close()
      await database.delete()
    }
  })
})
