import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TransitItinerary } from '../../domain/transitRoute'
import type { KakaoMapsNamespace } from './kakaoMapSdk'

const { loadKakaoMapSdkMock } = vi.hoisted(() => ({
  loadKakaoMapSdkMock: vi.fn(),
}))

vi.mock('../../app/env', () => ({
  publicEnvironment: { kakaoMapJavaScriptKey: 'test-key' },
}))
vi.mock('./kakaoMapSdk', () => ({ loadKakaoMapSdk: loadKakaoMapSdkMock }))

import { TransitRouteMap } from './TransitRouteMap'

function createFakeMaps() {
  const polylineOptions: Array<{ strokeColor: string; strokeStyle?: string }> = []
  const markerOptions: unknown[] = []
  class LatLng {}
  class LatLngBounds { extend = vi.fn() }
  class Map { addControl = vi.fn(); setBounds = vi.fn() }
  class Polyline {
    constructor(options: { strokeColor: string; strokeStyle?: string }) {
      polylineOptions.push(options)
    }
    setMap = vi.fn()
  }
  class Marker {
    constructor(options: unknown) { markerOptions.push(options) }
    setMap = vi.fn()
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
  return { maps, polylineOptions, markerOptions }
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
      routeName: null, routeColor: null, routeType: null, startName: 'A', endName: 'A',
      coordinates: [{ latitude: 37.5, longitude: 127.1 }, { latitude: 37.5001, longitude: 127.1001 }],
    },
    {
      mode: 'WALK', distanceM: 200, durationSeconds: 200,
      routeName: null, routeColor: null, routeType: null, startName: 'A', endName: 'B',
      coordinates: [{ latitude: 37.5, longitude: 127.1 }, { latitude: 37.51, longitude: 127.11 }],
    },
    {
      mode: 'BUS', distanceM: 3800, durationSeconds: 700,
      routeName: '100', routeColor: '0068B7', routeType: 11, startName: 'B', endName: 'C',
      coordinates: [{ latitude: 37.51, longitude: 127.11 }, { latitude: 37.6, longitude: 127.2 }],
    },
  ],
}

describe('TransitRouteMap', () => {
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
