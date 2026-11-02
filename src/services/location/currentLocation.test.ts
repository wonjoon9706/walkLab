import { describe, expect, it, vi } from 'vitest'
import { getCurrentLocation, getCurrentLocationFix } from './currentLocation'

describe('현재 위치 조회', () => {
  it('브라우저 좌표를 위도·경도 객체로 변환한다', async () => {
    const geolocation = {
      getCurrentPosition: vi.fn((success: PositionCallback) => {
        success({
          coords: { latitude: 37.5, longitude: 127.1 },
        } as GeolocationPosition)
      }),
    } as unknown as Geolocation

    await expect(getCurrentLocation(geolocation)).resolves.toEqual({
      latitude: 37.5,
      longitude: 127.1,
    })
  })

  it('지도 표시용 위치에는 브라우저가 제공한 정확도를 함께 보존한다', async () => {
    const geolocation = {
      getCurrentPosition: vi.fn((success: PositionCallback) => {
        success({
          coords: { latitude: 37.5, longitude: 127.1, accuracy: 18 },
        } as GeolocationPosition)
      }),
    } as unknown as Geolocation

    await expect(getCurrentLocationFix(geolocation)).resolves.toEqual({
      coordinate: { latitude: 37.5, longitude: 127.1 },
      accuracyM: 18,
    })
  })

  it('권한 거부를 별도 오류로 전달한다', async () => {
    const geolocation = {
      getCurrentPosition: vi.fn(
        (_success: PositionCallback, error: PositionErrorCallback) => {
          error({ code: 1 } as GeolocationPositionError)
        },
      ),
    } as unknown as Geolocation

    await expect(getCurrentLocation(geolocation)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    })
  })
})
