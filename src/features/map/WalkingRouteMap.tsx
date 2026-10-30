import { useEffect, useMemo, useRef, useState } from 'react'
import { publicEnvironment } from '../../app/env'
import type { GeoCoordinate } from '../../domain/walkingRoute'
import {
  loadKakaoMapSdk,
  type KakaoLatLng,
  type KakaoMapsNamespace,
} from './kakaoMapSdk'

interface WalkingRouteMapProps {
  coordinates: GeoCoordinate[]
  start: GeoCoordinate
  destination: GeoCoordinate
}

interface RemovableOverlay {
  setMap: (map: null) => void
}

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

export function WalkingRouteMap({
  coordinates,
  start,
  destination,
}: WalkingRouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const javaScriptKey = publicEnvironment.kakaoMapJavaScriptKey
  const stableCoordinates = useMemo(() => coordinates, [coordinates])

  useEffect(() => {
    const container = containerRef.current
    if (
      container === null ||
      javaScriptKey === null ||
      stableCoordinates.length < 2
    ) {
      return
    }

    let isDisposed = false
    const overlays: RemovableOverlay[] = []
    setMapError(null)

    void loadKakaoMapSdk(javaScriptKey)
      .then((maps) => {
        if (isDisposed) return

        const path = stableCoordinates.map((coordinate) =>
          toKakaoPosition(maps, coordinate),
        )
        const startPosition = toKakaoPosition(maps, start)
        const destinationPosition = toKakaoPosition(maps, destination)
        const map = new maps.Map(container, {
          center: startPosition,
          level: 4,
        })
        map.addControl(new maps.ZoomControl(), maps.ControlPosition.RIGHT)

        overlays.push(
          new maps.Polyline({
            map,
            path,
            strokeWeight: 6,
            strokeColor: '#176b87',
            strokeOpacity: 0.95,
          }) as RemovableOverlay,
          new maps.Marker({
            map,
            position: startPosition,
            image: createMarkerImage(maps, '#2a8c58', '도보 경로 출발지'),
          }) as RemovableOverlay,
          new maps.Marker({
            map,
            position: destinationPosition,
            image: createMarkerImage(maps, '#c54242', '도보 경로 목적지'),
          }) as RemovableOverlay,
        )

        const bounds = new maps.LatLngBounds()
        path.forEach((position) => bounds.extend(position))
        bounds.extend(startPosition)
        bounds.extend(destinationPosition)
        map.setBounds(bounds, 40, 40, 40, 40)
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
      overlays.forEach((overlay) => overlay.setMap(null))
      container.replaceChildren()
    }
  }, [destination, javaScriptKey, stableCoordinates, start])

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
      {mapError !== null && (
        <p className="auth-message error-message" role="alert">
          {mapError}
        </p>
      )}
      <p className="map-legend">
        <span className="filtered-route-key">카카오 도보 경로</span>
        <span className="start-point-key">출발지</span>
        <span className="end-point-key">목적지</span>
      </p>
    </>
  )
}
