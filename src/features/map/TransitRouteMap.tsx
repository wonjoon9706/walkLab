import { useEffect, useRef, useState } from 'react'
import { publicEnvironment } from '../../app/env'
import type { TransitItinerary, TransitMode } from '../../domain/transitRoute'
import type { GeoCoordinate } from '../../domain/walkingRoute'
import {
  loadKakaoMapSdk,
  type KakaoMapOverlay,
  type KakaoMapsNamespace,
} from './kakaoMapSdk'

interface TransitRouteMapProps {
  itinerary: TransitItinerary
  start: GeoCoordinate
  destination: GeoCoordinate
}

function createMarkerImage(
  maps: KakaoMapsNamespace,
  color: string,
  alt: string,
) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40"><path fill="${color}" stroke="white" stroke-width="2" d="M14 1C6.8 1 1 6.8 1 14c0 9.8 13 25 13 25s13-15.2 13-25C27 6.8 21.2 1 14 1z"/><circle cx="14" cy="14" r="5" fill="white"/></svg>`
  return new maps.MarkerImage(
    `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    new maps.Size(28, 40),
    { offset: new maps.Point(14, 40), alt },
  )
}

function getLegColor(mode: TransitMode, providerColor: string | null): string {
  if (providerColor !== null && /^[0-9a-fA-F]{6}$/.test(providerColor)) {
    return `#${providerColor}`
  }
  if (mode === 'WALK') return '#7b8b85'
  if (mode === 'SUBWAY') return '#2a8c58'
  return '#176b87'
}

export function TransitRouteMap({
  itinerary,
  start,
  destination,
}: TransitRouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const javaScriptKey = publicEnvironment.kakaoMapJavaScriptKey

  useEffect(() => {
    const container = containerRef.current
    if (container === null || javaScriptKey === null) return

    let isDisposed = false
    const overlays: KakaoMapOverlay[] = []
    setMapError(null)

    void loadKakaoMapSdk(javaScriptKey)
      .then((maps) => {
        if (isDisposed) return
        const startPosition = new maps.LatLng(start.latitude, start.longitude)
        const destinationPosition = new maps.LatLng(
          destination.latitude,
          destination.longitude,
        )
        const map = new maps.Map(container, {
          center: startPosition,
          level: 5,
        })
        map.addControl(new maps.ZoomControl(), maps.ControlPosition.RIGHT)
        const bounds = new maps.LatLngBounds()
        bounds.extend(startPosition)
        bounds.extend(destinationPosition)

        for (const leg of itinerary.legs) {
          if (leg.durationSeconds === 0 && leg.distanceM === 0) continue
          const path = leg.coordinates.map(
            (coordinate) =>
              new maps.LatLng(coordinate.latitude, coordinate.longitude),
          )
          path.forEach((position) => bounds.extend(position))
          if (path.length >= 2) {
            overlays.push(
              new maps.Polyline({
                map,
                path,
                strokeWeight: leg.mode === 'WALK' ? 5 : 7,
                strokeColor: getLegColor(leg.mode, leg.routeColor),
                strokeOpacity: leg.mode === 'WALK' ? 0.7 : 0.95,
                strokeStyle: leg.mode === 'WALK' ? 'shortdash' : undefined,
              }),
            )
          }
        }

        overlays.push(
          new maps.Marker({
            map,
            position: startPosition,
            image: createMarkerImage(maps, '#2a8c58', '대중교통 출발지'),
          }),
          new maps.Marker({
            map,
            position: destinationPosition,
            image: createMarkerImage(maps, '#c54242', '대중교통 목적지'),
          }),
        )
        map.setBounds(bounds, 40, 40, 40, 40)
      })
      .catch(() => {
        if (!isDisposed) {
          setMapError('카카오맵을 불러오지 못했습니다.')
        }
      })

    return () => {
      isDisposed = true
      overlays.forEach((overlay) => overlay.setMap(null))
      container.replaceChildren()
    }
  }, [destination, itinerary, javaScriptKey, start])

  if (javaScriptKey === null) {
    return <p className="error-message">카카오맵 설정이 없습니다.</p>
  }

  return (
    <>
      <div
        ref={containerRef}
        className="route-map"
        aria-label="선택한 대중교통 경로 지도"
      />
      {mapError !== null && <p className="error-message">{mapError}</p>}
      <p className="map-legend">
        <span className="raw-route-key">도보</span>
        <span className="filtered-route-key">버스·지하철</span>
        <span className="start-point-key">출발지</span>
        <span className="end-point-key">목적지</span>
      </p>
    </>
  )
}
