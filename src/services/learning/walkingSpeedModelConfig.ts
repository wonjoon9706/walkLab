export interface WalkingSpeedModelConfig {
  primaryWindowDays: 30
  fallbackWindowDays: 90
  minimumTrainingSessions: number
  weightHalfLifeDays: number
  maximumSessionWeight: number
  minimumBacktestCases: number
}

export const walkingSpeedModelConfig: WalkingSpeedModelConfig = {
  primaryWindowDays: 30,
  fallbackWindowDays: 90,
  minimumTrainingSessions: 3,
  weightHalfLifeDays: 30,
  maximumSessionWeight: 0.5,
  minimumBacktestCases: 2,
}
