import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMeasurementManager } from '../../features/measurement/measurementManager'
import { createLocalMeasurementRepository } from '../../repositories/local/localMeasurementRepository'
import { createWalkLabDatabase, type WalkLabDatabase } from '../../repositories/local/walkLabDatabase'
import { createTransitAccessRecording } from './transitAccessRecording'
import type { TransitBoardingTarget } from './transitAccessArrival'

const databases: WalkLabDatabase[] = []
const user = { id: 'synthetic-owner', email: null }
const target: TransitBoardingTarget = {
  name: '검증된 테스트 정류장', coordinate: { latitude: 37, longitude: 127 },
  mode: 'BUS', source: 'seoul_bus_stop',
}

function setup() {
  const database = createWalkLabDatabase(`transit-recording-test-${crypto.randomUUID()}`)
  databases.push(database)
  const repository = createLocalMeasurementRepository(database)
  let now = Date.parse('2026-11-05T00:00:00Z')
  let callback: PositionCallback = () => undefined
  let onError: PositionErrorCallback = () => undefined
  const stopped = vi.fn()
  const onMeasurementStopped = vi.fn()
  const manager = createMeasurementManager({
    repository,
    createCollector: () => ({ start: (position, error) => { callback = position; onError = error }, stop: stopped, isRunning: () => true }),
    getOnline: () => true, getSecureContext: () => true, getSourcePlatform: () => 'web-browser',
    now: () => new Date(now), createId: () => crypto.randomUUID(), onMeasurementStopped,
  })
  const startMeasurement = vi.fn((mode?: 'manual' | 'navigation', details?: Record<string, string | number | boolean | null> | null) =>
    manager.start({ user, confirmCurrentUser: async () => user, mode, details }))
  const stopMeasurement = vi.fn(() => manager.stop())
  const controller = createTransitAccessRecording({
    measurement: { startMeasurement, stopMeasurement, getMeasurementState: manager.getState, subscribeGps: manager.subscribeGps },
    repository, now: () => now, createId: () => crypto.randomUUID(),
  })
  return {
    controller, manager, repository, startMeasurement, stopMeasurement, stopped, onMeasurementStopped,
    emit(offsetM = 0, accuracy = 5, duplicate = false) {
      if (!duplicate) now += 1_000
      callback({ timestamp: now, coords: {
        latitude: 37 + offsetM / 111_000, longitude: 127, accuracy,
        altitude: null, altitudeAccuracy: null, heading: null, speed: null,
      } } as GeolocationPosition)
    },
    error(code: number) { onError({ code, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }) },
    advance(ms: number) { now += ms },
  }
}

afterEach(async () => {
  for (const database of databases.splice(0)) { database.close(); await database.delete() }
})

describe('첫 승차 도보 기록과 기존 G2 IndexedDB 연결', () => {
  it('명시적 시작 한 번과 자동 종료 한 번으로 마지막 GPS 원본까지 저장한다', async () => {
    const test = setup()
    expect(test.startMeasurement).not.toHaveBeenCalled()
    await Promise.all([test.controller.start('route', target), test.controller.start('route', target)])
    expect(test.startMeasurement).toHaveBeenCalledTimes(1)
    test.emit(20); test.emit(19); test.emit(18)
    await vi.waitFor(() => expect(test.controller.getState().phase).toBe('saved'))
    await Promise.all([test.controller.finish('arrival'), test.controller.finish('manual')])
    expect(test.stopMeasurement).toHaveBeenCalledTimes(1)
    expect(test.onMeasurementStopped).toHaveBeenCalledTimes(1)
    const sessionId = test.controller.getState().sessionId!
    const points = await test.repository.listPoints(user.id, sessionId)
    expect(points.map((point) => point.sequenceNo)).toEqual([1, 2, 3])
    expect(points[2].latitude).toBe(37 + 18 / 111_000)
    expect((await test.repository.getSession(user.id, sessionId))?.status).toBe('completed')
    expect(await test.repository.getSession('another-owner', sessionId)).toBeUndefined()
    const events = await test.repository.listEvents(user.id, sessionId)
    expect(events.find((event) => event.eventType === 'measurement_start_requested')?.details).toMatchObject({
      guidanceId: test.controller.getState().guidanceId, transitRouteId: 'route', walkingScope: 'first_boarding_access',
    })
    expect(events.filter((event) => event.eventType === 'measurement_stopped')).toHaveLength(1)
    expect(test.controller.getState().serverSync).toBe('pending')
    const items = await test.repository.listSyncItems(user.id)
    expect(items.filter((item) => item.entityType === 'gps_point')).toHaveLength(3)
    await test.repository.setSyncItemsState(items.map((item) => item.key), 'confirmed')
    await test.controller.verifySaved()
    expect(test.controller.getState().serverSync).toBe('confirmed')
    test.emit(0)
    expect(await test.repository.listPoints(user.id, sessionId)).toHaveLength(3)
  })

  it('이미 다른 기록이 실행 중이면 시작·종료를 가로채지 않는다', async () => {
    const test = setup()
    await test.manager.start({ user, confirmCurrentUser: async () => user })
    const sessionId = test.manager.getState().sessionId
    await test.controller.start('route', target)
    await test.controller.finish('manual')
    expect(test.startMeasurement).not.toHaveBeenCalled()
    expect(test.stopMeasurement).not.toHaveBeenCalled()
    expect(test.manager.getState().sessionId).toBe(sessionId)
    await test.manager.stop()
  })

  it('범위 밖·정확도 부족·동일 관측에서는 종료하지 않고 수동 종료로 원본을 저장한다', async () => {
    const test = setup()
    await test.controller.start('route', target)
    test.emit(50); test.emit(50); test.emit(50)
    test.emit(0, 31); test.emit(0, 5); test.emit(0, 5, true); test.emit(0, 5, true)
    expect(test.stopMeasurement).not.toHaveBeenCalled()
    await test.controller.finish('manual')
    expect(test.controller.getState()).toMatchObject({ phase: 'saved', stopReason: 'manual', savedPointCount: 7 })
  })

  it('화면 숨김과 위치 단절 뒤에는 새 위치 세 개를 다시 확인한다', async () => {
    const test = setup()
    await test.controller.start('route', target)
    test.emit(); test.emit()
    test.controller.setVisible(false)
    test.emit(); test.emit(); test.emit()
    expect(test.stopMeasurement).not.toHaveBeenCalled()
    test.controller.setVisible(true)
    test.emit(); test.emit()
    test.advance(20_000); test.controller.tick()
    expect(test.controller.getState().gps).toBe('stale')
    test.emit(); test.emit()
    expect(test.stopMeasurement).not.toHaveBeenCalled()
    test.emit()
    await vi.waitFor(() => expect(test.controller.getState().phase).toBe('saved'))
  })

  it('좌표가 없으면 자동 도착 없이 수동 기록만 제공한다', async () => {
    const test = setup()
    await test.controller.start('route', null)
    test.emit(); test.emit(); test.emit()
    expect(test.stopMeasurement).not.toHaveBeenCalled()
    expect(test.controller.getState().distanceM).toBeNull()
    await test.controller.finish('manual')
    expect(test.controller.getState().phase).toBe('saved')
  })

  it('시작 도중 화면을 나가도 뒤늦게 시작된 자기 기록을 종료한다', async () => {
    const test = setup()
    let resume: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { resume = resolve })
    test.startMeasurement.mockImplementationOnce(async (mode, details) => {
      await gate
      return test.manager.start({ user, confirmCurrentUser: async () => user, mode, details })
    })
    const pending = test.controller.start('route', target)
    test.controller.dispose()
    resume()
    await pending
    await vi.waitFor(() => expect(test.manager.getState().status).toBe('completed'))
    expect(test.stopMeasurement).toHaveBeenCalledOnce()
  })

  it('종료 상태 저장 실패를 저장 완료로 표시하지 않고 원본을 유지한다', async () => {
    const test = setup()
    await test.controller.start('route', target)
    const original = test.repository.setSessionStatus
    vi.spyOn(test.repository, 'setSessionStatus').mockImplementation(async (...args) => {
      if (args[2] === 'completed') throw new Error('storage failed')
      return original(...args)
    })
    test.emit(); test.emit(); test.emit()
    await vi.waitFor(() => expect(test.controller.getState().phase).toBe('error'))
    expect(await test.repository.listPoints(user.id, test.controller.getState().sessionId!)).toHaveLength(3)
    expect(test.controller.getState().serverSync).toBe('pending')
  })

  it('권한 거부와 GPS 일시 오류를 도착으로 처리하지 않는다', async () => {
    const test = setup()
    await test.controller.start('route', target)
    test.emit(); test.error(3)
    expect(test.controller.getState().gps).toBe('error')
    expect(test.stopMeasurement).not.toHaveBeenCalled()
    test.error(1)
    await test.controller.finish('manual')
    expect(test.controller.getState().phase).toBe('error')
    expect(test.controller.getState().serverSync).toBe('pending')
  })
})
