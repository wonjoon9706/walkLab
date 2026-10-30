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
import {
  CurrentLocationError,
  getCurrentLocation,
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
  formatKoreanDateTime,
  formatSpeed,
} from '../utils/format'

type LoadingStatus = 'idle' | 'loading' | 'ready' | 'error'
type OriginSource = 'current_location' | 'searched_place'

function getNavigationStatusLabel(status: string): string {
  switch (status) {
    case 'starting':
      return 'GPS 확인 중'
    case 'moving':
      return '이동 중'
    case 'stationary':
      return '정지'
    case 'off_route':
      return '경로 이탈'
    case 'rerouting':
      return '경로 재탐색 중'
    case 'stale':
      return 'GPS 갱신 중단'
    case 'gps_unstable':
      return 'GPS 불안정'
    case 'error':
      return '안내 오류'
    default:
      return '안내 대기'
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
  const { isActive: measurementIsActive } = useMeasurement()
  const navigation = useLiveNavigation()
  const routeRequestIdRef = useRef(0)
  const [origin, setOrigin] = useState<GeoCoordinate | null>(null)
  const [originSource, setOriginSource] =
    useState<OriginSource>('current_location')
  const [originPlace, setOriginPlace] =
    useState<PlaceSearchResult | null>(null)
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

  async function requestRoute(
    start: GeoCoordinate,
    nextDestination: PlaceSearchResult,
  ) {
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
      if (routeRequestIdRef.current !== requestId) return
      setRoute(nextRoute)
      setRouteStatus('ready')
    } catch (error) {
      if (routeRequestIdRef.current !== requestId) return
      setRouteStatus('error')
      setRouteError(getRouteErrorMessage(error))
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
      const coordinate = await getCurrentLocation()
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
        const coordinate = await getCurrentLocation()
        if (isCurrent) {
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
    if (navigation.isActive) navigation.stop()
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
    if (navigation.isActive) navigation.stop()
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

  function startNavigation() {
    setGuidanceStartError(null)
    if (route === null || destination === null) {
      setGuidanceStartError('도보 경로를 먼저 조회해 주세요.')
      return
    }
    if (measurementIsActive) {
      setGuidanceStartError(
        'GPS 측정 중에는 길찾기 안내를 함께 시작할 수 없습니다. 측정을 먼저 종료해 주세요.',
      )
      return
    }

    navigation.start({
      route,
      destination: destination.coordinate,
      baselineSpeed,
      forceInitialReroute: originSource === 'searched_place',
    })
  }

  return (
    <main className="page-shell walking-route-page">
      <p className="eyebrow">WalkLab</p>
      <h1>도보 길찾기</h1>
      <p className="page-description">
        현재 위치 또는 직접 선택한 출발지에서 목적지까지 실제 도보 경로를
        조회하고 개인 보행속도로 예상시간을 계산합니다. 안내를 시작하면 Safari
        화면이 켜진 동안 현재 위치와 남은 예상시간을 갱신합니다.
      </p>

      <PlaceSearchPanel
        idPrefix="origin-place"
        title="출발지"
        searchOrigin={origin}
        selectedPlace={originPlace}
        onSelect={selectOrigin}
      >
        {locationStatus === 'loading' && (
          <p role="status">현재 GPS 위치를 확인하는 중입니다.</p>
        )}
        {origin !== null && originSource === 'current_location' && (
          <p className="selected-place-summary">
            선택: <strong>현재 위치</strong>
            <br />
            <span>GPS로 확인한 위치</span>
          </p>
        )}
        {locationError !== null && (
          <p className="error-message auth-message" role="alert">
            {locationError}
          </p>
        )}
        <button
          type="button"
          className="secondary-button"
          disabled={locationStatus === 'loading'}
          onClick={() => void loadLocation()}
        >
          현재 위치로 설정
        </button>
      </PlaceSearchPanel>

      <PlaceSearchPanel
        idPrefix="destination"
        title="목적지"
        searchOrigin={origin}
        selectedPlace={destination}
        onSelect={selectDestination}
      />

      {destination !== null && (
        <section className="status-card" aria-labelledby="route-result-title">
          <h2 id="route-result-title">도보 경로</h2>
          <p>
            출발지:{' '}
            <strong>
              {originSource === 'current_location'
                ? '현재 위치'
                : originPlace?.name ?? '선택한 장소'}
            </strong>
            <br />
            목적지: <strong>{destination.name}</strong>
          </p>
          <p className="page-description">
            {destination.roadAddress ?? destination.address}
          </p>
          {routeStatus === 'loading' && (
            <p role="status">카카오 도보 경로를 조회하는 중입니다.</p>
          )}
          {routeError !== null && (
            <p className="error-message auth-message" role="alert">
              {routeError}
            </p>
          )}
          {route !== null && origin !== null && (
            <WalkingRouteMap
              coordinates={displayedRoute?.coordinates ?? route.coordinates}
              start={origin}
              destination={destination.coordinate}
              currentPosition={
                navigation.isActive ? navigation.currentPosition : null
              }
              remainingCoordinates={
                navigation.isActive
                  ? navigation.remainingCoordinates
                  : undefined
              }
            />
          )}
          {route !== null && (
            <div className="button-row navigation-controls">
              {!navigation.isActive ? (
                <button type="button" onClick={startNavigation}>
                  안내 시작
                </button>
              ) : (
                <button type="button" onClick={navigation.stop}>
                  안내 종료
                </button>
              )}
            </div>
          )}
          {guidanceStartError !== null && (
            <p className="error-message auth-message" role="alert">
              {guidanceStartError}
            </p>
          )}
          {!navigation.isActive && navigation.status === 'error' && (
            <p className="error-message auth-message" role="alert">
              {navigation.message}
            </p>
          )}
        </section>
      )}

      {navigation.isActive && (
        <section className="status-card live-navigation-card" aria-labelledby="live-navigation-title">
          <h2 id="live-navigation-title">실시간 도보 안내</h2>
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
          <dl className="measurement-grid detail-metrics">
            <div>
              <dt>남은 경로 거리</dt>
              <dd>
                {navigation.remainingDistanceM === null
                  ? '계산 중'
                  : formatDistance(navigation.remainingDistanceM)}
              </dd>
            </div>
            <div>
              <dt>경로 진행도</dt>
              <dd>
                {navigation.progressRatio === null
                  ? '계산 중'
                  : `${Math.round(navigation.progressRatio * 100)}%`}
              </dd>
            </div>
            <div>
              <dt>남은 예상시간</dt>
              <dd>{formatDuration(navigation.remainingDurationSeconds)}</dd>
            </div>
            <div>
              <dt>예상 도착시각</dt>
              <dd>
                {navigation.arrivalAt === null
                  ? '계산 중'
                  : formatKoreanDateTime(navigation.arrivalAt)}
              </dd>
            </div>
            <div>
              <dt>최근 실제 보행속도</dt>
              <dd>{formatSpeed(navigation.recentSpeedMps)}</dd>
            </div>
            <div>
              <dt>ETA 적용속도</dt>
              <dd>{formatSpeed(navigation.appliedSpeedMps)}</dd>
            </div>
            <div>
              <dt>속도 기준</dt>
              <dd>
                {navigation.speedSource === 'recent_blended'
                  ? '최근속도 60% + 학습속도 40%'
                  : navigation.speedSource === 'personalized'
                    ? 'G7 개인 추정속도'
                    : '기본속도'}
              </dd>
            </div>
            <div>
              <dt>마지막 GPS 갱신</dt>
              <dd>
                {navigation.lastPositionAt === null
                  ? '수신 대기 중'
                  : formatKoreanDateTime(navigation.lastPositionAt)}
              </dd>
            </div>
          </dl>
          {navigation.message !== null && (
            <p className="page-description">{navigation.message}</p>
          )}
          <p className="page-description">
            안내 위치는 측정 기록으로 저장되지 않습니다. 화면 잠금, Safari 종료,
            백그라운드 상태에서는 GPS 갱신을 보장하지 않습니다.
          </p>
        </section>
      )}

      {route !== null && eta !== null && destination !== null && (
        <section className="status-card" aria-labelledby="eta-title">
          <h2 id="eta-title">예상 도착 정보</h2>
          <dl className="measurement-grid detail-metrics">
            <div>
              <dt>도보 경로 거리</dt>
              <dd>{formatDistance(route.distanceM)}</dd>
            </div>
            <div>
              <dt>적용 예상시간</dt>
              <dd>{formatDuration(eta.appliedDurationSeconds)}</dd>
            </div>
            <div>
              <dt>기본속도 기준</dt>
              <dd>{formatDuration(eta.defaultDurationSeconds)}</dd>
            </div>
            <div>
              <dt>카카오 경로 기본시간</dt>
              <dd>{formatDuration(eta.providerDurationSeconds)}</dd>
            </div>
            <div>
              <dt>실제 적용속도</dt>
              <dd>{formatSpeed(eta.speedProfile.speedMps)}</dd>
            </div>
            <div>
              <dt>적용 모델</dt>
              <dd>
                {eta.speedProfile.source === 'personalized'
                  ? '개인화 추정'
                  : '기본속도'}
              </dd>
            </div>
            <div>
              <dt>예상 도착시각</dt>
              <dd>{formatKoreanDateTime(eta.arrivalAt)}</dd>
            </div>
          </dl>
          <p
            className={`auth-message ${
              eta.speedProfile.source === 'personalized'
                ? 'success-message'
                : 'warning-card'
            }`}
          >
            {eta.speedProfile.source === 'personalized'
              ? `G7 유효 세션 ${eta.speedProfile.validSessionCount}개의 개인 추정속도를 적용했습니다.`
              : 'G7 학습값이 준비되지 않아 4.8km/h 기본속도를 적용했습니다.'}
          </p>
          {speedModelStatus === 'error' && (
            <p className="auth-message warning-card">
              개인 보행 기록을 불러오지 못해 기본속도로 계산했습니다.
            </p>
          )}
          <p className="page-description">
            카카오 기본시간과 WalkLab 예상시간은 계산 기준이 다릅니다. WalkLab
            값에는 아직 신호 대기, 경사도와 날씨 보정이 포함되지 않습니다.
          </p>
          {originSource === 'searched_place' && (
            <p className="auth-message warning-card">
              현재 GPS 위치가 아닌 선택한 출발지를 기준으로 지금 출발한다고
              가정한 예상시간입니다.
            </p>
          )}
        </section>
      )}

      <div className="button-row">
        <Link className="link-button secondary-button" to="/">
          측정 홈으로
        </Link>
        <Link className="link-button secondary-button" to="/history">
          기록 목록
        </Link>
      </div>
    </main>
  )
}
