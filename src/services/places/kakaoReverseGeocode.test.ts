import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loadKakaoMapSdkMock, coord2AddressMock } = vi.hoisted(() => ({
  loadKakaoMapSdkMock: vi.fn(),
  coord2AddressMock: vi.fn(),
}))

vi.mock('../../features/map/kakaoMapSdk', () => ({
  loadKakaoMapSdk: loadKakaoMapSdkMock,
}))

import { reverseGeocodeKakaoCoordinate } from './kakaoReverseGeocode'

beforeEach(() => {
  coord2AddressMock.mockReset()
  loadKakaoMapSdkMock.mockResolvedValue({
    services: {
      Geocoder: class Geocoder {
        coord2Address = coord2AddressMock
      },
      Status: { OK: 'OK' },
    },
  })
})

describe('reverseGeocodeKakaoCoordinate', () => {
  it('경도·위도 순서로 조회하고 도로명주소와 지번주소를 보존한다', async () => {
    coord2AddressMock.mockImplementation((_x, _y, callback) => {
      callback([{
        road_address: { address_name: '서울 용산구 한강대로 405' },
        address: { address_name: '서울 용산구 동자동 43-205' },
      }], 'OK')
    })

    await expect(reverseGeocodeKakaoCoordinate(
      { latitude: 37.5547, longitude: 126.9707 },
      'test-key',
    )).resolves.toEqual({
      roadAddress: '서울 용산구 한강대로 405',
      address: '서울 용산구 동자동 43-205',
    })
    expect(coord2AddressMock).toHaveBeenCalledWith(
      126.9707,
      37.5547,
      expect.any(Function),
    )
  })

  it('도로명주소가 없으면 지번주소만 반환한다', async () => {
    coord2AddressMock.mockImplementation((_x, _y, callback) => {
      callback([{
        road_address: null,
        address: { address_name: '서울 광진구 화양동 1' },
      }], 'OK')
    })

    await expect(reverseGeocodeKakaoCoordinate(
      { latitude: 37.5, longitude: 127.1 },
      'test-key',
    )).resolves.toEqual({
      roadAddress: null,
      address: '서울 광진구 화양동 1',
    })
  })

  it('주소 결과가 없으면 실패로 처리한다', async () => {
    coord2AddressMock.mockImplementation((_x, _y, callback) => {
      callback([], 'ZERO_RESULT')
    })

    await expect(reverseGeocodeKakaoCoordinate(
      { latitude: 37.5, longitude: 127.1 },
      'test-key',
    )).rejects.toThrow('KAKAO_REVERSE_GEOCODE_FAILED')
  })
})
