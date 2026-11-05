import { describe, expect, it, vi } from 'vitest'
import { BusArrivalError, type BusArrivalRequest } from '../../domain/busArrival'
import { createBusArrivalClient } from './busArrivalClient'

const request: BusArrivalRequest = {
  routeName: '직행좌석:7800',
  routeId: 'PROVIDER-7800',

  boardingStop: {
    providerStopId: 'PROVIDER-A',
    name: '사당역9번출구앞',
    coordinate: { latitude: 37.478, longitude: 126.982 },
  },
  nextStop: null,
  alightingStop: {
    providerStopId: 'PROVIDER-B',
    name: '의왕톨게이트',
    coordinate: { latitude: 37.45, longitude: 126.982 },
  },
}

const result = {
  routeName: '직행좌석 7800',
  stopName: '사당역9번출구앞',
  stopId: 'TAGO-A',
  arrivalSeconds: 360,
  remainingStops: 3,
  fetchedAt: '2026-11-03T00:00:00.000Z',
  provider: 'tago',
  dataMode: 'live',
  status: 'available',
  walkingTimeToStopSeconds: null,
} as const

describe('TAGO 버스 도착정보 클라이언트', () => {
  it('로그인 토큰과 선택한 버스 구간만 서버에 전달한다', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify(result), { status: 200 }),
    ))
    const client = createBusArrivalClient({
      fetch: fetchMock,
      getAccessToken: vi.fn().mockResolvedValue('access-token'),
    })

    await expect(client.getBusArrival(request)).resolves.toEqual(result)
    expect(fetchMock).toHaveBeenCalledWith('/api/tago/bus-arrival', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer access-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    })
  })

  it('30초 이내 동일 정류장·노선 요청은 서버 호출을 재사용한다', async () => {
    let now = 1_000
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(result), { status: 200 }),
    )
    const client = createBusArrivalClient({
      fetch: fetchMock,
      getAccessToken: vi.fn().mockResolvedValue('access-token'),
      now: () => now,
    })

    await client.getBusArrival(request)
    now += 29_000
    await client.getBusArrival(request)

    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('승차 정류장이 같아도 하차 정류장이 다르면 캐시를 공유하지 않는다', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify(result), { status: 200 }),
    ))
    const client = createBusArrivalClient({
      fetch: fetchMock,
      getAccessToken: vi.fn().mockResolvedValue('access-token'),
      now: () => 1_000,
    })

    await client.getBusArrival(request)
    await client.getBusArrival({
      ...request,
      alightingStop: {
        ...request.alightingStop,
        coordinate: { latitude: 37.44, longitude: 126.982 },
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('로그인 세션이 없으면 서버를 호출하지 않는다', async () => {
    const fetchMock = vi.fn()
    const client = createBusArrivalClient({
      fetch: fetchMock,
      getAccessToken: vi.fn().mockResolvedValue(null),
    })

    await expect(client.getBusArrival(request)).rejects.toMatchObject<Partial<BusArrivalError>>({
      code: 'AUTH_SESSION_MISSING',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('서버 오류 코드와 깨진 정상 응답을 구분한다', async () => {
    const errorClient = createBusArrivalClient({
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        code: 'QUOTA_EXCEEDED',
        message: '한도 초과',
      }), { status: 429 })),
      getAccessToken: vi.fn().mockResolvedValue('access-token'),
    })
    await expect(errorClient.getBusArrival(request)).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      message: '한도 초과',
    })

    const invalidClient = createBusArrivalClient({
      fetch: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
      getAccessToken: vi.fn().mockResolvedValue('access-token'),
    })
    await expect(invalidClient.getBusArrival(request)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    })
  })
})
