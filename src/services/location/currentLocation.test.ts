import { describe, expect, it, vi } from 'vitest'
import { getCurrentLocation } from './currentLocation'

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
