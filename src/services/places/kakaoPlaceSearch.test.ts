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

  it('역 검색은 SW8 결과를 병합하고 정확한 역명을 우선하며 ID 중복을 제거한다', async () => {
    const calls: Array<{ category?: string }> = []
    class LatLng {}
    class Places {
      keywordSearch(
        _query: string,
        callback: (documents: Array<Record<string, string>>, status: string) => void,
        options?: { category_group_code?: string },
      ) {
        calls.push({ category: options?.category_group_code })
        const station = {
          id: 'station-1',
          place_name: '어린이대공원역 7호선',
          address_name: '서울 광진구 군자동',
          road_address_name: '서울 광진구 능동로 210',
          category_name: '교통,수송 > 지하철,전철 > 지하철역',
          category_group_code: 'SW8',
          x: '127.0867',
          y: '37.5479',
        }
        callback(
          options?.category_group_code === 'SW8'
            ? [station]
            : [
                {
                  id: 'park-1',
                  place_name: '서울어린이대공원',
                  address_name: '서울 광진구 능동',
                  road_address_name: '서울 광진구 능동로 216',
                  category_name: '여행 > 공원',
                  category_group_code: 'AT4',
                  x: '127.0812',
                  y: '37.5494',
                },
                station,
              ],
          'OK',
        )
      }
    }
    loadKakaoMapSdkMock.mockResolvedValue({
      LatLng,
      services: {
        Places,
        Status: { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT', ERROR: 'ERROR' },
        SortBy: { DISTANCE: 'DISTANCE' },
      },
    } as unknown as KakaoMapsNamespace)

    const results = await searchKakaoPlaces(
      '어린이대공원역',
      'javascript-key',
      { latitude: 37.5, longitude: 127.1 },
    )

    expect(calls).toEqual([{ category: undefined }, { category: 'SW8' }])
    expect(results.map((result) => result.id)).toEqual(['station-1', 'park-1'])
    expect(results[0].name).toBe('어린이대공원역 7호선')
  })

  it('일반 장소 검색은 SW8 추가 호출 없이 카카오 순서를 유지한다', async () => {
    const calls: Array<{ category?: string }> = []
    class LatLng {}
    class Places {
      keywordSearch(
        _query: string,
        callback: (documents: Array<Record<string, string>>, status: string) => void,
        options?: { category_group_code?: string },
      ) {
        calls.push({ category: options?.category_group_code })
        callback([
          {
            id: 'food-1',
            place_name: '맛있는식당',
            address_name: '서울 광진구',
            road_address_name: '',
            category_name: '음식점 > 한식',
            category_group_code: 'FD6',
            x: '127.1',
            y: '37.5',
          },
        ], 'OK')
      }
    }
    loadKakaoMapSdkMock.mockResolvedValue({
      LatLng,
      services: {
        Places,
        Status: { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT', ERROR: 'ERROR' },
        SortBy: { DISTANCE: 'DISTANCE' },
      },
    } as unknown as KakaoMapsNamespace)

    const results = await searchKakaoPlaces('맛있는식당', 'javascript-key', null)

    expect(calls).toEqual([{ category: undefined }])
    expect(results[0].id).toBe('food-1')
  })

  it('빈 검색 결과를 별도 오류로 전달한다', async () => {
    loadKakaoMapSdkMock.mockResolvedValue(createMaps('ZERO_RESULT'))

    await expect(
      searchKakaoPlaces('없는장소', 'javascript-key', null),
    ).rejects.toMatchObject({ code: 'NO_RESULTS' })
  })
})
