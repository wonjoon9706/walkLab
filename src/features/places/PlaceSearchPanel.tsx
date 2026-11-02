import {
  useEffect,
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
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
  searchInitiallyOpen?: boolean
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

function formatCategory(categoryName: string): string {
  return categoryName.split('>').at(-1)?.trim() || categoryName
}

export function PlaceSearchPanel({
  idPrefix,
  title,
  searchOrigin,
  selectedPlace,
  onSelect,
  searchInitiallyOpen = true,
  children,
}: PlaceSearchPanelProps) {
  const containerRef = useRef<HTMLElement>(null)
  const requestIdRef = useRef(0)
  const lastRequestedQueryRef = useRef<string | null>(null)
  const isComposingRef = useRef(false)
  const skipNextSearchRef = useRef(false)
  const resultsDismissedRef = useRef(false)
  const [query, setQuery] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(searchInitiallyOpen)
  const [isResultsOpen, setIsResultsOpen] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [results, setResults] = useState<PlaceSearchResult[]>([])
  const [activeResultIndex, setActiveResultIndex] = useState(-1)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [compositionVersion, setCompositionVersion] = useState(0)

  const runSearch = useCallback(async (nextQuery: string, showInvalidQuery: boolean) => {
    const trimmedQuery = nextQuery.trim()
    if (trimmedQuery.length < 2) {
      setResults([])
      setIsResultsOpen(false)
      setErrorMessage(
        showInvalidQuery ? '장소명이나 주소를 두 글자 이상 입력해 주세요.' : null,
      )
      return
    }
    const originKey =
      searchOrigin === null
        ? 'no-origin'
        : `${searchOrigin.latitude},${searchOrigin.longitude}`
    const requestKey = `${originKey}:${trimmedQuery}`
    if (
      lastRequestedQueryRef.current === requestKey &&
      !showInvalidQuery
    ) {
      return
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    lastRequestedQueryRef.current = requestKey
    resultsDismissedRef.current = false
    setIsSearching(true)
    setErrorMessage(null)
    setIsResultsOpen(true)
    setActiveResultIndex(-1)
    try {
      const places = await searchKakaoPlaces(
        trimmedQuery,
        publicEnvironment.kakaoMapJavaScriptKey,
        searchOrigin,
      )
      if (requestId !== requestIdRef.current) return
      setResults(places)
      if (!resultsDismissedRef.current) setIsResultsOpen(true)
    } catch (error) {
      if (requestId !== requestIdRef.current) return
      setResults([])
      setErrorMessage(getPlaceErrorMessage(error))
      if (!resultsDismissedRef.current) setIsResultsOpen(true)
    } finally {
      if (requestId === requestIdRef.current) setIsSearching(false)
    }
  }, [searchOrigin])

  useEffect(() => {
    if (!isSearchOpen || isComposingRef.current) return
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false
      return
    }
    const trimmedQuery = query.trim()
    if (trimmedQuery.length < 2) return

    const timerId = window.setTimeout(() => {
      void runSearch(trimmedQuery, false)
    }, 300)
    return () => window.clearTimeout(timerId)
  }, [compositionVersion, isSearchOpen, query, runSearch])

  useEffect(() => {
    function closeResults(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        resultsDismissedRef.current = true
        setIsResultsOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeResults)
    return () => document.removeEventListener('pointerdown', closeResults)
  }, [])

  function selectPlace(place: PlaceSearchResult) {
    requestIdRef.current += 1
    skipNextSearchRef.current = true
    lastRequestedQueryRef.current = place.name
    setResults([])
    setErrorMessage(null)
    setIsResultsOpen(false)
    resultsDismissedRef.current = true
    setQuery(place.name)
    if (!searchInitiallyOpen) setIsSearchOpen(false)
    onSelect(place)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && results.length > 0) {
      event.preventDefault()
      setIsResultsOpen(true)
      setActiveResultIndex((current) =>
        Math.min(current + 1, results.length - 1),
      )
      return
    }
    if (event.key === 'ArrowUp' && results.length > 0) {
      event.preventDefault()
      setActiveResultIndex((current) => Math.max(current - 1, 0))
      return
    }
    if (event.key === 'Enter' && activeResultIndex >= 0) {
      event.preventDefault()
      selectPlace(results[activeResultIndex])
      return
    }
    if (event.key === 'Escape') setIsResultsOpen(false)
  }

  return (
    <section
      ref={containerRef}
      className="status-card place-search-panel"
      aria-labelledby={`${idPrefix}-title`}
    >
      <h2 id={`${idPrefix}-title`}>{title}</h2>
      {selectedPlace !== null && (
        <p className="selected-place-summary">
          <strong>{selectedPlace.name}</strong>
          <br />
          <span>{selectedPlace.roadAddress ?? selectedPlace.address}</span>
        </p>
      )}
      {children}
      {!isSearchOpen ? (
        <button
          type="button"
          className="secondary-button place-change-button"
          onClick={() => setIsSearchOpen(true)}
        >
          {title} 변경
        </button>
      ) : (
        <form
          className="route-search-form"
          onSubmit={(event) => {
            event.preventDefault()
            void runSearch(query, true)
          }}
        >
          <label htmlFor={`${idPrefix}-query`}>장소명 또는 주소</label>
          <div className="route-search-row">
            <input
              id={`${idPrefix}-query`}
              type="search"
              role="combobox"
              aria-expanded={isResultsOpen}
              aria-controls={`${idPrefix}-results`}
              aria-activedescendant={
                activeResultIndex < 0
                  ? undefined
                  : `${idPrefix}-result-${activeResultIndex}`
              }
              value={query}
              placeholder="장소명 또는 주소 검색"
              autoComplete="off"
              enterKeyHint="search"
              onFocus={() => {
                resultsDismissedRef.current = false
                if (results.length > 0 || errorMessage !== null) {
                  setIsResultsOpen(true)
                }
              }}
              onCompositionStart={() => {
                isComposingRef.current = true
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false
                setCompositionVersion((version) => version + 1)
              }}
              onKeyDown={handleKeyDown}
              onChange={(event) => {
                requestIdRef.current += 1
                lastRequestedQueryRef.current = null
                resultsDismissedRef.current = false
                setQuery(event.target.value)
                setIsSearching(false)
                setResults([])
                setErrorMessage(null)
                setIsResultsOpen(false)
                setActiveResultIndex(-1)
              }}
            />
            <button type="submit" disabled={isSearching}>검색</button>
          </div>
          {isSearching && <p className="search-status" role="status">검색 중…</p>}
          {isResultsOpen && errorMessage !== null && (
            <p className="error-message auth-message" role="alert">
              {errorMessage}
            </p>
          )}
          {isResultsOpen && results.length > 0 && (
            <ul
              id={`${idPrefix}-results`}
              className="place-result-list"
              role="listbox"
              aria-label={`${title} 검색 결과`}
            >
              {results.map((place, index) => (
                <li key={place.id} role="presentation">
                  <button
                    id={`${idPrefix}-result-${index}`}
                    type="button"
                    role="option"
                    aria-selected={activeResultIndex === index}
                    className={`place-result-button ${
                      activeResultIndex === index ? 'active' : ''
                    }`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectPlace(place)}
                  >
                    <strong>{place.name}</strong>
                    {place.categoryName !== undefined && (
                      <small>{formatCategory(place.categoryName)}</small>
                    )}
                    <span>{place.roadAddress ?? place.address}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>
      )}
    </section>
  )
}
