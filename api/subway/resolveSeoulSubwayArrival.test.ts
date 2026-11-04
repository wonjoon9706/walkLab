import { describe, expect, it } from 'vitest'
import type { SeoulSubwayArrivalRecord } from '../../src/domain/seoulSubway'
import type { SubwayArrivalRequest } from '../../src/domain/subwayArrival'
import { resolveSeoulSubwayArrival } from './resolveSeoulSubwayArrival'

const now = new Date('2026-11-03T03:01:00.000Z')

function request(routeType = 2, nextStation = '구의'): SubwayArrivalRequest {
  return {
    routeName: `${routeType}호선`,
    routeType,
    trainType: 'normal',
    boardingStation: { providerStationId: 'TMAP-A', name: '건대입구역' },
    nextStation: { providerStationId: 'TMAP-B', name: nextStation },
    alightingStation: { providerStationId: 'TMAP-C', name: '잠실' },
  }
}

function record(overrides: Partial<SeoulSubwayArrivalRecord> = {}): SeoulSubwayArrivalRecord {
  return {
    subwayId: '1002', stationName: '건대입구', upDownLine: '내선',
    trainLineName: '성수행 - 구의방면', trainStatus: '일반',
    arrivalSeconds: 110, generatedAt: '2026-11-03T03:00:00.000Z',
    arrivalStatusCode: '99', arrivalMessage: '2분 후',
    ...overrides,
  }
}

async function resolve(
  records: SeoulSubwayArrivalRecord[],
  nextRequest = request(),
) {
  return resolveSeoulSubwayArrival(
    nextRequest,
    { getArrivals: async () => records },
    new AbortController().signal,
    now,
  )
}

describe('서울시 지하철 경로 매칭', () => {
  it('지원하지 않는 노선과 정상 데이터 없음 상태를 구분한다', async () => {
    expect((await resolve([], request())).status).toBe('no_arrival_data')
    expect((await resolve([], request(999))).status).toBe('unsupported_station')
  })

  it('건대입구 2호선의 같은 방향 첫 번째·두 번째 열차만 정렬한다', async () => {
    const result = await resolve([
      record({ arrivalSeconds: 300, arrivalMessage: '5분 후' }),
      record({ subwayId: '1007', arrivalSeconds: 10 }),
      record({ trainLineName: '성수행 - 성수방면', arrivalSeconds: 20 }),
      record({ arrivalSeconds: 110 }),
    ])

    expect(result.status).toBe('available')
    expect(result.estimates.map((item) => item.arrivalSeconds)).toEqual([50, 240])
    expect(result.estimates.map((item) => item.rawArrivalSeconds)).toEqual([110, 300])
  })

  it('같은 다음 역으로 진행하는 석남행·온수행을 최대 네 건까지 유지한다', async () => {
    const result = await resolve([
      record({ trainLineName: '석남행 - 구의방면', arrivalSeconds: 480 }),
      record({ trainLineName: '온수행 - 구의방면', arrivalSeconds: 600 }),
      record({ trainLineName: '석남행 - 구의방면', arrivalSeconds: 1_080 }),
      record({ trainLineName: '온수행 - 구의방면', arrivalSeconds: 1_200 }),
      record({ trainLineName: '도봉산행 - 성수방면', arrivalSeconds: 100 }),
    ])

    expect(result.estimates.map((item) => item.destination)).toEqual([
      '석남', '온수', '석남', '온수',
    ])
    expect(result.estimates).toHaveLength(4)
  })

  it('건대입구 7호선은 2호선을 제외하고 다음 역으로 방향을 확인한다', async () => {
    const result = await resolve([
      record(),
      record({
        subwayId: '1007', upDownLine: '상행',
        trainLineName: '장암행 - 어린이대공원방면', arrivalSeconds: 140,
      }),
    ], request(7, '어린이대공원'))

    expect(result.status).toBe('available')
    expect(result.estimates).toHaveLength(1)
    expect(result.estimates[0]).toMatchObject({ arrivalSeconds: 80, direction: '상행' })
  })

  it('남성에서 건대입구 방향은 총신대입구(이수) 별칭을 확인하고 반대 방향을 제외한다', async () => {
    const namseongRequest: SubwayArrivalRequest = {
      routeName: '7호선',
      routeType: 7,
      trainType: 'normal',
      boardingStation: { providerStationId: 'TMAP-NAMSEONG', name: '남성역' },
      nextStation: { providerStationId: 'TMAP-ISU', name: '이수' },
      alightingStation: { providerStationId: 'TMAP-KONKUK', name: '건대입구역' },
    }
    const result = await resolve([
      record({
        subwayId: '1007', stationName: '남성', upDownLine: '상행',
        trainLineName: '도봉산행 - 총신대입구(이수)방면',
      }),
      record({
        subwayId: '1007', stationName: '남성', upDownLine: '하행',
        trainLineName: '석남행 - 숭실대입구(살피재)방면',
        arrivalSeconds: 20,
      }),
    ], namseongRequest)

    expect(result.status).toBe('available')
    expect(result.estimates).toHaveLength(1)
    expect(result.estimates[0]).toMatchObject({
      direction: '상행',
      destination: '도봉산',
    })
  })

  it('카카오 7호선 요청은 TMAP routeType 없이 노선명과 이수→내방 방향을 검증한다', async () => {
    const kakaoRequest: SubwayArrivalRequest = {
      routeName: '7호선',
      routeType: null,
      trainType: 'normal',
      boardingStation: { providerStationId: null, name: '이수' },
      nextStation: { providerStationId: null, name: '내방' },
      alightingStation: { providerStationId: null, name: '건대입구' },
    }
    const result = await resolve([
      record({
        subwayId: '1007', stationName: '총신대입구(이수)', upDownLine: '상행',
        trainLineName: '장암행 - 내방방면', arrivalSeconds: 180,
      }),
      record({
        subwayId: '1007', stationName: '총신대입구(이수)', upDownLine: '하행',
        trainLineName: '석남행 - 남성방면', arrivalSeconds: 30,
      }),
    ], kakaoRequest)

    expect(result.status).toBe('available')
    expect(result.estimates).toHaveLength(1)
    expect(result.estimates[0]).toMatchObject({
      direction: '상행',
      destination: '장암',
    })
  })

  it('반대 방향과 확인할 수 없는 열차 유형은 임의 매칭하지 않는다', async () => {
    expect((await resolve([
      record({ trainLineName: '성수행 - 성수방면' }),
    ])).status).toBe('review_required')
    expect((await resolve([
      record({ trainStatus: null }),
    ])).status).toBe('review_required')
  })

  it('일반·급행을 구분하고 역명 불일치를 실패로 반환한다', async () => {
    const expressRequest = { ...request(), trainType: 'express' as const }
    expect((await resolve([
      record({ trainStatus: '일반' }),
      record({ trainStatus: '급행', arrivalSeconds: 80 }),
    ], expressRequest)).estimates[0]?.arrivalSeconds).toBe(20)
    expect((await resolve([
      record({ stationName: '건대' }),
    ])).status).toBe('station_match_failed')
  })
})
