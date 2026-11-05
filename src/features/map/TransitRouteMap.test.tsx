import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TransitItinerary } from '../../domain/transitRoute'
import type { KakaoMapsNamespace } from './kakaoMapSdk'
import { createTransitReferenceWalkOverlay } from '../../services/routing/kakaoTransitRouteAdapter'
import { transitReferenceWalkPresentation } from '../../domain/transitMap'

const { loadKakaoMapSdkMock } = vi.hoisted(() => ({
  loadKakaoMapSdkMock: vi.fn(),
}))

vi.mock('../../app/env', () => ({
  publicEnvironment: { kakaoMapJavaScriptKey: 'test-key' },
}))
vi.mock('./kakaoMapSdk', () => ({ loadKakaoMapSdk: loadKakaoMapSdkMock }))

import { TransitRouteMap } from './TransitRouteMap'

function createFakeMaps() {
  const polylineOptions: Array<{ strokeColor: string; strokeStyle?: string; path?: unknown[] }> = []
  const markerOptions: unknown[] = []
  const setPosition = vi.fn()
  const setCenter = vi.fn()
  class LatLng {}
  class LatLngBounds { extend = vi.fn() }
  class Map { addControl = vi.fn(); setBounds = vi.fn(); setCenter = setCenter }
  class Polyline {
    constructor(options: { strokeColor: string; strokeStyle?: string }) {
      polylineOptions.push(options)
    }
    setMap = vi.fn()
  }
  class Marker {
    constructor(options: unknown) { markerOptions.push(options) }
    setMap = vi.fn()
    setPosition = setPosition
  }
  class MarkerImage {}
  class Size {}
  class Point {}
  class ZoomControl {}
  const maps = {
    LatLng,
    LatLngBounds,
    Map,
    Polyline,
    Marker,
    MarkerImage,
    Size,
    Point,
    ZoomControl,
    ControlPosition: { RIGHT: 'right' },
  } as unknown as KakaoMapsNamespace
  return { maps, polylineOptions, markerOptions, setPosition, setCenter }
}

const itinerary: TransitItinerary = {
  id: 'route-1',
  totalDurationSeconds: 900,
  totalWalkDurationSeconds: 200,
  totalWalkDistanceM: 200,
  totalDistanceM: 4000,
  transferCount: 0,
  fareKrw: 1500,
  legs: [
    {
      mode: 'WALK', distanceM: 0, durationSeconds: 0,
      routeName: null, routeColor: null, startName: 'A', endName: 'A',
      coordinates: [{ latitude: 37.5, longitude: 127.1 }, { latitude: 37.5001, longitude: 127.1001 }],
    },
    {
      mode: 'WALK', distanceM: 200, durationSeconds: 200,
      routeName: null, routeColor: null, startName: 'A', endName: 'B',
      coordinates: [{ latitude: 37.5, longitude: 127.1 }, { latitude: 37.51, longitude: 127.11 }],
    },
    {
      mode: 'BUS', distanceM: 3800, durationSeconds: 700,
      routeName: '100', routeColor: '0068B7', startName: 'B', endName: 'C',
      coordinates: [{ latitude: 37.51, longitude: 127.11 }, { latitude: 37.6, longitude: 127.2 }],
    },
  ],
}

describe('TransitRouteMap', () => {
  it('스냅 불일치 G8 참고선은 실제 반환된 polyline만 별도 스타일로 그린다', async () => {
    const fake = createFakeMaps()
    loadKakaoMapSdkMock.mockResolvedValue(fake.maps)
    const start = { latitude: 37, longitude: 127 }
    const destination = { latitude: 37.01, longitude: 127.01 }
    const overlay = createTransitReferenceWalkOverlay({ id: 'snap', scope: 'egress', label: '참고 경로',
      walkingRoute: { distanceM: 245, providerDurationSeconds: 220,
        coordinates: [{ latitude: 37.001, longitude: 127 }, { latitude: 37.009, longitude: 127.01 }],
        requestedAt: '2026-01-01T00:00:00Z', provider: 'kakao-walking-route' },
      requestedStart: start, requestedDestination: destination, startGapM: 57.2, destinationGapM: 37.7,
    })
    if (overlay === null) throw new Error('fixture')
    render(<TransitRouteMap itinerary={itinerary} start={start} destination={destination} referenceWalks={[overlay]} />)
    await waitFor(() => expect(fake.polylineOptions).toHaveLength(3))
    expect(fake.polylineOptions.at(-1)).toMatchObject({ strokeColor: transitReferenceWalkPresentation.strokeColor,
      strokeStyle: transitReferenceWalkPresentation.strokeStyle })
    expect(fake.polylineOptions.at(-1)?.path).toHaveLength(2)
  })
  it('GPS 갱신은 현재 위치 마커만 이동시키고 전체 경로를 다시 만들지 않는다', async () => {
    const fake = createFakeMaps()
    loadKakaoMapSdkMock.mockResolvedValue(fake.maps)
    const start = { latitude: 37.5, longitude: 127.1 }
    const destination = { latitude: 37.6, longitude: 127.2 }
    const { rerender } = render(<TransitRouteMap itinerary={itinerary} start={start} destination={destination} />)
    await waitFor(() => expect(fake.markerOptions).toHaveLength(2))
    rerender(<TransitRouteMap itinerary={itinerary} start={start} destination={destination}
      currentPosition={{ latitude: 37.51, longitude: 127.11 }} />)
    await waitFor(() => expect(fake.markerOptions).toHaveLength(3))
    rerender(<TransitRouteMap itinerary={itinerary} start={start} destination={destination}
      currentPosition={{ latitude: 37.52, longitude: 127.12 }} />)
    expect(fake.setPosition).toHaveBeenCalledOnce()
    expect(fake.polylineOptions).toHaveLength(2)
    expect(fake.setCenter).toHaveBeenCalledOnce()
  })
  it('0초·0m leg는 제외하고 도보와 대중교통 leg를 각각 그린다', async () => {
    const fake = createFakeMaps()
    loadKakaoMapSdkMock.mockResolvedValue(fake.maps)
    render(
      <TransitRouteMap
        itinerary={itinerary}
        start={{ latitude: 37.5, longitude: 127.1 }}
        destination={{ latitude: 37.6, longitude: 127.2 }}
      />,
    )

    await waitFor(() => expect(fake.polylineOptions).toHaveLength(2))
    expect(fake.polylineOptions[0].strokeStyle).toBe('shortdash')
    expect(fake.polylineOptions[1].strokeColor).toBe('#0068B7')
    expect(fake.markerOptions).toHaveLength(2)
  })
})
