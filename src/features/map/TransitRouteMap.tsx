import { useEffect, useRef, useState } from 'react'
import { publicEnvironment } from '../../app/env'
import type { TransitItinerary, TransitMode } from '../../domain/transitRoute'
import {
  transitReferenceWalkPresentation,
  type TransitReferenceWalkOverlay,
} from '../../domain/transitMap'
import type { GeoCoordinate } from '../../domain/walkingRoute'
import {
  loadKakaoMapSdk,
  type KakaoMapOverlay,
  type KakaoMapsNamespace,
  type KakaoMarker,
  type KakaoMapInstance,
} from './kakaoMapSdk'

interface TransitRouteMapProps {
  itinerary: TransitItinerary
  start: GeoCoordinate
  destination: GeoCoordinate
  referenceWalks?: TransitReferenceWalkOverlay[]
  currentPosition?: GeoCoordinate | null
}

const EMPTY_REFERENCE_WALKS: TransitReferenceWalkOverlay[] = []

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

function createDiagnosticMarkerImage(
  maps: KakaoMapsNamespace,
  color: string,
  alt: string,
) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="${color}" stroke="white" stroke-width="2"/></svg>`
  return new maps.MarkerImage(
    `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    new maps.Size(20, 20),
    { offset: new maps.Point(10, 10), alt },
  )
}

export function TransitRouteMap({
  itinerary,
  start,
  destination,
  referenceWalks = EMPTY_REFERENCE_WALKS,
  currentPosition = null,
}: TransitRouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const javaScriptKey = publicEnvironment.kakaoMapJavaScriptKey
  const runtimeRef = useRef<{ maps: KakaoMapsNamespace; map: KakaoMapInstance; marker: KakaoMarker | null } | null>(null)
  const [mapVersion, setMapVersion] = useState(0)

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

        for (const reference of referenceWalks) {
          const path = reference.coordinates.map((coordinate) =>
            new maps.LatLng(coordinate.latitude, coordinate.longitude),
          )
          path.forEach((position) => bounds.extend(position))
          if (path.length >= 2) {
            overlays.push(new maps.Polyline({
              map,
              path,
              strokeWeight: 5,
              strokeColor: transitReferenceWalkPresentation.strokeColor,
              strokeOpacity: 0.8,
              strokeStyle: transitReferenceWalkPresentation.strokeStyle,
            }))
          }

          if (import.meta.env.DEV && path.length >= 2) {
            const requestedStart = new maps.LatLng(
              reference.requestedStart.latitude,
              reference.requestedStart.longitude,
            )
            const requestedDestination = new maps.LatLng(
              reference.requestedDestination.latitude,
              reference.requestedDestination.longitude,
            )
            bounds.extend(requestedStart)
            bounds.extend(requestedDestination)
            overlays.push(
              new maps.Marker({
                map,
                position: requestedStart,
                image: createDiagnosticMarkerImage(
                  maps,
                  transitReferenceWalkPresentation.requestedStartMarkerColor,
                  `${reference.label} 요청 시작점`,
                ),
              }),
              new maps.Marker({
                map,
                position: path[0],
                image: createDiagnosticMarkerImage(
                  maps,
                  transitReferenceWalkPresentation.routeStartMarkerColor,
                  `${reference.label} G8 시작점`,
                ),
              }),
              new maps.Marker({
                map,
                position: path.at(-1)!,
                image: createDiagnosticMarkerImage(
                  maps,
                  transitReferenceWalkPresentation.routeEndMarkerColor,
                  `${reference.label} G8 종료점`,
                ),
              }),
              new maps.Marker({
                map,
                position: requestedDestination,
                image: createDiagnosticMarkerImage(
                  maps,
                  transitReferenceWalkPresentation.requestedDestinationMarkerColor,
                  `${reference.label} 요청 종료점`,
                ),
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
        runtimeRef.current = { maps, map, marker: null }
        setMapVersion((value) => value + 1)
      })
      .catch(() => {
        if (!isDisposed) {
          setMapError('카카오맵을 불러오지 못했습니다.')
        }
      })

    return () => {
      isDisposed = true
      runtimeRef.current?.marker?.setMap(null)
      runtimeRef.current = null
      overlays.forEach((overlay) => overlay.setMap(null))
      container.replaceChildren()
    }
  }, [destination, itinerary, javaScriptKey, referenceWalks, start])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (runtime === null) return
    if (currentPosition === null) {
      runtime.marker?.setMap(null)
      runtime.marker = null
      return
    }
    const position = new runtime.maps.LatLng(currentPosition.latitude, currentPosition.longitude)
    if (runtime.marker === null) {
      runtime.marker = new runtime.maps.Marker({
        map: runtime.map, position,
        image: createMarkerImage(runtime.maps, '#246bdd', 'GPS 내 위치'),
      })
      runtime.map.setCenter(position)
    } else runtime.marker.setPosition(position)
  }, [currentPosition, mapVersion])

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
        {currentPosition !== null && <span>GPS 내 위치</span>}
        {referenceWalks.length > 0 && (
          <span className="reference-walk-key">G8 참고 경로(연결 미확인)</span>
        )}
        {import.meta.env.DEV && referenceWalks.length > 0 && (
          <>
            <span className="reference-request-start-key">요청 시작점</span>
            <span className="reference-route-start-key">G8 시작점</span>
            <span className="reference-route-end-key">G8 종료점</span>
            <span className="reference-request-end-key">요청 종료점</span>
          </>
        )}
      </p>
    </>
  )
}
