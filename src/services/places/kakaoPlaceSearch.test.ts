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
    const calls: Array<{
      category?: string
      size?: number
      hasLocation: boolean
      sort?: unknown
    }> = []
    class LatLng {}
    class Places {
      keywordSearch(
        _query: string,
        callback: (documents: Array<Record<string, string>>, status: string) => void,
        options?: {
          category_group_code?: string
          size?: number
          location?: unknown
          sort?: unknown
        },
      ) {
        calls.push({
          category: options?.category_group_code,
          size: options?.size,
          hasLocation: options?.location !== undefined,
          sort: options?.sort,
        })
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

    expect(calls).toEqual([
      { category: undefined, size: 8, hasLocation: true, sort: 'DISTANCE' },
      { category: 'SW8', size: 15, hasLocation: false, sort: undefined },
    ])
    expect(results.map((result) => result.id)).toEqual(['station-1', 'park-1'])
    expect(results[0].name).toBe('어린이대공원역 7호선')
  })

  it('서울역 정확 일치 결과가 SW8 응답 뒤쪽에 있어도 상단에 보존한다', async () => {
    class LatLng {}
    class Places {
      keywordSearch(
        _query: string,
        callback: (documents: Array<Record<string, string>>, status: string) => void,
        options?: { category_group_code?: string; size?: number },
      ) {
        if (options?.category_group_code !== 'SW8') {
          callback(Array.from({ length: 8 }, (_, index) => ({
            id: `general-${index}`,
            place_name: `서울역 주변 장소 ${index}`,
            address_name: '서울 용산구',
            road_address_name: '',
            category_name: '생활서비스',
            category_group_code: '',
            x: `${126.96 + index / 1000}`,
            y: `${37.55 + index / 1000}`,
          })), 'OK')
          return
        }

        const subwayResults = Array.from({ length: 12 }, (_, index) => ({
          id: `station-${index}`,
          place_name: index === 11 ? '서울역 1호선' : `서울역 관련역 ${index}`,
          address_name: '서울 중구',
          road_address_name: '',
          category_name: '교통,수송 > 지하철,전철 > 지하철역',
          category_group_code: 'SW8',
          x: `${126.97 + index / 10000}`,
          y: `${37.55 + index / 10000}`,
        }))
        callback(subwayResults, 'OK')
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
      '서울역',
      'javascript-key',
      { latitude: 35.1, longitude: 129.0 },
    )

    expect(results).toHaveLength(8)
    expect(results[0].name).toBe('서울역 1호선')
  })

  it.each([
    ['서울역 KTX', '서울역'],
    ['용산역 KTX', '용산역'],
    ['부산역 KTX', '부산역'],
    ['동대구역 KTX', '동대구역'],
  ])('%s 원본에 의도한 역이 없을 때만 %s로 보강한다', async (query, baseQuery) => {
    const calls: Array<{
      query: string
      category?: string
      size?: number
      hasLocation: boolean
    }> = []
    class LatLng {}
    class Places {
      keywordSearch(
        nextQuery: string,
        callback: (documents: Array<Record<string, string>>, status: string) => void,
        options?: {
          category_group_code?: string
          size?: number
          location?: unknown
        },
      ) {
        calls.push({
          query: nextQuery,
          category: options?.category_group_code,
          size: options?.size,
          hasLocation: options?.location !== undefined,
        })
        if (nextQuery === query) {
          callback(options?.category_group_code === 'SW8' ? [] : [{
            id: 'unrelated-station',
            place_name: '청량리역',
            address_name: '서울 동대문구',
            road_address_name: '',
            category_name: '교통,수송 > 기차역',
            category_group_code: '',
            x: '127.047',
            y: '37.58',
          }], options?.category_group_code === 'SW8' ? 'ZERO_RESULT' : 'OK')
          return
        }
        callback([{
          id: options?.category_group_code === 'SW8' ? 'intended-subway' : 'intended-station',
          place_name: options?.category_group_code === 'SW8'
            ? `${baseQuery} 1호선`
            : baseQuery,
          address_name: '대한민국',
          road_address_name: '',
          category_name: '교통,수송 > 기차역',
          category_group_code: options?.category_group_code ?? '',
          x: '126.97',
          y: '37.55',
        }], 'OK')
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
      query,
      'javascript-key',
      { latitude: 37.5, longitude: 127.1 },
    )

    expect(results[0].name).toBe(baseQuery)
    expect(calls).toEqual([
      { query, category: undefined, size: 8, hasLocation: true },
      { query, category: 'SW8', size: 15, hasLocation: false },
      { query: baseQuery, category: undefined, size: 15, hasLocation: false },
      { query: baseQuery, category: 'SW8', size: 15, hasLocation: false },
    ])
  })

  it('원본 복합 검색에 의도한 역이 있으면 보강 호출을 하지 않는다', async () => {
    const calls: string[] = []
    class LatLng {}
    class Places {
      keywordSearch(
        query: string,
        callback: (documents: Array<Record<string, string>>, status: string) => void,
        options?: { category_group_code?: string },
      ) {
        calls.push(`${query}:${options?.category_group_code ?? 'general'}`)
        callback(options?.category_group_code === 'SW8' ? [] : [{
          id: 'yongsan-station',
          place_name: '용산역 KTX',
          address_name: '서울 용산구',
          road_address_name: '서울 용산구 한강대로23길 55',
          category_name: '교통,수송 > 기차역',
          category_group_code: '',
          x: '126.9648',
          y: '37.5298',
        }], options?.category_group_code === 'SW8' ? 'ZERO_RESULT' : 'OK')
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

    const results = await searchKakaoPlaces('용산역 KTX', 'javascript-key', null)

    expect(results[0].name).toBe('용산역 KTX')
    expect(calls).toEqual(['용산역 KTX:general', '용산역 KTX:SW8'])
  })

  it('역명으로 시작하지 않는 일반 KTX 장소명은 보강 검색하지 않는다', async () => {
    const calls: string[] = []
    class LatLng {}
    class Places {
      keywordSearch(
        query: string,
        callback: (documents: Array<Record<string, string>>, status: string) => void,
      ) {
        calls.push(query)
        callback([{
          id: 'building-1',
          place_name: 'KTX타워',
          address_name: '서울 중구',
          road_address_name: '',
          category_name: '부동산 > 빌딩',
          category_group_code: '',
          x: '126.97',
          y: '37.56',
        }], 'OK')
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

    await searchKakaoPlaces('KTX타워', 'javascript-key', null)

    expect(calls).toEqual(['KTX타워'])
  })

  it('강남역 2호선 원본 SW8 결과를 우선하고 보강 호출하지 않는다', async () => {
    const calls: string[] = []
    class LatLng {}
    class Places {
      keywordSearch(
        query: string,
        callback: (documents: Array<Record<string, string>>, status: string) => void,
        options?: { category_group_code?: string },
      ) {
        calls.push(`${query}:${options?.category_group_code ?? 'general'}`)
        callback(options?.category_group_code === 'SW8' ? [{
          id: 'gangnam-line-2',
          place_name: '강남역 2호선',
          address_name: '서울 강남구',
          road_address_name: '',
          category_name: '교통,수송 > 지하철,전철 > 지하철역',
          category_group_code: 'SW8',
          x: '127.0276',
          y: '37.4979',
        }] : [], options?.category_group_code === 'SW8' ? 'OK' : 'ZERO_RESULT')
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

    const results = await searchKakaoPlaces('강남역 2호선', 'javascript-key', null)

    expect(results[0].name).toBe('강남역 2호선')
    expect(calls).toEqual(['강남역 2호선:general', '강남역 2호선:SW8'])
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
