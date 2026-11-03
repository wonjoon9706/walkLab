import type { TransitMode } from './transitRoute'
import type { WalkingSpeedProfile } from './walkingRoute'

export type BoardingLikelihood =
  | 'likely'
  | 'tight'
  | 'unlikely'
  | 'unavailable'
  | 'requery_required'

export type LiveDataFreshness = 'fresh' | 'stale' | 'missing'

export interface TransitWalkingLegEstimate {
  legIndex: number
  distanceM: number
  tmapDurationSeconds: number
  pureWalkingDurationSeconds: number
  speedProfile: WalkingSpeedProfile
  /** TMAP sectionTime의 대기·접근시간 포함 범위가 확인되지 않아 두 값을 합산하지 않는다. */
  unverifiedOverheadSeconds: null
}

export interface BoardingCandidateAssessment {
  order: 1 | 2 | 3 | 4
  serviceArrivalAt: string
  accessArrivalAt: string
  marginSeconds: number
  likelihood: BoardingLikelihood
  destination: string | null
}

export interface TransitLegBoardingAssessment {
  legIndex: number
  mode: Extract<TransitMode, 'BUS' | 'SUBWAY'>
  status: BoardingLikelihood
  dataFreshness: LiveDataFreshness
  accessDurationSeconds: number
  accessArrivalAt: string | null
  platformAccess: 'not_required' | 'unknown'
  candidates: BoardingCandidateAssessment[]
  selectedOrder: 1 | 2 | null
  message: string
}

export interface TransitBoardingPlan {
  calculatedAt: string
  walkingLegs: TransitWalkingLegEstimate[]
  boardings: TransitLegBoardingAssessment[]
  /** 모든 실시간 근거가 확보된 경우에만 값이 생긴다. */
  finalArrivalAt: string | null
}
