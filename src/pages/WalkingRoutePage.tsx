import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type {
  GeoCoordinate,
  PlaceSearchResult,
  WalkingRoute,
} from '../domain/walkingRoute'
import { WalkingRouteError } from '../domain/walkingRoute'
import type { WalkingSpeedModel } from '../domain/walkingSpeedModel'
import { useAuth } from '../features/auth/authContext'
import { WalkingRouteMap } from '../features/map/WalkingRouteMap'
import { useMeasurement } from '../features/measurement/measurementContext'
import { useLiveNavigation } from '../features/navigation/useLiveNavigation'
import { PlaceSearchPanel } from '../features/places/PlaceSearchPanel'
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
import {
  formatDistance,
  formatDuration,
  formatKoreanArrivalTime,
} from '../utils/format'

type LoadingStatus = 'idle' | 'loading' | 'ready' | 'error'
type OriginSource = 'current_location' | 'searched_place'

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
    case 'UNSUPPORTED':
      return '이 브라우저에서는 현재 위치 기능을 사용할 수 없습니다.'
    default:
      return 'GPS에서 현재 위치를 받지 못했습니다. 잠시 후 다시 시도해 주세요.'
  }
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
  const { user } = useAuth()
  const measurement = useMeasurement()
  const sync = useSync()
  const navigation = useLiveNavigation()
  const stopMeasurementOnUnmount = measurement.stopMeasurement
  const stopNavigationOnUnmount = navigation.stop
  const routeRequestIdRef = useRef(0)
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
  const displayedRoute =
    navigation.isActive && navigation.route !== null
      ? navigation.route
      : route

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
    routeRequestIdRef.current += 1
    setLocationStatus('loading')
    setLocationError(null)
    setRoute(null)
    setRouteError(null)
    setRouteStatus('idle')
    try {
      const fix = await getCurrentLocationFix()
      const coordinate = fix.coordinate
      setCurrentLocation(coordinate)
      setCurrentAccuracyM(fix.accuracyM)
      setOrigin(coordinate)
      setOriginSource('current_location')
      setOriginPlace(null)
      setLocationStatus('ready')
      if (destination !== null) {
        await requestRoute(coordinate, destination)
      }
    } catch (error) {
      setLocationStatus('error')
      setLocationError(getLocationErrorMessage(error))
    }
  }

  useEffect(() => {
    let isCurrent = true
    async function loadInitialLocation() {
      try {
        const fix = await getCurrentLocationFix()
        const coordinate = fix.coordinate
        if (isCurrent) {
          setCurrentLocation(coordinate)
          setCurrentAccuracyM(fix.accuracyM)
          setOrigin(coordinate)
          setOriginSource('current_location')
          setLocationStatus('ready')
        }
      } catch (error) {
        if (isCurrent) {
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
    routeRequestIdRef.current += 1
    setOrigin(place.coordinate)
    setOriginSource('searched_place')
    setOriginPlace(place)
    setLocationStatus('ready')
    setLocationError(null)
    setRoute(null)
    setRouteError(null)
    setRouteStatus('idle')
    if (destination !== null) {
      void requestRoute(place.coordinate, destination)
    }
  }

  function selectDestination(place: PlaceSearchResult) {
    if (navigation.isActive || linkedMeasurementRef.current) {
      void stopNavigation()
    }
    setDestination(place)
    setRoute(null)
    setRouteError(null)

    if (origin === null) {
      setRouteStatus('error')
      setRouteError(
        '현재 위치를 확인하거나 출발지를 직접 검색해 선택해 주세요.',
      )
      return
    }
    void requestRoute(origin, place)
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
        forceInitialReroute: originSource === 'searched_place',
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
      <h1>도보 길찾기</h1>
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
            >
              {locationStatus === 'loading' && (
                <p role="status">현재 위치를 확인하는 중입니다.</p>
              )}
              {originSource === 'current_location' && (
                <p className="selected-place-summary">
                  <strong>현재 위치</strong>
                  <br />
                  <span>
                    {locationStatus === 'ready'
                      ? `GPS 확인됨${
                          currentAccuracyM === null
                            ? ''
                            : ` · 정확도 약 ${Math.round(currentAccuracyM)}m`
                        }`
                      : locationStatus === 'loading'
                        ? 'GPS 확인 중'
                        : 'GPS 확인 필요'}
                  </span>
                </p>
              )}
              {locationError !== null && (
                <p className="error-message auth-message" role="alert">
                  {locationError}
                </p>
              )}
              {(locationStatus === 'error' || originSource === 'searched_place') && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={locationStatus === 'loading'}
                  onClick={() => void loadLocation()}
                >
                  내 위치 사용
                </button>
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

      {origin !== null && (
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
          />
          {routeStatus === 'loading' && (
            <p role="status">도보 경로를 조회하는 중입니다.</p>
          )}
          {routeError !== null && (
            <p className="error-message auth-message" role="alert">{routeError}</p>
          )}
        </section>
      )}

      {!navigation.isActive && route !== null && eta !== null && destination !== null && (
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
          </dl>
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
