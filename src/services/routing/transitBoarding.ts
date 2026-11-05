import type { BusArrivalInfo } from '../../domain/busArrival'
import type { SubwayArrivalInfo } from '../../domain/subwayArrival'
import type {
  BoardingCandidateAssessment,
  BoardingLikelihood,
  LiveDataFreshness,
  TransitBoardingPlan,
  TransitLegBoardingAssessment,
  TransitWalkingLegEstimate,
} from '../../domain/transitBoarding'
import type { TransitItinerary } from '../../domain/transitRoute'
import type { WalkingSpeedModel } from '../../domain/walkingSpeedModel'
import { selectWalkingSpeedProfile } from './walkingEta'

export const transitBoardingPolicy = {
  liveDataMaximumAgeSeconds: 120,
  busLikelyMarginSeconds: 120,
  busTightMinimumMarginSeconds: 30,
} as const

interface ArrivalInputs {
  bus: ReadonlyMap<number, BusArrivalInfo>
  subway: ReadonlyMap<number, SubwayArrivalInfo>
}

function toIso(value: number): string {
  return new Date(value).toISOString()
}

function getFreshness(
  sourceTime: string | null,
  calculatedAt: number,
): LiveDataFreshness {
  if (sourceTime === null) return 'missing'
  const sourceTimestamp = new Date(sourceTime).getTime()
  if (!Number.isFinite(sourceTimestamp)) return 'missing'
  const ageSeconds = Math.max(0, (calculatedAt - sourceTimestamp) / 1_000)
  return ageSeconds > transitBoardingPolicy.liveDataMaximumAgeSeconds
    ? 'stale'
    : 'fresh'
}

function classifyBusMargin(marginSeconds: number): BoardingLikelihood {
  if (marginSeconds >= transitBoardingPolicy.busLikelyMarginSeconds) {
    return 'likely'
  }
  if (marginSeconds >= transitBoardingPolicy.busTightMinimumMarginSeconds) {
    return 'tight'
  }
  return 'unlikely'
}

export function calculateTransitWalkingLeg(
  leg: TransitItinerary['legs'][number],
  legIndex: number,
  model: WalkingSpeedModel | null,
): TransitWalkingLegEstimate {
  if (leg.mode !== 'WALK') throw new Error('NOT_WALKING_LEG')
  const speedProfile = selectWalkingSpeedProfile(model)
  return {
    legIndex,
    distanceM: leg.distanceM,
    providerDurationSeconds: leg.durationSeconds,
    pureWalkingDurationSeconds: leg.distanceM === 0
      ? 0
      : Math.ceil(leg.distanceM / speedProfile.speedMps),
    speedProfile,
    unverifiedOverheadSeconds: null,
  }
}

function unavailableAssessment(
  legIndex: number,
  mode: 'BUS' | 'SUBWAY',
  status: BoardingLikelihood,
  freshness: LiveDataFreshness,
  accessDurationSeconds: number,
  accessArrivalAt: number | null,
  message: string,
): TransitLegBoardingAssessment {
  return {
    legIndex,
    mode,
    status,
    dataFreshness: freshness,
    accessDurationSeconds,
    accessArrivalAt: accessArrivalAt === null ? null : toIso(accessArrivalAt),
    platformAccess: mode === 'SUBWAY' ? 'unknown' : 'not_required',
    candidates: [],
    selectedOrder: null,
    message,
  }
}

function assessBus(
  legIndex: number,
  arrival: BusArrivalInfo | undefined,
  calculatedAt: number,
  accessDurationSeconds: number,
  accessArrivalAt: number,
): TransitLegBoardingAssessment {
  const freshness = getFreshness(arrival?.fetchedAt ?? null, calculatedAt)
  if (arrival?.status !== 'available' || freshness !== 'fresh') {
    return unavailableAssessment(
      legIndex,
      'BUS',
      'unavailable',
      freshness,
      accessDurationSeconds,
      accessArrivalAt,
      freshness === 'stale'
        ? '도착정보가 오래되어 탑승 가능성을 판단하지 않습니다.'
        : '유효한 버스 도착정보가 없어 판단할 수 없습니다.',
    )
  }

  const estimates = (arrival.upcomingArrivals ?? [{
    order: 1 as const,
    arrivalSeconds: arrival.arrivalSeconds,
    remainingStops: arrival.remainingStops,
    message: null,
  }]).filter((estimate) =>
    estimate.arrivalTimeStatus !== 'review_required' &&
    estimate.serviceStatus !== 'departure_waiting',
  )
  if (estimates.length === 0) {
    return unavailableAssessment(
      legIndex,
      'BUS',
      'unavailable',
      freshness,
      accessDurationSeconds,
      accessArrivalAt,
      '서울시 도착시간과 남은 정류장 정보가 일치하지 않아 탑승 가능성을 판단하지 않습니다.',
    )
  }
  const fetchedAt = new Date(arrival.fetchedAt).getTime()
  const candidates: BoardingCandidateAssessment[] = estimates.map((estimate) => {
    const serviceArrivalAt = fetchedAt + estimate.arrivalSeconds * 1_000
    const marginSeconds = Math.floor((serviceArrivalAt - accessArrivalAt) / 1_000)
    return {
      order: estimate.order,
      serviceArrivalAt: toIso(serviceArrivalAt),
      accessArrivalAt: toIso(accessArrivalAt),
      marginSeconds,
      likelihood: classifyBusMargin(marginSeconds),
      destination: null,
    }
  })
  const selected = candidates.find(
    (candidate) => candidate.likelihood === 'likely' || candidate.likelihood === 'tight',
  )
  return {
    legIndex,
    mode: 'BUS',
    status: selected?.likelihood ?? 'unlikely',
    dataFreshness: freshness,
    accessDurationSeconds,
    accessArrivalAt: toIso(accessArrivalAt),
    platformAccess: 'not_required',
    candidates,
    selectedOrder: selected?.order === 1 || selected?.order === 2
      ? selected.order
      : null,
    message: selected === undefined
      ? '현재 제공된 차량에는 안전 여유가 부족합니다.'
      : selected.likelihood === 'likely'
        ? '예측 변동을 고려해도 비교적 여유가 있지만 탑승을 보장하지 않습니다.'
        : '도착시간 변동을 고려하면 시간이 촉박합니다.',
  }
}

function assessSubway(
  legIndex: number,
  arrival: SubwayArrivalInfo | undefined,
  calculatedAt: number,
  accessDurationSeconds: number,
  accessArrivalAt: number,
): TransitLegBoardingAssessment {
  const newestGeneratedAt = arrival?.estimates.reduce<string | null>(
    (newest, estimate) => newest === null || estimate.generatedAt > newest
      ? estimate.generatedAt
      : newest,
    null,
  ) ?? null
  const freshness = getFreshness(newestGeneratedAt, calculatedAt)
  if (arrival?.status !== 'available' || freshness !== 'fresh') {
    return unavailableAssessment(
      legIndex,
      'SUBWAY',
      'unavailable',
      freshness,
      accessDurationSeconds,
      accessArrivalAt,
      freshness === 'stale'
        ? '열차 정보가 오래되어 판단하지 않습니다.'
        : '유효한 열차 도착정보가 없어 판단할 수 없습니다.',
    )
  }
  const candidates: BoardingCandidateAssessment[] = arrival.estimates.map(
    (estimate) => {
      // rawArrivalSeconds는 recptnDt 기준 원본이므로 보정된 arrivalSeconds를 다시 차감하지 않는다.
      const serviceArrivalAt = new Date(estimate.generatedAt).getTime()
        + estimate.rawArrivalSeconds * 1_000
      return {
        order: estimate.order,
        serviceArrivalAt: toIso(serviceArrivalAt),
        accessArrivalAt: toIso(accessArrivalAt),
        marginSeconds: Math.floor((serviceArrivalAt - accessArrivalAt) / 1_000),
        likelihood: 'unavailable' as const,
        destination: estimate.destination,
      }
    },
  )
  return {
    legIndex,
    mode: 'SUBWAY',
    status: 'unavailable',
    dataFreshness: freshness,
    accessDurationSeconds,
    accessArrivalAt: toIso(accessArrivalAt),
    platformAccess: 'unknown',
    candidates,
    selectedOrder: null,
    message: '역 입구까지의 순수 보행시간만 계산했습니다. 승강장 접근시간이 없어 실제 탑승은 확인할 수 없습니다.',
  }
}

export function composeTransitBoardingPlan(
  itinerary: TransitItinerary,
  model: WalkingSpeedModel | null,
  arrivals: ArrivalInputs,
  calculatedAt: Date,
): TransitBoardingPlan {
  if (Number.isNaN(calculatedAt.getTime())) throw new Error('INVALID_CALCULATION_TIME')
  const calculatedAtMs = calculatedAt.getTime()
  const walkingLegs: TransitWalkingLegEstimate[] = []
  const boardings: TransitLegBoardingAssessment[] = []
  let cursor = calculatedAtMs
  let accessDurationSeconds = 0
  let priorTransitStarted = false
  let timelineKnown = true

  itinerary.legs.forEach((leg, legIndex) => {
    if (leg.mode === 'WALK') {
      const walking = calculateTransitWalkingLeg(leg, legIndex, model)
      walkingLegs.push(walking)
      accessDurationSeconds += walking.pureWalkingDurationSeconds
      if (timelineKnown) cursor += walking.pureWalkingDurationSeconds * 1_000
      return
    }
    if (leg.mode !== 'BUS' && leg.mode !== 'SUBWAY') {
      timelineKnown = false
      accessDurationSeconds = 0
      return
    }
    if (!timelineKnown || priorTransitStarted) {
      boardings.push(unavailableAssessment(
        legIndex,
        leg.mode,
        'requery_required',
        'missing',
        accessDurationSeconds,
        timelineKnown ? cursor : null,
        '미래 환승 시점의 현재 실시간 응답은 사용할 수 없습니다. 환승 시 다시 조회해야 합니다.',
      ))
      timelineKnown = false
      accessDurationSeconds = 0
      return
    }

    const assessment = leg.mode === 'BUS'
      ? assessBus(
        legIndex,
        arrivals.bus.get(legIndex),
        calculatedAtMs,
        accessDurationSeconds,
        cursor,
      )
      : assessSubway(
        legIndex,
        arrivals.subway.get(legIndex),
        calculatedAtMs,
        accessDurationSeconds,
        cursor,
      )
    boardings.push(assessment)
    const selected = assessment.candidates.find(
      (candidate) => candidate.order === assessment.selectedOrder,
    )
    if (selected === undefined) {
      timelineKnown = false
    } else {
      cursor = new Date(selected.serviceArrivalAt).getTime()
        + leg.durationSeconds * 1_000
      priorTransitStarted = true
    }
    accessDurationSeconds = 0
  })

  return {
    calculatedAt: calculatedAt.toISOString(),
    walkingLegs,
    boardings,
    finalArrivalAt: timelineKnown && !priorTransitStarted ? toIso(cursor) : null,
  }
}
