import { useEffect, useMemo, useRef, useState } from 'react'
import { publicEnvironment } from '../../app/env'
import type { GeoCoordinate } from '../../domain/walkingRoute'
import {
  loadKakaoMapSdk,
  type KakaoLatLng,
  type KakaoMapInstance,
  type KakaoMarker,
  type KakaoMapOverlay,
  type KakaoMapsNamespace,
} from './kakaoMapSdk'

interface WalkingRouteMapProps {
  coordinates?: GeoCoordinate[]
  start: GeoCoordinate | null
  destination?: GeoCoordinate | null
  currentPosition?: GeoCoordinate | null
  currentAccuracyM?: number | null
  remainingCoordinates?: GeoCoordinate[]
  comparisonCoordinates?: GeoCoordinate[]
  isStartSelectionEnabled?: boolean
  onSelectStart?: (coordinate: GeoCoordinate) => void
  onCancelStartSelection?: () => void
}

interface MapRuntime {
  map: KakaoMapInstance
  maps: KakaoMapsNamespace
}

const EMPTY_COORDINATES: GeoCoordinate[] = []
const LONG_PRESS_DURATION_MS = 500
const LONG_PRESS_MOVE_TOLERANCE_PX = 10

interface LongPressState {
  pointerId: number
  startClientX: number
  startClientY: number
  activated: boolean
  timerId: number
}

interface StartSelectionState {
  isEnabled: boolean
  draftStart: GeoCoordinate | null
}

function toKakaoPosition(
  maps: KakaoMapsNamespace,
  coordinate: GeoCoordinate,
): KakaoLatLng {
  return new maps.LatLng(coordinate.latitude, coordinate.longitude)
}

function toGeoCoordinate(position: KakaoLatLng): GeoCoordinate {
  return {
    latitude: position.getLat(),
    longitude: position.getLng(),
  }
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
  comparisonCoordinates = EMPTY_COORDINATES,
  isStartSelectionEnabled = false,
  onSelectStart,
  onCancelStartSelection,
}: WalkingRouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<MapRuntime | null>(null)
  const onSelectStartRef = useRef(onSelectStart)
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapReadyVersion, setMapReadyVersion] = useState(0)
  const [startSelection, setStartSelection] = useState<StartSelectionState>({
    isEnabled: isStartSelectionEnabled,
    draftStart: null,
  })
  const javaScriptKey = publicEnvironment.kakaoMapJavaScriptKey
  const stableCoordinates = useMemo(() => coordinates, [coordinates])
  const stableRemainingCoordinates = useMemo(
    () => remainingCoordinates,
    [remainingCoordinates],
  )
  const stableComparisonCoordinates = useMemo(
    () => comparisonCoordinates,
    [comparisonCoordinates],
  )
  const isLiveMode = remainingCoordinates !== undefined

  useEffect(() => {
    onSelectStartRef.current = onSelectStart
  }, [onSelectStart])

  if (startSelection.isEnabled !== isStartSelectionEnabled) {
    setStartSelection({
      isEnabled: isStartSelectionEnabled,
      draftStart: null,
    })
  }
  const draftStart = startSelection.draftStart

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
    let draftMarker: KakaoMarker | null = null
    let draftMarkerDragEndHandler: (() => void) | null = null
    let longPressState: LongPressState | null = null
    let removeSelectionListeners: (() => void) | null = null
    setMapError(null)

    void loadKakaoMapSdk(javaScriptKey)
      .then((maps) => {
        if (isDisposed) return

        const path = stableCoordinates.map((coordinate) =>
          toKakaoPosition(maps, coordinate),
        )
        const comparisonPath = stableComparisonCoordinates.map((coordinate) =>
          toKakaoPosition(maps, coordinate),
        )
        const initialCoordinate = start ?? destination
        if (initialCoordinate === null) return
        const initialCenter = toKakaoPosition(maps, initialCoordinate)
        const map = new maps.Map(container, {
          center: initialCenter,
          level: 4,
        })
        map.addControl(new maps.ZoomControl(), maps.ControlPosition.RIGHT)

        if (isStartSelectionEnabled && onSelectStartRef.current !== undefined) {
          const getPointerPosition = (event: PointerEvent) => {
            const bounds = container.getBoundingClientRect()
            const point = new maps.Point(
              event.clientX - bounds.left,
              event.clientY - bounds.top,
            )
            return map.getProjection().coordsFromContainerPoint(point)
          }

          const setDraftMarkerPosition = (position: KakaoLatLng) => {
            const coordinate = toGeoCoordinate(position)
            if (
              !Number.isFinite(coordinate.latitude) ||
              !Number.isFinite(coordinate.longitude)
            ) {
              return
            }

            if (draftMarker === null) {
              draftMarker = new maps.Marker({
                map,
                position,
                image: createMarkerImage(
                  maps,
                  '#d97706',
                  '임시 출발지',
                ),
                draggable: true,
              })
              draftMarkerDragEndHandler = () => {
                if (draftMarker !== null) {
                  const coordinate = toGeoCoordinate(
                    draftMarker.getPosition(),
                  )
                  setStartSelection((current) => ({
                    ...current,
                    draftStart: coordinate,
                  }))
                }
              }
              maps.event.addListener(
                draftMarker,
                'dragend',
                draftMarkerDragEndHandler,
              )
            } else {
              draftMarker.setPosition(position)
            }
            setStartSelection((current) => ({
              ...current,
              draftStart: coordinate,
            }))
          }

          const clearLongPress = () => {
            if (longPressState !== null) {
              window.clearTimeout(longPressState.timerId)
              longPressState = null
            }
          }

          const handlePointerDown = (event: PointerEvent) => {
            if (draftMarker !== null) return
            if (
              event.isPrimary === false ||
              (event.pointerType === 'mouse' && event.button !== 0)
            ) {
              if (longPressState?.activated) map.setDraggable(true)
              clearLongPress()
              return
            }
            if (longPressState !== null) {
              if (longPressState.activated) map.setDraggable(true)
              clearLongPress()
              return
            }

            const state: LongPressState = {
              pointerId: event.pointerId,
              startClientX: event.clientX,
              startClientY: event.clientY,
              activated: false,
              timerId: 0,
            }
            state.timerId = window.setTimeout(() => {
              if (longPressState !== state || isDisposed) return
              state.activated = true
              map.setDraggable(false)
              setDraftMarkerPosition(getPointerPosition(event))
            }, LONG_PRESS_DURATION_MS)
            longPressState = state
          }

          const handlePointerMove = (event: PointerEvent) => {
            const state = longPressState
            if (state === null || event.pointerId !== state.pointerId) return

            const movedDistance = Math.hypot(
              event.clientX - state.startClientX,
              event.clientY - state.startClientY,
            )
            if (!state.activated) {
              if (movedDistance > LONG_PRESS_MOVE_TOLERANCE_PX) {
                clearLongPress()
              }
              return
            }

            event.preventDefault()
            event.stopPropagation()
            setDraftMarkerPosition(getPointerPosition(event))
          }

          const finishPointerInteraction = (event: PointerEvent) => {
            const state = longPressState
            if (state === null || event.pointerId !== state.pointerId) return
            if (state.activated) {
              event.preventDefault()
              event.stopPropagation()
            }
            clearLongPress()
            map.setDraggable(true)
          }

          const preventLongPressMenu = (event: Event) => {
            event.preventDefault()
          }

          container.addEventListener('pointerdown', handlePointerDown, true)
          container.addEventListener('pointermove', handlePointerMove, {
            capture: true,
            passive: false,
          })
          container.addEventListener('contextmenu', preventLongPressMenu)
          window.addEventListener('pointerup', finishPointerInteraction, true)
          window.addEventListener(
            'pointercancel',
            finishPointerInteraction,
            true,
          )

          removeSelectionListeners = () => {
            clearLongPress()
            map.setDraggable(true)
            container.removeEventListener(
              'pointerdown',
              handlePointerDown,
              true,
            )
            container.removeEventListener(
              'pointermove',
              handlePointerMove,
              true,
            )
            container.removeEventListener(
              'contextmenu',
              preventLongPressMenu,
            )
            window.removeEventListener(
              'pointerup',
              finishPointerInteraction,
              true,
            )
            window.removeEventListener(
              'pointercancel',
              finishPointerInteraction,
              true,
            )
          }
        }

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
        if (comparisonPath.length >= 2) {
          overlays.push(new maps.Polyline({
            map,
            path: comparisonPath,
            strokeWeight: 5,
            strokeColor: '#d97706',
            strokeOpacity: 0.9,
            strokeStyle: 'shortdash',
          }))
        }
        if (start !== null) {
          overlays.push(new maps.Marker({
            map,
            position: toKakaoPosition(maps, start),
            image: createMarkerImage(maps, '#2a8c58', '도보 경로 출발지'),
          }))
        }
        if (destination !== null) {
          overlays.push(new maps.Marker({
            map,
            position: toKakaoPosition(maps, destination),
            image: createMarkerImage(maps, '#c54242', '도보 경로 목적지'),
          }))
        }

        if (destination !== null && (start !== null || path.length >= 2)) {
          const bounds = new maps.LatLngBounds()
          path.forEach((position) => bounds.extend(position))
          comparisonPath.forEach((position) => bounds.extend(position))
          if (start !== null) {
            bounds.extend(toKakaoPosition(maps, start))
          }
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
      removeSelectionListeners?.()
      if (draftMarker !== null && draftMarkerDragEndHandler !== null) {
        const marker = draftMarker as KakaoMarker
        const handler = draftMarkerDragEndHandler as () => void
        const runtime = runtimeRef.current
        runtime?.maps.event.removeListener(marker, 'dragend', handler)
      }
      draftMarker?.setMap(null)
      runtimeRef.current = null
      overlays.forEach((overlay) => overlay.setMap(null))
      container.replaceChildren()
    }
  }, [
    destination,
    isLiveMode,
    isStartSelectionEnabled,
    javaScriptKey,
    stableCoordinates,
    stableComparisonCoordinates,
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
      <div className="route-map-shell">
        <div
          ref={containerRef}
          className="route-map"
          aria-label="출발지에서 목적지까지의 도보 경로 지도"
        />
        {isStartSelectionEnabled && (
          <div className="map-selection-banner" role="status">
            <span>
              {draftStart === null
                ? '지도를 0.5초 길게 눌러 출발 위치를 선택하세요.'
                : '마커를 드래그해 위치를 조정하세요.'}
            </span>
            <div className="map-selection-actions">
              {draftStart !== null && (
                <button
                  type="button"
                  className="primary-button map-selection-confirm-button"
                  onClick={() => onSelectStartRef.current?.(draftStart)}
                >
                  출발지 설정
                </button>
              )}
              <button
                type="button"
                className="map-selection-cancel-button"
                onClick={onCancelStartSelection}
              >
                취소
              </button>
            </div>
          </div>
        )}
      </div>
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
        {stableComparisonCoordinates.length >= 2 && (
          <span className="comparison-route-key">TMAP WALK 경로</span>
        )}
        {start !== null && <span className="start-point-key">출발지</span>}
        {destination !== null && <span className="end-point-key">목적지</span>}
        {currentPosition !== null && (
          <span className="current-position-key">현재 위치</span>
        )}
      </p>
    </>
  )
}
