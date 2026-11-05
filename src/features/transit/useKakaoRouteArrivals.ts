import { useEffect, useRef, useState } from 'react'
import type { BusArrivalInfo } from '../../domain/busArrival'
import type { SubwayArrivalInfo } from '../../domain/subwayArrival'
import { SubwayArrivalError } from '../../domain/subwayArrival'
import type { KakaoTransitRoute } from '../../domain/kakaoTransitRoute'
import type { AutomaticTransitAccessResult } from '../../domain/transitBoardingPoint'
import { hasOrderedStopSequence } from '../../services/routing/automaticTransitAccess'
import { createKakaoBusArrivalInfo, createKakaoSubwayArrivalRequest } from '../../services/routing/kakaoTransitArrival'
import { seoulBusEvidenceClient } from '../../services/routing/seoulBusEvidenceClient'
import { subwayArrivalClient } from '../../services/transitArrival/subwayArrivalClient'
import { getTransitStopFailureCode } from '../../services/routing/transitPathReferenceWalk'

export interface KakaoRouteArrival {
  status: 'loading' | 'ready'
  bus: BusArrivalInfo | null
  subway: SubwayArrivalInfo | null
  error: string | null
  checkedAt: string | null
  errorCode?: string
  issue?: 'boarding_unverified' | 'direction_unverified' | 'request_failed' | 'timeout' | 'service_disabled'
    | 'auth_error' | 'not_configured' | 'quota_exceeded' | 'invalid_response' | 'gateway_timeout'
}

const emptyArrival: KakaoRouteArrival = {
  status: 'loading', bus: null, subway: null, error: null, checkedAt: null,
}

export function useKakaoRouteArrivals() {
  const [entries, setEntries] = useState(new Map<string, KakaoRouteArrival>())
  const entriesRef = useRef(entries)
  const generation = useRef(0)
  const shared = useRef(new Map<string, { at: number; promise: Promise<KakaoRouteArrival> }>())
  const [displayedAt, setDisplayedAt] = useState(() => Date.now())

  // 화면의 신선도만 갱신한다. 외부 API를 자동 재조회하지 않는다.
  useEffect(() => {
    const timer = window.setInterval(() => setDisplayedAt(Date.now()), 30_000)
    return () => {
      window.clearInterval(timer)
      generation.current += 1
    }
  }, [])

  function reset() {
    generation.current += 1
    shared.current.clear()
    entriesRef.current = new Map()
    setEntries(new Map())
  }

  function publish(routeId: string, value: KakaoRouteArrival) {
    const next = new Map(entriesRef.current)
    next.set(routeId, value)
    entriesRef.current = next
    setEntries(next)
    setDisplayedAt(Date.now())
  }

  async function ensure(
    route: KakaoTransitRoute,
    access: AutomaticTransitAccessResult | null,
    signal: AbortSignal,
    refresh = false,
  ) {
    const previous = entriesRef.current.get(route.id)
    if (signal.aborted || previous?.status === 'loading' || (!refresh && previous !== undefined)) return
    const currentGeneration = generation.current
    publish(route.id, emptyArrival)
    try {
      const first = route.steps.find((step) => step.mode === 'BUS' || step.mode === 'SUBWAY')
      let key: string
      let load: () => Promise<KakaoRouteArrival>
      if (first?.mode === 'BUS') {
        if (access === null || access.busCandidates.length !== 1 ||
          (access.status === 'review_required' && access.reason === 'MULTIPLE_VEHICLE_OPTIONS')) {
          const diagnostic = access?.status === 'review_required' ? access.diagnosticCode : null
          const codes: Record<string, string> = { API_TIMEOUT: 'REQUEST_TIMEOUT', API_AUTH_ERROR: 'SEOUL_BUS_AUTH_ERROR',
            API_NOT_CONFIGURED: 'SERVER_NOT_CONFIGURED', API_QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
            API_INVALID_RESPONSE: 'INVALID_RESPONSE', API_CONNECTION_FAILED: 'NETWORK_ERROR', API_PROVIDER_ERROR: 'SEOUL_BUS_API_ERROR' }
          throw new Error(diagnostic == null ? 'BOARDING_UNVERIFIED'
            : access?.status === 'review_required' && access.busLookupErrorCode !== undefined
              ? access.busLookupErrorCode : codes[diagnostic] ?? 'BOARDING_UNVERIFIED')
        }
        const candidate = access.busCandidates[0]
        key = JSON.stringify(['bus', candidate.stopId, candidate.routeId, candidate.orderedStopNames])
        load = async () => {
          // 기존 30초 클라이언트 캐시를 경유한다. 오래된 상세 증거를 새 정보처럼 재포장하지 않는다.
          const stops = await seoulBusEvidenceClient.getRouteArrivals(candidate.routeId, signal)
          const matches = stops.filter((stop) => stop.stopId === candidate.stopId)
          if (matches.length !== 1 || !stops.every((stop) => stop.routeId === candidate.routeId) ||
            !hasOrderedStopSequence(stops, candidate.stopId, candidate.orderedStopNames)) {
            throw new Error('DIRECTION_UNVERIFIED')
          }
          const fetchedAt = matches[0].fetchedAt ?? (matches[0].estimates === candidate.arrivalEstimates && candidate.arrivalFetchedAt !== null
            ? candidate.arrivalFetchedAt : new Date().toISOString()
          )
          const bus = createKakaoBusArrivalInfo(access, { estimates: matches[0].estimates, fetchedAt })
          return { status: 'ready', bus, subway: null, error: null, checkedAt: new Date().toISOString() }
        }
      } else {
        const request = createKakaoSubwayArrivalRequest(route)
        // 하차역도 일치해야 운행 범위가 다른 열차의 결과가 섞이지 않는다.
        key = JSON.stringify(['subway', request])
        load = async () => ({
          status: 'ready', bus: null,
          subway: await subwayArrivalClient.getSubwayArrival(request),
          error: null, checkedAt: new Date().toISOString(),
        })
      }
      let cached = shared.current.get(key)
      if (cached === undefined || Date.now() - cached.at >= 30_000) {
        let timer: ReturnType<typeof setTimeout>
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('ARRIVAL_TIMEOUT')), 25_000)
        })
        const promise = Promise.race([load(), timeout]).finally(() => clearTimeout(timer))
        cached = { at: Date.now(), promise }
        shared.current.set(key, cached)
        void promise.catch(() => {
          if (shared.current.get(key)?.promise === promise) shared.current.delete(key)
        })
      }
      const value = await cached.promise
      if (currentGeneration === generation.current && !signal.aborted) publish(route.id, value)
    } catch (error) {
      if (currentGeneration === generation.current && !signal.aborted) {
        const message = error instanceof SubwayArrivalError ? error.code : error instanceof Error ? error.message : ''
        const issue = message === 'BOARDING_UNVERIFIED' ||
          (error instanceof SubwayArrivalError && error.code === 'INVALID_REQUEST')
          ? 'boarding_unverified'
          : message === 'DIRECTION_UNVERIFIED' ? 'direction_unverified'
            : message === 'PRODUCTION_DISABLED' ? 'service_disabled'
              : ['FUNCTION_INVOCATION_TIMEOUT', 'GATEWAY_TIMEOUT'].includes(message) ? 'gateway_timeout'
                : ['ARRIVAL_TIMEOUT', 'REQUEST_TIMEOUT', 'AUTH_REQUEST_TIMEOUT', 'TRANSIT_DETAIL_REQUEST_TIMEOUT'].includes(message) ? 'timeout'
                  : ['AUTH_SESSION_MISSING', 'AUTH_HEADER_MISSING', 'AUTH_TOKEN_INVALID', 'USER_NOT_ALLOWED', 'SEOUL_BUS_AUTH_ERROR'].includes(message) ? 'auth_error'
                    : ['SERVER_NOT_CONFIGURED', 'SERVER_AUTH_NOT_CONFIGURED'].includes(message) ? 'not_configured'
                      : message === 'QUOTA_EXCEEDED' ? 'quota_exceeded'
                        : message === 'INVALID_RESPONSE' ? 'invalid_response' : 'request_failed'
        publish(route.id, {
          status: 'ready', bus: null, subway: null,
          error: '첫 승차 도착정보를 확인하지 못했습니다. 승차 위치·방향 또는 제공 상태를 확인해 주세요.',
          checkedAt: null,
          issue,
          errorCode: ['BOARDING_UNVERIFIED', 'DIRECTION_UNVERIFIED', 'ARRIVAL_TIMEOUT'].includes(message) ? message
            : error instanceof SubwayArrivalError ? error.code : getTransitStopFailureCode(error),
        })
      }
    } finally {
      if (currentGeneration === generation.current && signal.aborted && entriesRef.current.get(route.id)?.status === 'loading') {
        const next = new Map(entriesRef.current)
        next.delete(route.id)
        entriesRef.current = next
        setEntries(next)
      }
    }
  }

  return { entries, ensure, reset, displayedAt }
}
