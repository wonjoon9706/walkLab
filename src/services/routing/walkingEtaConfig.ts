export interface WalkingEtaConfig {
  defaultWalkingSpeedMps: number
  minimumRouteDistanceM: number
}

export const walkingEtaConfig: WalkingEtaConfig = {
  // 개인 학습값이 준비되지 않았을 때 사용하는 4.8km/h 기준속도다.
  defaultWalkingSpeedMps: 4.8 / 3.6,
  minimumRouteDistanceM: 10,
}
