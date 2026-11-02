import { useEffect, useMemo, useRef, useState } from 'react'
import { publicEnvironment } from '../../app/env'
import type { GeoCoordinate } from '../../domain/walkingRoute'
import {
  loadKakaoMapSdk,
  type KakaoLatLng,
  type KakaoMapInstance,
  type KakaoMapOverlay,
  type KakaoMapsNamespace,
} from './kakaoMapSdk'

interface WalkingRouteMapProps {
  coordinates?: GeoCoordinate[]
  start: GeoCoordinate
  destination?: GeoCoordinate | null
  currentPosition?: GeoCoordinate | null
  currentAccuracyM?: number | null
  remainingCoordinates?: GeoCoordinate[]
}

interface MapRuntime {
  map: KakaoMapInstance
  maps: KakaoMapsNamespace
}

const EMPTY_COORDINATES: GeoCoordinate[] = []

function toKakaoPosition(
  maps: KakaoMapsNamespace,
  coordinate: GeoCoordinate,
): KakaoLatLng {
  return new maps.LatLng(coordinate.latitude, coordinate.longitude)
}

function createMarkerImage(
  maps: KakaoMapsNamespace,
  color: string,
  alt: string,
) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40"><path fill="${color}" stroke="white" stroke-width="2" d="M14 1C6.8 1 1 6.8 1 14c0 9.8 13 25 13 25s13-15.2 13-25C27 6.8 21.2 1 14 1z"/><circle cx="14" cy="14" r="5" fill="white"/></svg>`
  const source = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
  return new maps.MarkerImage(source, new maps.Size(28, 40), {
    offset: new maps.Point(14, 40),
    alt,
  })
}

function createCurrentLocationImage(maps: KakaoMapsNamespace) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="white" fill-opacity="0.95"/><circle cx="12" cy="12" r="7" fill="#2563eb"/></svg>'
  const source = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
  return new maps.MarkerImage(source, new maps.Size(24, 24), {
    offset: new maps.Point(12, 12),
    alt: '현재 GPS 위치',
  })
}

export function WalkingRouteMap({
  coordinates = EMPTY_COORDINATES,
  start,
  destination = null,
  currentPosition = null,
  currentAccuracyM = null,
  remainingCoordinates,
}: WalkingRouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<MapRuntime | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapReadyVersion, setMapReadyVersion] = useState(0)
  const javaScriptKey = publicEnvironment.kakaoMapJavaScriptKey
  const stableCoordinates = useMemo(() => coordinates, [coordinates])
  const stableRemainingCoordinates = useMemo(
    () => remainingCoordinates,
    [remainingCoordinates],
  )
  const isLiveMode = remainingCoordinates !== undefined

  useEffect(() => {
    const container = containerRef.current
    if (
      container === null ||
      javaScriptKey === null
    ) {
      return
    }

    let isDisposed = false
    const overlays: KakaoMapOverlay[] = []
    setMapError(null)

    void loadKakaoMapSdk(javaScriptKey)
      .then((maps) => {
        if (isDisposed) return

        const path = stableCoordinates.map((coordinate) =>
          toKakaoPosition(maps, coordinate),
        )
        const initialCenter = toKakaoPosition(
          maps,
          start,
        )
        const map = new maps.Map(container, {
          center: initialCenter,
          level: 4,
        })
        map.addControl(new maps.ZoomControl(), maps.ControlPosition.RIGHT)

        if (path.length >= 2) {
          overlays.push(new maps.Polyline({
            map,
            path,
            strokeWeight: 6,
            strokeColor:
              isLiveMode ? '#9aa7ad' : '#176b87',
            strokeOpacity:
              isLiveMode ? 0.55 : 0.95,
          }))
        }
        overlays.push(new maps.Marker({
            map,
            position: toKakaoPosition(maps, start),
            image: createMarkerImage(maps, '#2a8c58', '도보 경로 출발지'),
          }))
        if (destination !== null) {
          overlays.push(new maps.Marker({
            map,
            position: toKakaoPosition(maps, destination),
            image: createMarkerImage(maps, '#c54242', '도보 경로 목적지'),
          }))
        }

        if (path.length >= 2 && destination !== null) {
          const bounds = new maps.LatLngBounds()
          path.forEach((position) => bounds.extend(position))
          bounds.extend(toKakaoPosition(maps, start))
          bounds.extend(toKakaoPosition(maps, destination))
          map.setBounds(bounds, 40, 40, 40, 40)
        }
        runtimeRef.current = { map, maps }
        setMapReadyVersion((version) => version + 1)
      })
      .catch(() => {
        if (!isDisposed) {
          setMapError(
            '카카오맵을 불러오지 못했습니다. 도메인 설정과 네트워크를 확인해 주세요.',
          )
        }
      })

    return () => {
      isDisposed = true
      runtimeRef.current = null
      overlays.forEach((overlay) => overlay.setMap(null))
      container.replaceChildren()
    }
  }, [
    destination,
    isLiveMode,
    javaScriptKey,
    stableCoordinates,
    start,
  ])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (runtime === null || !isLiveMode) return

    const liveOverlays: KakaoMapOverlay[] = []
    if (
      stableRemainingCoordinates !== undefined &&
      stableRemainingCoordinates.length >= 2
    ) {
      liveOverlays.push(
        new runtime.maps.Polyline({
          map: runtime.map,
          path: stableRemainingCoordinates.map((coordinate) =>
            toKakaoPosition(runtime.maps, coordinate),
          ),
          strokeWeight: 7,
          strokeColor: '#176b87',
          strokeOpacity: 0.95,
        }),
      )
    }
    return () => liveOverlays.forEach((overlay) => overlay.setMap(null))
  }, [
    isLiveMode,
    mapReadyVersion,
    stableRemainingCoordinates,
  ])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (runtime === null || currentPosition === null) return

    const position = toKakaoPosition(runtime.maps, currentPosition)
    const currentOverlays: KakaoMapOverlay[] = [
      new runtime.maps.Marker({
        map: runtime.map,
        position,
        image: createCurrentLocationImage(runtime.maps),
      }),
    ]
    if (currentAccuracyM !== null && currentAccuracyM > 0) {
      currentOverlays.unshift(
        new runtime.maps.Circle({
          map: runtime.map,
          center: position,
          radius: currentAccuracyM,
          strokeWeight: 1,
          strokeColor: '#2563eb',
          strokeOpacity: 0.45,
          fillColor: '#60a5fa',
          fillOpacity: 0.12,
        }),
      )
    }

    return () => currentOverlays.forEach((overlay) => overlay.setMap(null))
  }, [currentAccuracyM, currentPosition, mapReadyVersion])

  if (javaScriptKey === null) {
    return (
      <p className="auth-message error-message">
        카카오맵 환경변수가 설정되지 않았습니다.
      </p>
    )
  }

  return (
    <>
      <div
        ref={containerRef}
        className="route-map"
        aria-label="출발지에서 목적지까지의 도보 경로 지도"
      />
      {currentPosition !== null && (
        <button
          type="button"
          className="map-location-button secondary-button"
          onClick={() => {
            const runtime = runtimeRef.current
            if (runtime !== null) {
              runtime.map.setCenter(
                toKakaoPosition(runtime.maps, currentPosition),
              )
            }
          }}
        >
          현재 위치로 이동
        </button>
      )}
      {mapError !== null && (
        <p className="auth-message error-message" role="alert">
          {mapError}
        </p>
      )}
      <p className="map-legend">
        {stableCoordinates.length >= 2 && (
          <span className="filtered-route-key">카카오 도보 경로</span>
        )}
        <span className="start-point-key">출발지</span>
        {destination !== null && <span className="end-point-key">목적지</span>}
        {currentPosition !== null && (
          <span className="current-position-key">현재 위치</span>
        )}
      </p>
    </>
  )
}
