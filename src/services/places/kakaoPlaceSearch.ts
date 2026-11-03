import type {
  GeoCoordinate,
  PlaceSearchResult,
} from '../../domain/walkingRoute'
import {
  loadKakaoMapSdk,
  type KakaoMapsNamespace,
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
    ...(document.category_name?.trim()
      ? { categoryName: document.category_name.trim() }
      : {}),
    ...(document.category_group_code?.trim()
      ? { categoryGroupCode: document.category_group_code.trim() }
      : {}),
    coordinate: { latitude, longitude },
  }
}

function shouldSearchSubway(query: string): boolean {
  return /역(?:\s|$)|지하철|전철/.test(query)
}

interface StationSearchIntent {
  baseQuery: string
  normalizedBaseQuery: string
}

function getStationSearchIntent(query: string): StationSearchIntent | null {
  const match = query.match(
    /^(.+역)\s+(?:KTX|SRT|ITX(?:[-\s]?(?:새마을|청춘|마음))?|무궁화호?|새마을호?|GTX[-\s]?[A-C]|\d+호선|공항철도|신분당선|수인분당선)$/i,
  )
  if (match === null) return null
  const baseQuery = match[1].trim()
  return {
    baseQuery,
    normalizedBaseQuery: normalizeText(baseQuery),
  }
}

function normalizeText(value: string): string {
  return value.toLocaleLowerCase('ko-KR').replace(/\s+/g, '')
}

function getStationBaseName(name: string): string {
  return normalizeText(name).replace(
    /(역)(?:\d+호선|[가-힣]+선|ktx|srt|itx(?:새마을|청춘|마음)?|무궁화호?|새마을호?|gtx[a-c])$/i,
    '$1',
  )
}

function matchesStationIntent(
  result: PlaceSearchResult,
  intent: StationSearchIntent,
): boolean {
  return getStationBaseName(result.name) === intent.normalizedBaseQuery
}

function rankResult(
  result: PlaceSearchResult,
  query: string,
  subwaySearch: boolean,
  stationIntent: StationSearchIntent | null,
): number {
  const normalizedQuery = normalizeText(query)
  const normalizedName = normalizeText(result.name)
  const isSubway = result.categoryGroupCode === 'SW8'

  if (normalizedName === normalizedQuery) return 0
  if (stationIntent !== null && matchesStationIntent(result, stationIntent)) {
    return 1
  }
  if (subwaySearch && isSubway && getStationBaseName(result.name) === normalizedQuery) {
    return 1
  }
  if (subwaySearch && isSubway && normalizedName.startsWith(normalizedQuery)) {
    return 2
  }
  return 3
}

function createSearchOptions(
  maps: KakaoMapsNamespace,
  origin: GeoCoordinate | null,
  categoryGroupCode?: string,
  preferAccuracy = false,
) {
  const isSubwaySearch = categoryGroupCode === 'SW8'
  return {
    // 역명 보강 검색은 거리순으로 자르면 정확한 역이 첫 페이지에서 빠질 수 있다.
    // 카카오의 정확도순 기본값과 최대 페이지 크기를 사용한 뒤 앱에서 재정렬한다.
    size: isSubwaySearch || preferAccuracy ? 15 : 8,
    ...(origin === null || isSubwaySearch || preferAccuracy
      ? {}
      : {
          location: new maps.LatLng(origin.latitude, origin.longitude),
          sort: maps.services.SortBy.DISTANCE,
        }),
    ...(categoryGroupCode === undefined
      ? {}
      : { category_group_code: categoryGroupCode }),
  }
}

function searchOnce(
  maps: KakaoMapsNamespace,
  places: InstanceType<KakaoMapsNamespace['services']['Places']>,
  query: string,
  origin: GeoCoordinate | null,
  categoryGroupCode?: string,
  preferAccuracy = false,
): Promise<PlaceSearchResult[]> {
  return new Promise((resolve, reject) => {
    places.keywordSearch(
      query,
      (documents, status) => {
        if (status === maps.services.Status.ZERO_RESULT) {
          resolve([])
          return
        }
        if (status !== maps.services.Status.OK) {
          reject(new PlaceSearchError('SEARCH_FAILED'))
          return
        }
        resolve(
          documents
            .map(toPlaceSearchResult)
            .filter((item): item is PlaceSearchResult => item !== null),
        )
      },
      createSearchOptions(maps, origin, categoryGroupCode, preferAccuracy),
    )
  })
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
  const subwaySearch = shouldSearchSubway(trimmedQuery)
  const stationIntent = getStationSearchIntent(trimmedQuery)
  const generalPromise = searchOnce(maps, places, trimmedQuery, origin)
  const subwayPromise = subwaySearch
    ? searchOnce(maps, places, trimmedQuery, origin, 'SW8')
    : Promise.resolve([])
  const [generalResults, subwayResults] = await Promise.all([
    generalPromise,
    subwayPromise,
  ])
  let fallbackResults: PlaceSearchResult[] = []
  const originalResults = [...generalResults, ...subwayResults]
  const hasIntendedStation =
    stationIntent !== null &&
    originalResults.some((result) => matchesStationIntent(result, stationIntent))
  if (stationIntent !== null && !hasIntendedStation) {
    const [fallbackGeneral, fallbackSubway] = await Promise.all([
      searchOnce(maps, places, stationIntent.baseQuery, origin, undefined, true),
      searchOnce(maps, places, stationIntent.baseQuery, origin, 'SW8', true),
    ])
    fallbackResults = [...fallbackGeneral, ...fallbackSubway]
  }
  const uniqueResults = new Map<string, PlaceSearchResult>()
  const combinedResults = [...originalResults, ...fallbackResults]
  combinedResults.forEach((result) => {
    if (!uniqueResults.has(result.id)) uniqueResults.set(result.id, result)
  })
  const results = [...uniqueResults.values()]
    .map((result, index) => ({ result, index }))
    .sort((first, second) => {
      const rankDifference =
        rankResult(first.result, trimmedQuery, subwaySearch, stationIntent) -
        rankResult(second.result, trimmedQuery, subwaySearch, stationIntent)
      return rankDifference === 0 ? first.index - second.index : rankDifference
    })
    .slice(0, 8)
    .map(({ result }) => result)

  if (results.length === 0) throw new PlaceSearchError('NO_RESULTS')
  return results
}
