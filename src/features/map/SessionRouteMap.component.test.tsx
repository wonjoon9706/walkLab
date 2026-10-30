import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RawGpsPoint } from '../../domain/measurement'
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

import { SessionRouteMap } from './SessionRouteMap'

function point(sequenceNo: number, latitude: number, longitude: number): RawGpsPoint {
  const time = `2026-10-30T00:00:0${sequenceNo}.000Z`
  return {
    id: `point-${sequenceNo}`,
    sessionId: 'session-1',
    sequenceNo,
    measuredAt: time,
    receivedAt: time,
    latitude,
    longitude,
    accuracyM: 5,
    altitudeM: null,
    altitudeAccuracyM: null,
    deviceSpeedMps: null,
    headingDeg: null,
    schemaVersion: 1,
  }
}

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
  class LatLngBounds {
    extend = vi.fn()
  }
  class Map {
    addControl = vi.fn()
    setBounds = setBounds
  }
  class Polyline {
    constructor(options: unknown) {
      polylineOptions.push(options)
    }
    setMap(map: unknown) {
      removedOverlays.push(map)
    }
  }
  class Marker {
    constructor(options: unknown) {
      markerOptions.push(options)
    }
    setMap(map: unknown) {
      removedOverlays.push(map)
    }
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

afterEach(() => {
  loadKakaoMapSdkMock.mockReset()
})

describe('SessionRouteMap', () => {
  it('위도·경도 순서로 두 경로와 시작·종료 마커를 만들고 정리한다', async () => {
    const fake = createFakeMaps()
    loadKakaoMapSdkMock.mockResolvedValue(fake.maps)
    const points = [point(1, 37.5, 127.1), point(2, 37.51, 127.11)]

    const view = render(
      <SessionRouteMap rawPoints={points} filteredPoints={points} />,
    )

    await waitFor(() => expect(fake.markerOptions).toHaveLength(2))
    expect(fake.polylineOptions).toHaveLength(2)
    expect(fake.latLngArguments[0]).toEqual([37.5, 127.1])
    expect(fake.setBounds).toHaveBeenCalledOnce()

    view.unmount()
    expect(fake.removedOverlays).toEqual([null, null, null, null])
  })

  it('SDK 로딩 실패 안내를 표시한다', async () => {
    loadKakaoMapSdkMock.mockRejectedValue(new Error('KAKAO_MAP_SDK_LOAD_FAILED'))
    const points = [point(1, 37.5, 127.1)]

    render(<SessionRouteMap rawPoints={points} filteredPoints={points} />)

    expect(
      await screen.findByText(/카카오맵을 불러오지 못했습니다/),
    ).toBeInTheDocument()
  })
})
