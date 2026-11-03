import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type {
  GeoCoordinate,
  PlaceSearchResult,
  WalkingRoute,
} from '../domain/walkingRoute'
import { WalkingRouteError } from '../domain/walkingRoute'
import { publicEnvironment } from '../app/env'
import type { WalkingSpeedModel } from '../domain/walkingSpeedModel'
import { useAuth } from '../features/auth/authContext'
import { WalkingRouteMap } from '../features/map/WalkingRouteMap'
import { useMeasurement } from '../features/measurement/measurementContext'
import { useLiveNavigation } from '../features/navigation/useLiveNavigation'
import { PlaceSearchPanel } from '../features/places/PlaceSearchPanel'
import { TransitRoutePanel } from '../features/transit/TransitRoutePanel'
import { useSync } from '../features/sync/syncContext'
import {
  CurrentLocationError,
  getCurrentLocationFix,
} from '../services/location/currentLocation'
import { loadCurrentWalkingSpeedModel } from '../services/learning/currentWalkingSpeedModel'
import {
  calculateWalkingEta,
  selectWalkingSpeedProfile,
} from '../services/routing/walkingEta'
import { walkingRouteClient } from '../services/routing/walkingRouteClient'
import { reverseGeocodeKakaoCoordinate } from '../services/places/kakaoReverseGeocode'
import {
  calculateCoordinateGapM,
  calculateWalkingRouteEndpointGaps,
} from '../services/routing/walkingRouteDiagnostics'
import {
  formatDistance,
  formatDuration,
  formatKoreanArrivalTime,
} from '../utils/format'

type LoadingStatus = 'idle' | 'loading' | 'ready' | 'error'
type OriginSource = 'current_location' | 'searched_place' | 'map'

const GPS_ACCURACY_WARNING_M = 50
const ROUTE_START_GAP_WARNING_M = 15

interface GuidanceResult {
  durationSeconds: number | null
  distanceM: number | null
}

function getNavigationStatusLabel(status: string): string {
  switch (status) {
    case 'starting':
      return 'GPS 위치 확인 중'
    case 'moving':
      return '이동 중'
    case 'stationary':
      return '정지'
    case 'off_route':
      return '경로 이탈'
    case 'rerouting':
      return '경로 재탐색 중'
    case 'stale':
      return 'GPS 위치 갱신 대기'
    case 'gps_unstable':
      return 'GPS 위치 확인 중'
    case 'error':
      return 'GPS 또는 안내 오류'
    default:
      return '안내 대기'
  }
}

function getSyncStatusLabel(status: string): string {
  switch (status) {
    case 'syncing':
      return '서버 동기화 중'
    case 'synced':
      return '서버 확인 완료'
    case 'offline':
      return '오프라인 · 전송 대기'
    case 'partial':
      return '일부 전송 대기'
    case 'auth_required':
      return '로그인 확인 대기'
    case 'error':
      return '동기화 오류 · 로컬 원본 유지'
    default:
      return '동기화 대기'
  }
}

function getLocationErrorMessage(error: unknown): string {
  if (!(error instanceof CurrentLocationError)) {
    return '현재 위치를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'
  }
  switch (error.code) {
    case 'PERMISSION_DENIED':
      return '위치 권한이 거부되었습니다. Safari 설정에서 WalkLab의 위치 권한을 허용해 주세요.'
    case 'TIMEOUT':
      return '현재 위치 확인 시간이 초과되었습니다. 하늘이 보이는 곳에서 다시 시도해 주세요.'
    case 'STALE_POSITION':
      return '오래된 위치가 수신되어 현재 위치로 사용하지 않았습니다. 다시 시도해 주세요.'
    case 'UNSUPPORTED':
      return '이 브라우저에서는 현재 위치 기능을 사용할 수 없습니다.'
    default:
      return 'GPS에서 현재 위치를 받지 못했습니다. 잠시 후 다시 시도해 주세요.'
  }
}

function formatLocationMeasuredAt(measuredAt: string | null): string | null {
  if (measuredAt === null) return null
  const date = new Date(measuredAt)
  if (!Number.isFinite(date.getTime())) return null
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function getRouteErrorMessage(error: unknown): string {
  if (!(error instanceof WalkingRouteError)) {
    return '도보 경로를 불러오지 못했습니다. 네트워크를 확인해 주세요.'
  }
  switch (error.code) {
    case 'POINTS_TOO_CLOSE':
      return '목적지가 출발지와 너무 가깝습니다. 다른 목적지를 선택해 주세요.'
    case 'ROUTE_NOT_FOUND':
      return '선택한 목적지까지 도보 경로를 찾지 못했습니다.'
    case 'KAKAO_AUTH_ERROR':
      return '카카오 도보 경로 API 권한 또는 REST API 키를 확인해 주세요.'
    case 'QUOTA_EXCEEDED':
      return '경로 조회 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.'
    case 'REQUEST_TIMEOUT':
      return '도보 경로 조회 시간이 초과되었습니다. 다시 시도해 주세요.'
    case 'AUTH_SESSION_MISSING':
      return '현재 주소에 로그인 세션이 없습니다. localhost 포트가 바뀌었다면 이 주소에서 다시 로그인해 주세요.'
    case 'AUTH_HEADER_MISSING':
      return '경로 요청에 로그인 인증 정보가 전달되지 않았습니다. 새로고침 후 다시 시도해 주세요.'
    case 'AUTH_TOKEN_INVALID':
      return '로그인 인증 정보가 만료되었거나 올바르지 않습니다. 다시 로그인해 주세요.'
    case 'SERVER_AUTH_NOT_CONFIGURED':
      return '로컬 경로 서버의 Supabase 인증 환경변수가 설정되지 않았습니다.'
    case 'SERVER_NOT_CONFIGURED':
      return '도보 경로 서버 설정이 완료되지 않았습니다.'
    case 'INVALID_RESPONSE':
      return '카카오 경로 응답을 해석하지 못했습니다.'
    default:
      return error.message
  }
}

export function WalkingRoutePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeMode = searchParams.get('mode') === 'transit' ? 'transit' : 'walking'
  const { user } = useAuth()
  const measurement = useMeasurement()
  const sync = useSync()
  const navigation = useLiveNavigation()
  const stopMeasurementOnUnmount = measurement.stopMeasurement
  const stopNavigationOnUnmount = navigation.stop
  const routeRequestIdRef = useRef(0)
  const locationRequestIdRef = useRef(0)
  const reverseGeocodeRequestIdRef = useRef(0)
  const originSourceRef = useRef<OriginSource>('current_location')
  const linkedMeasurementRef = useRef(false)
  const guidanceStartingRef = useRef(false)
  const guidanceStartCancelledRef = useRef(false)
  const isMountedRef = useRef(true)
  const [origin, setOrigin] = useState<GeoCoordinate | null>(null)
  const [originSource, setOriginSource] =
    useState<OriginSource>('current_location')
  const [originPlace, setOriginPlace] =
    useState<PlaceSearchResult | null>(null)
  const [currentLocation, setCurrentLocation] =
    useState<GeoCoordinate | null>(null)
  const [currentAccuracyM, setCurrentAccuracyM] = useState<number | null>(null)
  const [currentLocationMeasuredAt, setCurrentLocationMeasuredAt] =
    useState<string | null>(null)
  const [currentLocationAddress, setCurrentLocationAddress] =
    useState<string | null>(null)
  const [locationStatus, setLocationStatus] =
    useState<LoadingStatus>('loading')
  const [locationError, setLocationError] = useState<string | null>(null)
  const [destination, setDestination] =
    useState<PlaceSearchResult | null>(null)
  const [route, setRoute] = useState<WalkingRoute | null>(null)
  const [routeStatus, setRouteStatus] = useState<LoadingStatus>('idle')
  const [routeError, setRouteError] = useState<string | null>(null)
  const [speedModel, setSpeedModel] = useState<WalkingSpeedModel | null>(null)
  const [speedModelStatus, setSpeedModelStatus] =
    useState<LoadingStatus>('loading')
  const [guidanceStartError, setGuidanceStartError] =
    useState<string | null>(null)
  const [isGuidanceStarting, setIsGuidanceStarting] = useState(false)
  const [showGuidanceSaveResult, setShowGuidanceSaveResult] = useState(false)
  const [guidanceResult, setGuidanceResult] =
    useState<GuidanceResult | null>(null)
  const [isMapOriginSelectionEnabled, setIsMapOriginSelectionEnabled] =
    useState(false)
  const [isWalkingMapVisible, setIsWalkingMapVisible] = useState(false)
  const [isTransitMapVisible, setIsTransitMapVisible] = useState(false)
  const [hasTransitResult, setHasTransitResult] = useState(false)
  const displayedRoute =
    navigation.isActive && navigation.route !== null
      ? navigation.route
      : route
  const sharedRouteKey = `${origin?.latitude ?? 'none'}:${origin?.longitude ?? 'none'}:${destination?.coordinate.latitude ?? 'none'}:${destination?.coordinate.longitude ?? 'none'}`
  const previewStart = origin
  const previewDestination = destination?.coordinate ?? null
  const isWalkingRouteMapVisible =
    activeMode === 'walking' && isWalkingMapVisible && route !== null
  const shouldShowPositionPreview =
    !navigation.isActive &&
    !isMapOriginSelectionEnabled &&
    !isWalkingRouteMapVisible &&
    !(activeMode === 'transit' && isTransitMapVisible) &&
    !(activeMode === 'walking' && route !== null) &&
    !(activeMode === 'transit' && hasTransitResult) &&
    (previewStart !== null || previewDestination !== null)

  const baselineSpeed = useMemo(
    () => selectWalkingSpeedProfile(speedModel),
    [speedModel],
  )

  const eta = useMemo(() => {
    if (displayedRoute === null) return null
    try {
      return calculateWalkingEta(
        displayedRoute.distanceM,
        displayedRoute.providerDurationSeconds,
        speedModel,
        new Date(displayedRoute.requestedAt),
      )
    } catch {
      return null
    }
  }, [displayedRoute, speedModel])

  const routeEndpointGaps = useMemo(() => {
    if (route === null || origin === null || destination === null) return null
    return calculateWalkingRouteEndpointGaps(
      route,
      origin,
      destination.coordinate,
    )
  }, [destination, origin, route])

  const gpsToOriginGapM = useMemo(() => {
    if (currentLocation === null || origin === null) return null
    return calculateCoordinateGapM(currentLocation, origin)
  }, [currentLocation, origin])

  async function loadCurrentLocationAddress(coordinate: GeoCoordinate) {
    const requestId = reverseGeocodeRequestIdRef.current + 1
    reverseGeocodeRequestIdRef.current = requestId
    setCurrentLocationAddress(null)
    try {
      const result = await reverseGeocodeKakaoCoordinate(
        coordinate,
        publicEnvironment.kakaoMapJavaScriptKey,
      )
      if (
        reverseGeocodeRequestIdRef.current === requestId &&
        originSourceRef.current === 'current_location'
      ) {
        setCurrentLocationAddress(result.roadAddress ?? result.address)
      }
    } catch {
      // 주소 조회 실패는 좌표 선택과 경로 탐색을 막지 않는다.
    }
  }

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      guidanceStartCancelledRef.current = true
      stopNavigationOnUnmount()
      if (linkedMeasurementRef.current) {
        linkedMeasurementRef.current = false
        void stopMeasurementOnUnmount()
      }
    }
  }, [stopMeasurementOnUnmount, stopNavigationOnUnmount])

  async function requestRoute(
    start: GeoCoordinate,
    nextDestination: PlaceSearchResult,
  ): Promise<WalkingRoute | null> {
    const requestId = routeRequestIdRef.current + 1
    routeRequestIdRef.current = requestId
    setRoute(null)
    setRouteError(null)
    setRouteStatus('loading')
    try {
      const nextRoute = await walkingRouteClient.getWalkingRoute({
        start,
        destination: nextDestination.coordinate,
      })
      if (routeRequestIdRef.current !== requestId) return null
      setRoute(nextRoute)
      setRouteStatus('ready')
      return nextRoute
    } catch (error) {
      if (routeRequestIdRef.current !== requestId) return null
      setRouteStatus('error')
      setRouteError(getRouteErrorMessage(error))
      return null
    }
  }

  async function loadLocation() {
    const locationRequestId = locationRequestIdRef.current + 1
    locationRequestIdRef.current = locationRequestId
    setLocationStatus('loading')
    setLocationError(null)
    try {
      const fix = await getCurrentLocationFix()
      if (locationRequestIdRef.current !== locationRequestId) return
      const coordinate = fix.coordinate
      setCurrentLocation(coordinate)
      setCurrentAccuracyM(fix.accuracyM)
      setCurrentLocationMeasuredAt(fix.measuredAt)
      void loadCurrentLocationAddress(coordinate)
      setOrigin(coordinate)
      originSourceRef.current = 'current_location'
      setOriginSource('current_location')
      setOriginPlace(null)
      setIsMapOriginSelectionEnabled(false)
      setIsWalkingMapVisible(false)
      setLocationStatus('ready')
      setRoute(null)
      setRouteError(null)
      setRouteStatus('idle')
      if (destination !== null && activeMode === 'walking') {
        await requestRoute(coordinate, destination)
      }
    } catch (error) {
      if (locationRequestIdRef.current !== locationRequestId) return
      setLocationStatus('error')
      setLocationError(getLocationErrorMessage(error))
    }
  }

  useEffect(() => {
    let isCurrent = true
    const locationRequestId = locationRequestIdRef.current + 1
    locationRequestIdRef.current = locationRequestId
    async function loadInitialLocation() {
      try {
        const fix = await getCurrentLocationFix()
        const coordinate = fix.coordinate
        if (
          isCurrent &&
          locationRequestIdRef.current === locationRequestId &&
          originSourceRef.current === 'current_location'
        ) {
          setCurrentLocation(coordinate)
          setCurrentAccuracyM(fix.accuracyM)
          setCurrentLocationMeasuredAt(fix.measuredAt)
          void loadCurrentLocationAddress(coordinate)
          setOrigin(coordinate)
          setOriginSource('current_location')
          setLocationStatus('ready')
        }
      } catch (error) {
        if (
          isCurrent &&
          locationRequestIdRef.current === locationRequestId &&
          originSourceRef.current === 'current_location'
        ) {
          setLocationStatus('error')
          setLocationError(getLocationErrorMessage(error))
        }
      }
    }
    void loadInitialLocation()
    return () => {
      isCurrent = false
    }
  }, [])

  useEffect(() => {
    let isCurrent = true
    async function loadSpeedModel() {
      if (user === null) return
      setSpeedModelStatus('loading')
      try {
        const model = await loadCurrentWalkingSpeedModel(user.id)
        if (isCurrent) {
          setSpeedModel(model)
          setSpeedModelStatus('ready')
        }
      } catch {
        if (isCurrent) {
          // 학습 기록 조회 실패 시 경로 기능은 기본속도로 계속 사용할 수 있다.
          setSpeedModel(null)
          setSpeedModelStatus('error')
        }
      }
    }
    void loadSpeedModel()
    return () => {
      isCurrent = false
    }
  }, [user])

  function selectOrigin(place: PlaceSearchResult) {
    if (navigation.isActive || linkedMeasurementRef.current) {
      void stopNavigation()
    }
    locationRequestIdRef.current += 1
    reverseGeocodeRequestIdRef.current += 1
    routeRequestIdRef.current += 1
    originSourceRef.current = 'searched_place'
    setOrigin(place.coordinate)
    setOriginSource('searched_place')
    setOriginPlace(place)
    setIsMapOriginSelectionEnabled(false)
    setIsWalkingMapVisible(false)
    setLocationError(null)
    setRoute(null)
    setRouteError(null)
    setRouteStatus('idle')
    if (destination !== null && activeMode === 'walking') {
      void requestRoute(place.coordinate, destination)
    }
  }

  async function selectMapOrigin(coordinate: GeoCoordinate) {
    if (navigation.isActive || linkedMeasurementRef.current) return

    const mapOrigin: PlaceSearchResult = {
      id: `map-${coordinate.latitude}-${coordinate.longitude}`,
      name: '지도에서 지정한 위치',
      address: '주소 확인 중',
      roadAddress: null,
      coordinate,
    }
    locationRequestIdRef.current += 1
    const addressRequestId = reverseGeocodeRequestIdRef.current + 1
    reverseGeocodeRequestIdRef.current = addressRequestId
    routeRequestIdRef.current += 1
    originSourceRef.current = 'map'
    setOrigin(coordinate)
    setOriginSource('map')
    setOriginPlace(mapOrigin)
    setIsMapOriginSelectionEnabled(false)
    setIsWalkingMapVisible(false)
    setLocationError(null)
    setRoute(null)
    setRouteError(null)
    setRouteStatus('idle')
    if (destination !== null && activeMode === 'walking') {
      void requestRoute(coordinate, destination)
    }

    try {
      const address = await reverseGeocodeKakaoCoordinate(
        coordinate,
        publicEnvironment.kakaoMapJavaScriptKey,
      )
      if (
        reverseGeocodeRequestIdRef.current === addressRequestId &&
        originSourceRef.current === 'map'
      ) {
        setOriginPlace({
          ...mapOrigin,
          roadAddress: address.roadAddress,
          address: address.address ?? '지도에서 선택한 위치',
        })
      }
    } catch {
      if (
        reverseGeocodeRequestIdRef.current === addressRequestId &&
        originSourceRef.current === 'map'
      ) {
        setOriginPlace({
          ...mapOrigin,
          address: '지도에서 선택한 위치',
        })
      }
    }
  }

  function selectDestination(place: PlaceSearchResult) {
    if (navigation.isActive || linkedMeasurementRef.current) {
      void stopNavigation()
    }
    setDestination(place)
    setIsWalkingMapVisible(false)
    setRoute(null)
    setRouteError(null)

    if (origin === null) {
      setRouteStatus('error')
      setRouteError(
        '현재 위치를 확인하거나 출발지를 직접 검색해 선택해 주세요.',
      )
      return
    }
    if (activeMode === 'walking') void requestRoute(origin, place)
  }

  function changeMode(nextMode: 'walking' | 'transit') {
    if (navigation.isActive) return
    setIsMapOriginSelectionEnabled(false)
    setSearchParams(nextMode === 'transit' ? { mode: 'transit' } : {})
    if (
      nextMode === 'walking' &&
      route === null &&
      origin !== null &&
      destination !== null
    ) {
      void requestRoute(origin, destination)
    }
  }

  async function startNavigation() {
    if (guidanceStartingRef.current) return
    setGuidanceStartError(null)
    setShowGuidanceSaveResult(false)
    setGuidanceResult(null)
    if (route === null || destination === null) {
      setGuidanceStartError('도보 경로를 먼저 조회해 주세요.')
      return
    }
    if (measurement.isActive) {
      setGuidanceStartError(
        'GPS 측정 중에는 길찾기 안내를 함께 시작할 수 없습니다. 측정을 먼저 종료해 주세요.',
      )
      return
    }

    guidanceStartingRef.current = true
    guidanceStartCancelledRef.current = false
    setIsGuidanceStarting(true)
    linkedMeasurementRef.current = false
    let routeForNavigation = route
    if (originSource === 'current_location') {
      try {
        const latestFix = await getCurrentLocationFix()
        setCurrentLocation(latestFix.coordinate)
        setCurrentAccuracyM(latestFix.accuracyM)
        setCurrentLocationMeasuredAt(latestFix.measuredAt)
        setOrigin(latestFix.coordinate)
        const refreshedRoute = await requestRoute(
          latestFix.coordinate,
          destination,
        )
        if (refreshedRoute === null) {
          guidanceStartingRef.current = false
          setIsGuidanceStarting(false)
          setGuidanceStartError(
            '최신 현재 위치에서 경로를 다시 확인하지 못해 안내를 시작하지 않았습니다.',
          )
          return
        }
        routeForNavigation = refreshedRoute
      } catch (error) {
        guidanceStartingRef.current = false
        setIsGuidanceStarting(false)
        setLocationStatus('error')
        setLocationError(getLocationErrorMessage(error))
        setGuidanceStartError(
          '현재 위치를 다시 확인하지 못해 안내를 시작하지 않았습니다.',
        )
        return
      }
    }

    if (!isMountedRef.current || guidanceStartCancelledRef.current) {
      guidanceStartingRef.current = false
      if (isMountedRef.current) setIsGuidanceStarting(false)
      return
    }
    const navigationStarted = navigation.startWithPositionSource(
      {
        route: routeForNavigation,
        destination: destination.coordinate,
        baselineSpeed,
        forceInitialReroute: originSource !== 'current_location',
      },
      { subscribe: measurement.subscribeGps },
    )
    if (!navigationStarted) {
      guidanceStartingRef.current = false
      setIsGuidanceStarting(false)
      setGuidanceStartError('실시간 안내를 준비하지 못했습니다.')
      return
    }

    const measurementStarted = await measurement.startMeasurement('navigation')
    if (!isMountedRef.current || guidanceStartCancelledRef.current) {
      if (measurementStarted) {
        await measurement.stopMeasurement()
      }
      guidanceStartingRef.current = false
      if (isMountedRef.current) {
        setIsGuidanceStarting(false)
        setShowGuidanceSaveResult(measurementStarted)
      }
      return
    }
    guidanceStartingRef.current = false
    setIsGuidanceStarting(false)
    if (!measurementStarted) {
      navigation.stop()
      setGuidanceStartError(
        '보행 기록 저장을 시작하지 못해 안내도 시작하지 않았습니다. 측정 상태와 로컬 저장소를 확인해 주세요.',
      )
      return
    }
    linkedMeasurementRef.current = true
  }

  async function stopNavigation() {
    guidanceStartCancelledRef.current = true
    const durationSeconds =
      measurement.startedAt === null
        ? null
        : Math.max(
            0,
            (Date.now() - Date.parse(measurement.startedAt)) / 1000,
          )
    const distanceM =
      navigation.route === null || navigation.remainingDistanceM === null
        ? null
        : Math.max(
            0,
            navigation.route.distanceM - navigation.remainingDistanceM,
          )
    navigation.stop()
    if (!linkedMeasurementRef.current) return

    linkedMeasurementRef.current = false
    await measurement.stopMeasurement()
    setGuidanceResult({ durationSeconds, distanceM })
    setShowGuidanceSaveResult(true)
  }

  return (
    <main className="page-shell walking-route-page">
      <p className="eyebrow">WalkLab</p>
      <h1>길찾기</h1>
      {!navigation.isActive && (
        <>
          <div className="route-search-panels">
            <PlaceSearchPanel
              idPrefix="origin-place"
              title="출발지"
              searchOrigin={origin}
              selectedPlace={originPlace}
              onSelect={selectOrigin}
              searchInitiallyOpen={false}
              closedActions={(openSearch) => (
                <div
                  className="origin-choice-actions"
                  aria-label="출발지 변경 방법"
                >
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={locationStatus === 'loading'}
                    onClick={() => void loadLocation()}
                  >
                    현재 위치 사용
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={openSearch}
                  >
                    장소 또는 주소 검색
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    aria-pressed={isMapOriginSelectionEnabled}
                    onClick={() => setIsMapOriginSelectionEnabled(true)}
                  >
                    지도에서 직접 선택
                  </button>
                </div>
              )}
            >
              {locationStatus === 'loading' && (
                <p role="status">현재 위치를 확인하는 중입니다.</p>
              )}
              {originSource === 'current_location' && (
                <p className="selected-place-summary">
                  <strong>현재 위치</strong>
                  {currentLocationAddress !== null && (
                    <><br /><span>{currentLocationAddress}</span></>
                  )}
                </p>
              )}
              {originSource === 'current_location' && (
                <details className="location-details">
                  <summary>GPS 정보</summary>
                  <p className="page-description">
                    {locationStatus === 'ready'
                      ? `GPS 확인됨${currentAccuracyM === null ? '' : ` · 정확도 약 ${Math.round(currentAccuracyM)}m`}${formatLocationMeasuredAt(currentLocationMeasuredAt) === null ? '' : ` · ${formatLocationMeasuredAt(currentLocationMeasuredAt)} 측정`}`
                      : locationStatus === 'loading' ? 'GPS 확인 중' : 'GPS 확인 필요'}
                  </p>
                </details>
              )}
              {originSource === 'current_location' &&
                currentAccuracyM !== null &&
                currentAccuracyM > GPS_ACCURACY_WARNING_M && (
                  <p className="auth-message warning-card">
                    GPS 오차 범위가 큽니다. 이 위치를 정확한 출발지로 단정하지
                    말고, 필요하면 장소 검색이나 지도 선택으로 지정해 주세요.
                  </p>
                )}
              {originSource !== 'current_location' &&
                gpsToOriginGapM !== null && (
                  <p className="auth-message">
                    현재 GPS 위치와 지정한 출발지는 약{' '}
                    {Math.round(gpsToOriginGapM)}m 떨어져 있습니다.
                  </p>
                )}
              {locationError !== null && (
                <p className="error-message auth-message" role="alert">
                  {locationError}
                </p>
              )}
            </PlaceSearchPanel>

            <PlaceSearchPanel
              idPrefix="destination"
              title="목적지"
              searchOrigin={origin}
              selectedPlace={destination}
              onSelect={selectDestination}
            />
          </div>
        </>
      )}

      {!navigation.isActive && (
        <div className="route-mode-tabs" role="tablist" aria-label="길찾기 종류">
          <button type="button" role="tab" aria-selected={activeMode === 'transit'} onClick={() => changeMode('transit')}>대중교통</button>
          <button type="button" role="tab" aria-selected={activeMode === 'walking'} onClick={() => changeMode('walking')}>도보</button>
        </div>
      )}

      {!navigation.isActive && activeMode === 'walking' && origin !== null && destination !== null && (
        <>
          <button type="button" className="primary-action" disabled={routeStatus === 'loading'} onClick={() => void requestRoute(origin, destination)}>
            {routeStatus === 'loading' ? '도보 경로 검색 중' : '도보 경로 검색'}
          </button>
          {routeError !== null && <p className="error-message auth-message" role="alert">{routeError}</p>}
        </>
      )}

      {shouldShowPositionPreview && (
        <section className="status-card map-card route-map-card location-preview-card" aria-labelledby="location-preview-title">
          <div className="location-preview-heading">
            <h2 id="location-preview-title">위치 미리보기</h2>
            <span>선택한 장소 확인</span>
          </div>
          <WalkingRouteMap
            start={previewStart}
            destination={previewDestination}
            currentPosition={currentLocation}
            currentAccuracyM={currentAccuracyM}
          />
        </section>
      )}

      {(isMapOriginSelectionEnabled || navigation.isActive || isWalkingRouteMapVisible) && origin !== null && (
        <section className="status-card map-card route-map-card" aria-labelledby="route-map-title">
          <h2 id="route-map-title">
            {navigation.isActive ? `${destination?.name ?? '목적지'} 안내` : '지도'}
          </h2>
          <WalkingRouteMap
            coordinates={displayedRoute?.coordinates}
            start={origin}
            destination={destination?.coordinate ?? null}
            currentPosition={
              navigation.isActive
                ? navigation.currentPosition
                : currentLocation
            }
            currentAccuracyM={navigation.isActive ? null : currentAccuracyM}
            remainingCoordinates={
              navigation.isActive ? navigation.remainingCoordinates : undefined
            }
            isStartSelectionEnabled={isMapOriginSelectionEnabled}
            onSelectStart={selectMapOrigin}
            onCancelStartSelection={() =>
              setIsMapOriginSelectionEnabled(false)
            }
          />
          {activeMode === 'walking' && routeEndpointGaps !== null &&
            routeEndpointGaps.startGapM > ROUTE_START_GAP_WARNING_M && (
              <p className="auth-message warning-card" role="status">
                카카오 도보 경로는 지정한 출발지에서 약{' '}
                {Math.round(routeEndpointGaps.startGapM)}m 떨어진 보행 접근점에서
                시작합니다. 필요하면 지도에서 실제 출발 위치를 다시 지정해
                주세요.
              </p>
            )}
        </section>
      )}

      {!navigation.isActive && activeMode === 'walking' && route !== null && eta !== null && destination !== null && (
        <section className="status-card eta-primary-card" aria-labelledby="eta-title">
          <p className="eyebrow">{destination.name}까지</p>
          <p className="eta-label">예상 소요시간</p>
          <h2 id="eta-title" className="hero-metric">
            {formatDuration(eta.appliedDurationSeconds)}
          </h2>
          <dl className="eta-key-facts">
            <div>
              <dt>거리</dt>
              <dd>{formatDistance(route.distanceM)}</dd>
            </div>
            <div>
              <dt>예상 도착</dt>
              <dd>
                {formatKoreanArrivalTime(
                  eta.arrivalAt,
                  new Date(eta.calculatedAt),
                )}
              </dd>
            </div>
            <div>
              <dt>기본 예상시간</dt>
              <dd>{formatDuration(eta.defaultDurationSeconds)}</dd>
            </div>
          </dl>
          <button type="button" className="secondary-button route-map-toggle" onClick={() => setIsWalkingMapVisible((visible) => !visible)}>
            {isWalkingMapVisible ? '지도 접기' : '지도 보기'}
          </button>
          <button
            type="button"
            className="primary-action"
            disabled={isGuidanceStarting}
            onClick={() => void startNavigation()}
          >
            {isGuidanceStarting ? '안내 준비 중' : '안내 시작'}
          </button>
          {guidanceStartError !== null && (
            <p className="error-message auth-message" role="alert">{guidanceStartError}</p>
          )}
          {originSource === 'searched_place' && (
            <p className="auth-message warning-card">
              선택한 출발지에서 지금 출발하는 기준입니다.
            </p>
          )}
        </section>
      )}

      {origin !== null && destination !== null && (
        <TransitRoutePanel
          key={sharedRouteKey}
          active={!navigation.isActive && activeMode === 'transit' && !isMapOriginSelectionEnabled}
          origin={origin}
          destination={destination}
          speedModel={speedModel}
          onMapVisibilityChange={setIsTransitMapVisible}
          onResultAvailabilityChange={setHasTransitResult}
        />
      )}

      {!navigation.isActive && navigation.status === 'error' && (
        <p className="error-message auth-message" role="alert">{navigation.message}</p>
      )}

      {navigation.isActive && (
        <section className="status-card live-navigation-card" aria-labelledby="live-navigation-title">
          <p className="eyebrow">{destination?.name ?? '목적지'}까지</p>
          <p className="eta-label">남은 예상시간</p>
          <h2 id="live-navigation-title" className="hero-metric">
            {formatDuration(navigation.remainingDurationSeconds)}
          </h2>
          <p
            className={`auth-message ${
              navigation.status === 'moving'
                ? 'success-message'
                : 'warning-card'
            }`}
            role="status"
          >
            {getNavigationStatusLabel(navigation.status)}
          </p>
          <dl className="eta-key-facts navigation-key-metrics">
            <div>
              <dt>남은 경로 거리</dt>
              <dd>
                {navigation.remainingDistanceM === null
                  ? '계산할 수 없음'
                  : formatDistance(navigation.remainingDistanceM)}
              </dd>
            </div>
            <div>
              <dt>예상 도착시각</dt>
              <dd>
                {navigation.arrivalAt === null
                  ? '계산할 수 없음'
                  : formatKoreanArrivalTime(
                      navigation.arrivalAt,
                      navigation.lastPositionAt === null
                        ? new Date()
                        : new Date(navigation.lastPositionAt),
                    )}
              </dd>
            </div>
          </dl>
          {navigation.message !== null && (
            <p
              className={
                navigation.status === 'error'
                  ? 'auth-message error-message'
                  : 'auth-message warning-card'
              }
            >
              {navigation.message}
            </p>
          )}
          <p
            className={`compact-save-status ${
              measurement.localSaveStatus === 'failed'
                ? 'error-message'
                : 'success-message'
            }`}
            role="status"
          >
            보행 기록 자동 저장 중
            {measurement.localSaveStatus === 'failed' ? ' · 저장 실패' : ''}
          </p>
          <button type="button" className="navigation-stop-button" onClick={() => void stopNavigation()}>
            안내 종료
          </button>
        </section>
      )}

      {showGuidanceSaveResult && (
        <section className="status-card" aria-labelledby="guidance-save-title">
          <h2 id="guidance-save-title">안내 기록 저장 결과</h2>
          <p
            className={`auth-message ${
              measurement.localSaveStatus === 'failed'
                ? 'error-message'
                : 'success-message'
            }`}
            role="status"
          >
            {measurement.localSaveStatus === 'failed'
              ? '기록 저장에 실패했습니다.'
              : '보행 기록이 로컬에 저장되었습니다.'}
          </p>
          <dl className="measurement-grid detail-metrics">
            <div><dt>측정시간</dt><dd>{formatDuration(guidanceResult?.durationSeconds ?? null)}</dd></div>
            <div>
              <dt>이동거리(경로 기준)</dt>
              <dd>
                {guidanceResult === null || guidanceResult.distanceM === null
                  ? '확인할 수 없음'
                  : formatDistance(guidanceResult.distanceM)}
              </dd>
            </div>
          </dl>
          <p className="page-description">{getSyncStatusLabel(sync.status)}</p>
          <Link className="link-button secondary-button" to="/history">기록 보기</Link>
        </section>
      )}
      {speedModelStatus === 'error' && route !== null && (
        <p className="auth-message warning-card">개인 기록을 불러오지 못해 기본속도를 적용했습니다.</p>
      )}
    </main>
  )
}
