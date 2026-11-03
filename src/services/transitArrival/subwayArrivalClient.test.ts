import { describe, expect, it, vi } from 'vitest'
import type { SubwayArrivalRequest } from '../../domain/subwayArrival'
import { createSubwayArrivalClient } from './subwayArrivalClient'

const request: SubwayArrivalRequest = {
  routeName: '2호선', routeType: 2, trainType: 'normal',
  boardingStation: { tmapStationId: 'A', name: '건대입구' },
  nextStation: { tmapStationId: 'B', name: '구의' },
  alightingStation: { tmapStationId: 'C', name: '잠실' },
}

const result = {
  lineName: '2호선', stationName: '건대입구', status: 'available',
  estimates: [{
    order: 1,
    rawArrivalSeconds: 110,
    dataAgeSeconds: 0,
    arrivalSeconds: 110,
    direction: '내선',
    destination: '성수',
    trainType: 'normal',
    statusCode: '99',
    statusMessage: '2분 후',
    generatedAt: '1970-01-01T00:00:01.000Z',
  }],
  fetchedAt: '1970-01-01T00:00:01.000Z',
  provider: 'seoul-subway', dataMode: 'live',
} as const

describe('서울시 지하철 도착정보 클라이언트', () => {
  it('JWT와 선택한 지하철 구간만 서버에 전달한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(result), { status: 200 }),
    )
    const client = createSubwayArrivalClient({
      fetch: fetchMock,
      getAccessToken: vi.fn().mockResolvedValue('access-token'),
      now: () => 1_000,
    })

    await expect(client.getSubwayArrival(request)).resolves.toMatchObject({
      estimates: [{ arrivalSeconds: 110 }],
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/subway/arrival', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer access-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    })
  })

  it('30초 안의 동일 역·노선·방향 요청을 재사용한다', async () => {
    let now = 1_000
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(result), { status: 200 }),
    )
    const client = createSubwayArrivalClient({
      fetch: fetchMock,
      getAccessToken: vi.fn().mockResolvedValue('access-token'),
      now: () => now,
    })

    await client.getSubwayArrival(request)
    now += 29_000
    await expect(client.getSubwayArrival(request)).resolves.toMatchObject({
      estimates: [{
        rawArrivalSeconds: 110,
        dataAgeSeconds: 29,
        arrivalSeconds: 81,
      }],
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
