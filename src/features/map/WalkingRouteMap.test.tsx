import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KakaoMapsNamespace } from './kakaoMapSdk'

const { loadKakaoMapSdkMock } = vi.hoisted(() => ({
  loadKakaoMapSdkMock: vi.fn(),
}))

vi.mock('../../app/env', () => ({
  publicEnvironment: { kakaoMapJavaScriptKey: 'test-javascript-key' },
}))

vi.mock('./kakaoMapSdk', () => ({
  loadKakaoMapSdk: loadKakaoMapSdkMock,
}))

import { WalkingRouteMap } from './WalkingRouteMap'

function createFakeMaps() {
  const latLngArguments: Array<[number, number]> = []
  const polylineOptions: unknown[] = []
  const markerOptions: unknown[] = []
  const removedOverlays: unknown[] = []
  const setBounds = vi.fn()

  class LatLng {
    constructor(latitude: number, longitude: number) {
      latLngArguments.push([latitude, longitude])
    }
    getLat() { return 0 }
    getLng() { return 0 }
  }
  class LatLngBounds { extend = vi.fn() }
  class Map { addControl = vi.fn(); setBounds = setBounds }
  class Polyline {
    constructor(options: unknown) { polylineOptions.push(options) }
    setMap(map: unknown) { removedOverlays.push(map) }
  }
  class Marker {
    constructor(options: unknown) { markerOptions.push(options) }
    setMap(map: unknown) { removedOverlays.push(map) }
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

  return {
    maps,
    latLngArguments,
    polylineOptions,
    markerOptions,
    removedOverlays,
    setBounds,
  }
}

afterEach(() => loadKakaoMapSdkMock.mockReset())

describe('WalkingRouteMap', () => {
  it('도보 경로와 출발·도착 마커를 표시하고 교체 시 정리한다', async () => {
    const fake = createFakeMaps()
    loadKakaoMapSdkMock.mockResolvedValue(fake.maps)
    const coordinates = [
      { latitude: 37.5, longitude: 127.1 },
      { latitude: 37.51, longitude: 127.11 },
    ]
    const view = render(
      <WalkingRouteMap
        coordinates={coordinates}
        start={coordinates[0]}
        destination={coordinates[1]}
      />,
    )

    await waitFor(() => expect(fake.markerOptions).toHaveLength(2))
    expect(fake.polylineOptions).toHaveLength(1)
    expect(fake.latLngArguments[0]).toEqual([37.5, 127.1])
    expect(fake.setBounds).toHaveBeenCalledOnce()
    expect(screen.getByText('출발지')).toBeInTheDocument()
    expect(screen.queryByText('현재 위치')).not.toBeInTheDocument()

    view.unmount()
    expect(fake.removedOverlays).toEqual([null, null, null])
  })

  it('SDK 로딩 실패를 안내한다', async () => {
    loadKakaoMapSdkMock.mockRejectedValue(new Error('load failed'))
    render(
      <WalkingRouteMap
        coordinates={[
          { latitude: 37.5, longitude: 127.1 },
          { latitude: 37.51, longitude: 127.11 },
        ]}
        start={{ latitude: 37.5, longitude: 127.1 }}
        destination={{ latitude: 37.51, longitude: 127.11 }}
      />,
    )

    expect(
      await screen.findByText(/카카오맵을 불러오지 못했습니다/),
    ).toBeInTheDocument()
  })
})
