const KAKAO_MAP_SCRIPT_ID = 'walklab-kakao-map-sdk'
const KAKAO_MAP_SDK_URL = 'https://dapi.kakao.com/v2/maps/sdk.js'

export interface KakaoLatLng {
  getLat: () => number
  getLng: () => number
}

export interface KakaoMapInstance {
  setBounds: (
    bounds: KakaoLatLngBounds,
    paddingTop?: number,
    paddingRight?: number,
    paddingBottom?: number,
    paddingLeft?: number,
  ) => void
  addControl: (control: KakaoZoomControl, position: unknown) => void
}

interface KakaoLatLngBounds {
  extend: (position: KakaoLatLng) => void
}

type KakaoZoomControl = object
type KakaoMarkerImage = object
type KakaoSize = object
type KakaoPoint = object

export interface KakaoPlaceDocument {
  id: string
  place_name: string
  address_name: string
  road_address_name: string
  x: string
  y: string
}

interface KakaoPlacesSearchOptions {
  location?: KakaoLatLng
  sort?: unknown
  size?: number
}

interface KakaoPlacesService {
  keywordSearch: (
    query: string,
    callback: (
      results: KakaoPlaceDocument[],
      status: string,
    ) => void,
    options?: KakaoPlacesSearchOptions,
  ) => void
}

export interface KakaoMapOverlay {
  setMap: (map: KakaoMapInstance | null) => void
}

export interface KakaoPolyline extends KakaoMapOverlay {
  setPath: (path: KakaoLatLng[]) => void
}

export interface KakaoMarker extends KakaoMapOverlay {
  setPosition: (position: KakaoLatLng) => void
}

export interface KakaoMapsNamespace {
  load: (callback: () => void) => void
  LatLng: new (latitude: number, longitude: number) => KakaoLatLng
  LatLngBounds: new () => KakaoLatLngBounds
  Map: new (
    container: HTMLElement,
    options: { center: KakaoLatLng; level: number },
  ) => KakaoMapInstance
  Polyline: new (options: {
    map: KakaoMapInstance
    path: KakaoLatLng[]
    strokeWeight: number
    strokeColor: string
    strokeOpacity: number
    strokeStyle?: string
  }) => KakaoPolyline
  Marker: new (options: {
    map: KakaoMapInstance
    position: KakaoLatLng
    image: KakaoMarkerImage
  }) => KakaoMarker
  MarkerImage: new (
    source: string,
    size: KakaoSize,
    options: { offset: KakaoPoint; alt?: string },
  ) => KakaoMarkerImage
  Size: new (width: number, height: number) => KakaoSize
  Point: new (x: number, y: number) => KakaoPoint
  ZoomControl: new () => KakaoZoomControl
  ControlPosition: { RIGHT: unknown }
  services: {
    Places: new () => KakaoPlacesService
    Status: {
      OK: string
      ZERO_RESULT: string
      ERROR: string
    }
    SortBy: { DISTANCE: unknown }
  }
}

declare global {
  interface Window {
    kakao?: { maps: KakaoMapsNamespace }
  }
}

let sdkPromise: Promise<KakaoMapsNamespace> | null = null

function waitForMapsLoad(
  resolve: (maps: KakaoMapsNamespace) => void,
  reject: (error: Error) => void,
): void {
  const maps = window.kakao?.maps
  if (maps === undefined) {
    reject(new Error('KAKAO_MAP_SDK_UNAVAILABLE'))
    return
  }

  maps.load(() => resolve(maps))
}

export function loadKakaoMapSdk(
  javaScriptKey: string,
): Promise<KakaoMapsNamespace> {
  if (sdkPromise !== null) {
    return sdkPromise
  }

  const request = new Promise<KakaoMapsNamespace>((resolve, reject) => {
    const existingScript = document.getElementById(
      KAKAO_MAP_SCRIPT_ID,
    ) as HTMLScriptElement | null

    if (window.kakao?.maps !== undefined) {
      waitForMapsLoad(resolve, reject)
      return
    }

    const handleLoad = () => waitForMapsLoad(resolve, reject)
    const handleError = () => {
      document.getElementById(KAKAO_MAP_SCRIPT_ID)?.remove()
      reject(new Error('KAKAO_MAP_SDK_LOAD_FAILED'))
    }

    if (existingScript !== null) {
      existingScript.addEventListener('load', handleLoad, { once: true })
      existingScript.addEventListener('error', handleError, { once: true })
      return
    }

    const url = new URL(KAKAO_MAP_SDK_URL)
    url.searchParams.set('appkey', javaScriptKey)
    url.searchParams.set('autoload', 'false')
    url.searchParams.set('libraries', 'services')

    const script = document.createElement('script')
    script.id = KAKAO_MAP_SCRIPT_ID
    script.src = url.toString()
    script.async = true
    script.addEventListener('load', handleLoad, { once: true })
    script.addEventListener('error', handleError, { once: true })
    document.head.append(script)
  })

  sdkPromise = request.catch((error: unknown) => {
    sdkPromise = null
    throw error
  })
  return sdkPromise
}

export function resetKakaoMapSdkForTest(): void {
  sdkPromise = null
}
