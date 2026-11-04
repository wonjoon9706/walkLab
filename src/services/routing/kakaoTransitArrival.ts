import {
  BusArrivalError,
  type BusArrivalEstimate,
  type BusArrivalInfo,
} from '../../domain/busArrival'
import type { KakaoTransitRoute } from '../../domain/kakaoTransitRoute'
import {
  SubwayArrivalError,
  type SubwayArrivalRequest,
  type SubwayTrainType,
} from '../../domain/subwayArrival'
import type { AutomaticTransitAccessResult } from '../../domain/transitBoardingPoint'
import { getSeoulSubwayIdByLineName } from '../transitArrival/seoulSubwayMatcher'
import { createKakaoTransitStepMatchingEvidence } from './kakaoTransitRouteDiagnostics'

function getKakaoTrainType(
  step: KakaoTransitRoute['steps'][number],
): SubwayTrainType {
  const text = step.vehicles
    .map((vehicle) => `${vehicle.name} ${vehicle.type ?? ''}`)
    .join(' ')
    .normalize('NFKC')
  return /급행|특급|express/iu.test(text) ? 'express' : 'normal'
}

export function createKakaoSubwayArrivalRequest(
  route: KakaoTransitRoute,
): SubwayArrivalRequest {
  const firstTransitStep = route.steps.find(
    (item) => item.mode === 'SUBWAY' || item.mode === 'BUS',
  )
  const step = firstTransitStep?.mode === 'SUBWAY'
    ? firstTransitStep
    : undefined
  const evidence = step === undefined
    ? null
    : createKakaoTransitStepMatchingEvidence(step)
  if (
    step === undefined ||
    evidence === null ||
    evidence.vehicleOptionCount !== 1 ||
    evidence.orderedStopNames.length < 2
  ) {
    throw new SubwayArrivalError(
      'INVALID_REQUEST',
      '카카오 지하철 노선 또는 승차·다음역 정보가 충분하지 않습니다.',
    )
  }
  const routeName = evidence.vehicleNames[0]
  if (getSeoulSubwayIdByLineName(routeName) === null) {
    throw new SubwayArrivalError(
      'INVALID_REQUEST',
      '서울시 지하철 노선으로 안전하게 연결할 수 없습니다.',
    )
  }
  const boardingName = evidence.orderedStopNames[0]
  const nextName = evidence.orderedStopNames[1]
  const alightingName = evidence.orderedStopNames.at(-1)
  if (alightingName === undefined || boardingName === alightingName) {
    throw new SubwayArrivalError(
      'INVALID_REQUEST',
      '카카오 지하철 승차·하차역을 확인할 수 없습니다.',
    )
  }
  return {
    routeName,
    routeType: null,
    trainType: getKakaoTrainType(step),
    boardingStation: { providerStationId: null, name: boardingName },
    nextStation: { providerStationId: null, name: nextName },
    alightingStation: { providerStationId: null, name: alightingName },
  }
}

export function createKakaoBusArrivalInfo(
  access: AutomaticTransitAccessResult,
  refreshed?: {
    estimates: BusArrivalEstimate[]
    fetchedAt: string
  },
): BusArrivalInfo {
  if (access.busCandidates.length !== 1) {
    throw new BusArrivalError(
      'INVALID_REQUEST',
      '카카오 버스 승차 정류장과 노선을 하나로 확정할 수 없습니다.',
    )
  }
  const candidate = access.busCandidates[0]
  const fetchedAt = refreshed?.fetchedAt ?? candidate.arrivalFetchedAt
  const estimates = refreshed?.estimates ?? candidate.arrivalEstimates
  if (fetchedAt === null) {
    throw new BusArrivalError(
      'INVALID_RESPONSE',
      '서울시 버스 도착정보 조회 시각이 없습니다.',
    )
  }
  const walkingTimeToStopSeconds = access.status === 'ready' &&
    access.accessWalk.mode === 'BUS'
    ? access.accessWalk.pureWalkingDurationSeconds
    : null
  const first = estimates[0]
  if (first === undefined) {
    return {
      routeName: candidate.routeName,
      stopName: candidate.stopName,
      stopId: candidate.stopId,
      arrivalSeconds: null,
      remainingStops: null,
      fetchedAt,
      provider: 'seoul',
      dataMode: 'live',
      status: 'no_service',
      walkingTimeToStopSeconds,
    }
  }
  return {
    routeName: candidate.routeName,
    stopName: candidate.stopName,
    stopId: candidate.stopId,
    arrivalSeconds: first.arrivalSeconds,
    remainingStops: first.remainingStops,
    upcomingArrivals: estimates,
    fetchedAt,
    provider: 'seoul',
    dataMode: 'live',
    status: 'available',
    walkingTimeToStopSeconds,
  }
}
