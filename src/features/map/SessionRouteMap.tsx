import { useEffect, useMemo, useRef, useState } from 'react'
import type { RawGpsPoint } from '../../domain/measurement'
import { publicEnvironment } from '../../app/env'
import {
  loadKakaoMapSdk,
  type KakaoLatLng,
  type KakaoMapsNamespace,
} from './kakaoMapSdk'
import {
  getRouteCoordinates,
  type RouteCoordinate,
} from './routeCoordinates'

interface SessionRouteMapProps {
  rawPoints: RawGpsPoint[]
  filteredPoints: RawGpsPoint[]
}

interface RemovableOverlay {
  setMap: (map: null) => void
}

function toKakaoPath(
  maps: KakaoMapsNamespace,
  coordinates: RouteCoordinate[],
): KakaoLatLng[] {
  return coordinates.map(
    (coordinate) =>
      new maps.LatLng(coordinate.latitude, coordinate.longitude),
  )
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

export function SessionRouteMap({
  rawPoints,
  filteredPoints,
}: SessionRouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const javaScriptKey = publicEnvironment.kakaoMapJavaScriptKey
  const rawCoordinates = useMemo(
    () => getRouteCoordinates(rawPoints),
    [rawPoints],
  )
  const filteredCoordinates = useMemo(
    () => getRouteCoordinates(filteredPoints),
    [filteredPoints],
  )

  useEffect(() => {
    const container = containerRef.current
    if (
      container === null ||
      javaScriptKey === null ||
      rawCoordinates.length === 0
    ) {
      return
    }

    let isDisposed = false
    const overlays: RemovableOverlay[] = []

    void loadKakaoMapSdk(javaScriptKey)
      .then((maps) => {
        if (isDisposed) return

        const rawPath = toKakaoPath(maps, rawCoordinates)
        const filteredPath = toKakaoPath(maps, filteredCoordinates)
        const map = new maps.Map(container, {
          center: rawPath[0],
          level: 4,
        })
        map.addControl(
          new maps.ZoomControl(),
          maps.ControlPosition.RIGHT,
        )

        if (rawPath.length >= 2) {
          overlays.push(
            new maps.Polyline({
              map,
              path: rawPath,
              strokeWeight: 5,
              strokeColor: '#87958f',
              strokeOpacity: 0.65,
              strokeStyle: 'shortdash',
            }) as RemovableOverlay,
          )
        }
        if (filteredPath.length >= 2) {
          overlays.push(
            new maps.Polyline({
              map,
              path: filteredPath,
              strokeWeight: 5,
              strokeColor: '#176b87',
              strokeOpacity: 1,
            }) as RemovableOverlay,
          )
        }

        overlays.push(
          new maps.Marker({
            map,
            position: rawPath[0],
            image: createMarkerImage(maps, '#2a8c58', '보행 시작점'),
          }) as RemovableOverlay,
          new maps.Marker({
            map,
            position: rawPath[rawPath.length - 1],
            image: createMarkerImage(maps, '#c54242', '보행 종료점'),
          }) as RemovableOverlay,
        )

        if (rawPath.length > 1) {
          const bounds = new maps.LatLngBounds()
          rawPath.forEach((position) => bounds.extend(position))
          map.setBounds(bounds, 40, 40, 40, 40)
        }
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
  }, [filteredCoordinates, javaScriptKey, rawCoordinates])

  if (javaScriptKey === null) {
    return (
      <p className="auth-message error-message">
        카카오맵 환경변수가 설정되지 않았습니다.
      </p>
    )
  }
  if (rawCoordinates.length === 0) {
    return <p className="page-description">지도에 표시할 유효한 좌표가 없습니다.</p>
  }

  return (
    <>
      <div
        ref={containerRef}
        className="route-map"
        aria-label="GPS 이동 경로 지도"
      />
      {mapError !== null && (
        <p className="auth-message error-message">{mapError}</p>
      )}
      <p className="map-legend">
        <span className="raw-route-key">원본 경로</span>
        <span className="filtered-route-key">품질 적용 경로</span>
        <span className="start-point-key">시작</span>
        <span className="end-point-key">종료</span>
      </p>
    </>
  )
}
