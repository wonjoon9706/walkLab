import { describe, expect, it, vi } from 'vitest'
import { createGpsCollector } from './gpsCollector'

describe('GpsCollector', () => {
  it('문서에 정한 옵션으로 하나의 watcher만 실행하고 종료한다', () => {
    const watchPosition = vi.fn().mockReturnValue(17)
    const clearWatch = vi.fn()
    const geolocation = { watchPosition, clearWatch } as unknown as Geolocation
    const collector = createGpsCollector(geolocation)
    const onPosition = vi.fn()
    const onError = vi.fn()

    expect(collector.isRunning()).toBe(false)
    collector.start(onPosition, onError)

    expect(watchPosition).toHaveBeenCalledWith(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15_000,
    })
    expect(collector.isRunning()).toBe(true)
    expect(() => collector.start(onPosition, onError)).toThrow(
      'GPS_WATCH_ALREADY_RUNNING',
    )

    collector.stop()
    collector.stop()
    expect(clearWatch).toHaveBeenCalledOnce()
    expect(clearWatch).toHaveBeenCalledWith(17)
    expect(collector.isRunning()).toBe(false)
  })
})
