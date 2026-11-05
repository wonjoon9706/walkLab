import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  const setCenter = vi.fn()
  const setDraggable = vi.fn()
  const circleOptions: unknown[] = []
  let markerDragEndHandler: (() => void) | null = null
  const draggableMarkers: Marker[] = []
  const addListener = vi.fn(
    (_target, eventName: string, handler) => {
      if (eventName === 'dragend') markerDragEndHandler = handler
    },
  )
  const removeListener = vi.fn()

  class LatLng {
    latitude: number
    longitude: number

    constructor(latitude: number, longitude: number) {
      this.latitude = latitude
      this.longitude = longitude
      latLngArguments.push([latitude, longitude])
    }
    getLat() { return this.latitude }
    getLng() { return this.longitude }
  }
  class LatLngBounds { extend = vi.fn() }
  class Map {
    addControl = vi.fn()
    setBounds = setBounds
    setCenter = setCenter
    setDraggable = setDraggable
    getProjection() {
      return {
        coordsFromContainerPoint: (point: Point) =>
          new LatLng(37.5 + point.y / 100_000, 127.1 + point.x / 100_000),
      }
    }
  }
  class Polyline {
    constructor(options: unknown) { polylineOptions.push(options) }
    setMap(map: unknown) { removedOverlays.push(map) }
  }
  class Marker {
    position: LatLng

    constructor(options: { position: LatLng; draggable?: boolean }) {
      this.position = options.position
      markerOptions.push(options)
      if (options.draggable) draggableMarkers.push(this)
    }
    setMap(map: unknown) { removedOverlays.push(map) }
    setPosition(position: LatLng) { this.position = position }
    getPosition() { return this.position }
  }
  class Circle {
    constructor(options: unknown) { circleOptions.push(options) }
    setMap(map: unknown) { removedOverlays.push(map) }
  }
  class MarkerImage {}
  class Size {}
  class Point {
    constructor(public x: number, public y: number) {}
  }
  class ZoomControl {}

  const maps = {
    LatLng,
    LatLngBounds,
    Map,
    Polyline,
    Marker,
    Circle,
    MarkerImage,
    Size,
    Point,
    ZoomControl,
    ControlPosition: { RIGHT: 'right' },
    event: { addListener, removeListener },
  } as unknown as KakaoMapsNamespace

  return {
    maps,
    latLngArguments,
    polylineOptions,
    markerOptions,
    removedOverlays,
    setBounds,
    setCenter,
    setDraggable,
    circleOptions,
    addListener,
    removeListener,
    dragDraftMarker(latitude: number, longitude: number) {
      draggableMarkers.at(-1)?.setPosition(new LatLng(latitude, longitude))
      markerDragEndHandler?.()
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
  loadKakaoMapSdkMock.mockReset()
})

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

  it('주 도보 경로와 참고 경로를 서로 다른 선으로 함께 표시한다', async () => {
    const fake = createFakeMaps()
    loadKakaoMapSdkMock.mockResolvedValue(fake.maps)
    const kakaoCoordinates = [
      { latitude: 37.5, longitude: 127.1 },
      { latitude: 37.501, longitude: 127.101 },
    ]
    const comparisonCoordinates = [
      { latitude: 37.5, longitude: 127.1 },
      { latitude: 37.502, longitude: 127.102 },
    ]
    render(
      <WalkingRouteMap
        coordinates={kakaoCoordinates}
        comparisonCoordinates={comparisonCoordinates}
        start={kakaoCoordinates[0]}
        destination={kakaoCoordinates[1]}
      />,
    )

    await waitFor(() => expect(fake.polylineOptions).toHaveLength(2))
    expect(fake.polylineOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ strokeColor: '#176b87' }),
      expect.objectContaining({ strokeColor: '#d97706' }),
    ]))
    expect(screen.getByText('카카오 도보 경로')).toBeInTheDocument()
    expect(screen.getByText('참고 도보 경로')).toBeInTheDocument()
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

  it('안내 중 현재 위치와 남은 경로를 추가로 표시한다', async () => {
    const fake = createFakeMaps()
    loadKakaoMapSdkMock.mockResolvedValue(fake.maps)
    const coordinates = [
      { latitude: 37.5, longitude: 127.1 },
      { latitude: 37.51, longitude: 127.11 },
      { latitude: 37.52, longitude: 127.12 },
    ]

    render(
      <WalkingRouteMap
        coordinates={coordinates}
        start={coordinates[0]}
        destination={coordinates[2]}
        currentPosition={{ latitude: 37.505, longitude: 127.105 }}
        remainingCoordinates={[coordinates[1], coordinates[2]]}
      />,
    )

    await waitFor(() => expect(fake.markerOptions).toHaveLength(3))
    expect(fake.polylineOptions).toHaveLength(2)
    expect(screen.getByText('현재 위치')).toBeInTheDocument()
  })

  it('경로가 없어도 현재 위치와 정확도 범위를 표시하고 중심을 이동한다', async () => {
    const fake = createFakeMaps()
    loadKakaoMapSdkMock.mockResolvedValue(fake.maps)
    const currentPosition = { latitude: 37.5, longitude: 127.1 }

    render(
      <WalkingRouteMap
        start={currentPosition}
        currentPosition={currentPosition}
        currentAccuracyM={18}
      />,
    )

    await waitFor(() => expect(fake.markerOptions).toHaveLength(2))
    expect(fake.circleOptions).toHaveLength(1)
    screen.getByRole('button', { name: '현재 위치로 이동' }).click()
    expect(fake.setCenter).toHaveBeenCalledOnce()
    expect(screen.getByText('현재 위치')).toBeInTheDocument()
    expect(screen.queryByText('카카오 도보 경로')).toBeNull()
  })

  it('경로 없이 출발지와 목적지만으로 마커 범위를 맞춘다', async () => {
    const fake = createFakeMaps()
    loadKakaoMapSdkMock.mockResolvedValue(fake.maps)

    render(
      <WalkingRouteMap
        start={{ latitude: 37.5, longitude: 127.1 }}
        destination={{ latitude: 37.51, longitude: 127.11 }}
      />,
    )

    await waitFor(() => expect(fake.markerOptions).toHaveLength(2))
    expect(fake.polylineOptions).toHaveLength(0)
    expect(fake.setBounds).toHaveBeenCalledOnce()
  })

  it('출발지가 없어도 목적지 마커를 중심으로 위치를 미리 본다', async () => {
    const fake = createFakeMaps()
    loadKakaoMapSdkMock.mockResolvedValue(fake.maps)

    render(
      <WalkingRouteMap
        start={null}
        destination={{ latitude: 37.51, longitude: 127.11 }}
      />,
    )

    await waitFor(() => expect(fake.markerOptions).toHaveLength(1))
    expect(screen.queryByText('출발지')).toBeNull()
    expect(screen.getByText('목적지')).toBeInTheDocument()
  })

  it('짧은 터치는 출발지를 만들지 않고 500ms 길게 누른 뒤 확정한다', async () => {
    const fake = createFakeMaps()
    loadKakaoMapSdkMock.mockResolvedValue(fake.maps)
    const onSelectStart = vi.fn()
    const onCancelStartSelection = vi.fn()
    const view = render(
      <WalkingRouteMap
        start={{ latitude: 37.5, longitude: 127.1 }}
        isStartSelectionEnabled
        onSelectStart={onSelectStart}
        onCancelStartSelection={onCancelStartSelection}
      />,
    )

    await waitFor(() => expect(fake.markerOptions).toHaveLength(1))
    const map = screen.getByLabelText('출발지에서 목적지까지의 도보 경로 지도')
    vi.useFakeTimers()

    fireEvent.pointerDown(map, {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 100,
      clientY: 200,
    })
    act(() => vi.advanceTimersByTime(499))
    expect(screen.queryByRole('button', { name: '출발지 설정' })).toBeNull()

    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'touch' })
    act(() => vi.advanceTimersByTime(1))
    expect(screen.queryByRole('button', { name: '출발지 설정' })).toBeNull()

    fireEvent.pointerDown(map, {
      pointerId: 2,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 100,
      clientY: 200,
    })
    act(() => vi.advanceTimersByTime(500))

    expect(fake.setDraggable).toHaveBeenCalledWith(false)
    expect(fake.markerOptions).toHaveLength(2)
    expect(onSelectStart).not.toHaveBeenCalled()
    fireEvent.pointerMove(map, {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 120,
      clientY: 210,
    })
    fireEvent.click(screen.getByRole('button', { name: '출발지 설정' }))

    const selectedCoordinate = onSelectStart.mock.calls[0][0]
    expect(selectedCoordinate.latitude).toBeCloseTo(37.5021)
    expect(selectedCoordinate.longitude).toBeCloseTo(127.1012)
    fireEvent.pointerUp(window, { pointerId: 2, pointerType: 'touch' })
    expect(fake.setDraggable).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(onCancelStartSelection).toHaveBeenCalledOnce()

    view.unmount()
    expect(fake.removeListener).toHaveBeenCalledWith(
      expect.anything(),
      'dragend',
      expect.any(Function),
    )
  })

  it('길게 누르기 전 10px 넘게 움직이면 일반 지도 이동으로 유지한다', async () => {
    const fake = createFakeMaps()
    loadKakaoMapSdkMock.mockResolvedValue(fake.maps)
    render(
      <WalkingRouteMap
        start={{ latitude: 37.5, longitude: 127.1 }}
        isStartSelectionEnabled
        onSelectStart={vi.fn()}
      />,
    )
    await waitFor(() => expect(fake.markerOptions).toHaveLength(1))
    const map = screen.getByLabelText('출발지에서 목적지까지의 도보 경로 지도')
    vi.useFakeTimers()

    fireEvent.pointerDown(map, {
      pointerId: 3,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 20,
      clientY: 20,
    })
    fireEvent.pointerMove(map, {
      pointerId: 3,
      pointerType: 'touch',
      clientX: 40,
      clientY: 20,
    })
    act(() => vi.advanceTimersByTime(500))

    expect(fake.markerOptions).toHaveLength(1)
    expect(fake.setDraggable).not.toHaveBeenCalledWith(false)
    expect(screen.queryByRole('button', { name: '출발지 설정' })).toBeNull()
  })

  it('임시 마커를 드래그한 마지막 좌표만 확정한다', async () => {
    const fake = createFakeMaps()
    loadKakaoMapSdkMock.mockResolvedValue(fake.maps)
    const onSelectStart = vi.fn()
    render(
      <WalkingRouteMap
        start={{ latitude: 37.5, longitude: 127.1 }}
        isStartSelectionEnabled
        onSelectStart={onSelectStart}
      />,
    )
    await waitFor(() => expect(fake.markerOptions).toHaveLength(1))
    const map = screen.getByLabelText('출발지에서 목적지까지의 도보 경로 지도')
    vi.useFakeTimers()
    fireEvent.pointerDown(map, {
      pointerId: 4,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      clientX: 50,
      clientY: 50,
    })
    act(() => vi.advanceTimersByTime(500))
    fireEvent.pointerUp(window, { pointerId: 4, pointerType: 'mouse' })

    act(() => fake.dragDraftMarker(37.551, 126.991))
    fireEvent.click(screen.getByRole('button', { name: '출발지 설정' }))
    expect(onSelectStart).toHaveBeenCalledWith({
      latitude: 37.551,
      longitude: 126.991,
    })
  })
})
