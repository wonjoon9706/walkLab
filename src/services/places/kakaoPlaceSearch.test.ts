import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KakaoMapsNamespace } from '../../features/map/kakaoMapSdk'

const { loadKakaoMapSdkMock } = vi.hoisted(() => ({
  loadKakaoMapSdkMock: vi.fn(),
}))

vi.mock('../../features/map/kakaoMapSdk', () => ({
  loadKakaoMapSdk: loadKakaoMapSdkMock,
}))

import { searchKakaoPlaces } from './kakaoPlaceSearch'

function createMaps(status: 'OK' | 'ZERO_RESULT' | 'ERROR') {
  class LatLng {}
  class Places {
    keywordSearch(
      _query: string,
      callback: (documents: unknown[], resultStatus: string) => void,
    ) {
      callback(
        status === 'OK'
          ? [{
              id: 'place-1',
              place_name: '서울역',
              address_name: '서울 용산구 동자동 43-205',
              road_address_name: '서울 용산구 한강대로 405',
              x: '126.9707',
              y: '37.5547',
            }]
          : [],
        status,
      )
    }
  }
  return {
    LatLng,
    services: {
      Places,
      Status: { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT', ERROR: 'ERROR' },
      SortBy: { DISTANCE: 'DISTANCE' },
    },
  } as unknown as KakaoMapsNamespace
}

afterEach(() => loadKakaoMapSdkMock.mockReset())

describe('카카오 장소 검색', () => {
  it('장소명·주소와 x 경도, y 위도를 변환한다', async () => {
    loadKakaoMapSdkMock.mockResolvedValue(createMaps('OK'))

    await expect(
      searchKakaoPlaces(
        '서울역',
        'javascript-key',
        { latitude: 37.5, longitude: 127.1 },
      ),
    ).resolves.toEqual([
      {
        id: 'place-1',
        name: '서울역',
        address: '서울 용산구 동자동 43-205',
        roadAddress: '서울 용산구 한강대로 405',
        coordinate: { longitude: 126.9707, latitude: 37.5547 },
      },
    ])
  })

  it('빈 검색 결과를 별도 오류로 전달한다', async () => {
    loadKakaoMapSdkMock.mockResolvedValue(createMaps('ZERO_RESULT'))

    await expect(
      searchKakaoPlaces('없는장소', 'javascript-key', null),
    ).rejects.toMatchObject({ code: 'NO_RESULTS' })
  })
})
