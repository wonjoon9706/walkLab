import { useState, type ReactNode } from 'react'
import { publicEnvironment } from '../../app/env'
import type {
  GeoCoordinate,
  PlaceSearchResult,
} from '../../domain/walkingRoute'
import {
  PlaceSearchError,
  searchKakaoPlaces,
} from '../../services/places/kakaoPlaceSearch'

interface PlaceSearchPanelProps {
  idPrefix: string
  title: string
  searchOrigin: GeoCoordinate | null
  selectedPlace: PlaceSearchResult | null
  onSelect: (place: PlaceSearchResult) => void
  children?: ReactNode
}

function getPlaceErrorMessage(error: unknown): string {
  if (!(error instanceof PlaceSearchError)) {
    return '장소를 검색하지 못했습니다. 네트워크를 확인해 주세요.'
  }
  switch (error.code) {
    case 'INVALID_QUERY':
      return '장소명이나 주소를 두 글자 이상 입력해 주세요.'
    case 'NO_RESULTS':
      return '검색 결과가 없습니다. 다른 이름이나 주소로 검색해 주세요.'
    case 'SDK_NOT_CONFIGURED':
      return '카카오맵 설정이 완료되지 않았습니다.'
    default:
      return '카카오 장소 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.'
  }
}

export function PlaceSearchPanel({
  idPrefix,
  title,
  searchOrigin,
  selectedPlace,
  onSelect,
  children,
}: PlaceSearchPanelProps) {
  const [query, setQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [results, setResults] = useState<PlaceSearchResult[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSearching(true)
    setErrorMessage(null)
    setResults([])
    try {
      const places = await searchKakaoPlaces(
        query,
        publicEnvironment.kakaoMapJavaScriptKey,
        searchOrigin,
      )
      setResults(places)
    } catch (error) {
      setErrorMessage(getPlaceErrorMessage(error))
    } finally {
      setIsSearching(false)
    }
  }

  function selectPlace(place: PlaceSearchResult) {
    setResults([])
    setQuery(place.name)
    onSelect(place)
  }

  return (
    <section className="status-card" aria-labelledby={`${idPrefix}-title`}>
      <h2 id={`${idPrefix}-title`}>{title}</h2>
      {selectedPlace !== null && (
        <p className="selected-place-summary">
          선택: <strong>{selectedPlace.name}</strong>
          <br />
          <span>{selectedPlace.roadAddress ?? selectedPlace.address}</span>
        </p>
      )}
      {children}
      <form className="route-search-form" onSubmit={handleSearch}>
        <label htmlFor={`${idPrefix}-query`}>장소명 또는 주소</label>
        <div className="route-search-row">
          <input
            id={`${idPrefix}-query`}
            type="search"
            value={query}
            placeholder="예: 서울역"
            autoComplete="off"
            enterKeyHint="search"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" disabled={isSearching}>
            {isSearching ? '검색 중' : '검색'}
          </button>
        </div>
      </form>
      {errorMessage !== null && (
        <p className="error-message auth-message" role="alert">
          {errorMessage}
        </p>
      )}
      {results.length > 0 && (
        <ul className="place-result-list" aria-label={`${title} 검색 결과`}>
          {results.map((place) => (
            <li key={place.id}>
              <button
                type="button"
                className="place-result-button"
                onClick={() => selectPlace(place)}
              >
                <strong>{place.name}</strong>
                <span>{place.roadAddress ?? place.address}</span>
                {place.roadAddress !== null && (
                  <small>지번 {place.address}</small>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
