import type {
  GeoCoordinate,
  PlaceSearchResult,
} from '../../domain/walkingRoute'
import {
  loadKakaoMapSdk,
  type KakaoPlaceDocument,
} from '../../features/map/kakaoMapSdk'

export type PlaceSearchErrorCode =
  | 'SDK_NOT_CONFIGURED'
  | 'INVALID_QUERY'
  | 'NO_RESULTS'
  | 'SEARCH_FAILED'

export class PlaceSearchError extends Error {
  constructor(public readonly code: PlaceSearchErrorCode) {
    super(code)
    this.name = 'PlaceSearchError'
  }
}

function toPlaceSearchResult(
  document: KakaoPlaceDocument,
): PlaceSearchResult | null {
  const latitude = Number(document.y)
  const longitude = Number(document.x)
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null
  }

  return {
    id: document.id,
    name: document.place_name,
    address: document.address_name,
    roadAddress:
      document.road_address_name.trim().length > 0
        ? document.road_address_name
        : null,
    coordinate: { latitude, longitude },
  }
}

export async function searchKakaoPlaces(
  query: string,
  javaScriptKey: string | null,
  origin: GeoCoordinate | null,
): Promise<PlaceSearchResult[]> {
  const trimmedQuery = query.trim()
  if (trimmedQuery.length < 2) {
    throw new PlaceSearchError('INVALID_QUERY')
  }
  if (javaScriptKey === null) {
    throw new PlaceSearchError('SDK_NOT_CONFIGURED')
  }

  const maps = await loadKakaoMapSdk(javaScriptKey)
  const places = new maps.services.Places()

  return new Promise((resolve, reject) => {
    const options =
      origin === null
        ? { size: 10 }
        : {
            size: 10,
            location: new maps.LatLng(origin.latitude, origin.longitude),
            sort: maps.services.SortBy.DISTANCE,
          }

    places.keywordSearch(
      trimmedQuery,
      (documents, status) => {
        if (status === maps.services.Status.ZERO_RESULT) {
          reject(new PlaceSearchError('NO_RESULTS'))
          return
        }
        if (status !== maps.services.Status.OK) {
          reject(new PlaceSearchError('SEARCH_FAILED'))
          return
        }

        const results = documents
          .map(toPlaceSearchResult)
          .filter((item): item is PlaceSearchResult => item !== null)
        if (results.length === 0) {
          reject(new PlaceSearchError('NO_RESULTS'))
          return
        }
        resolve(results)
      },
      options,
    )
  })
}
