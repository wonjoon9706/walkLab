import { createContext, useContext } from 'react'
import type {
  MeasurementMode,
  MeasurementState,
} from './measurementManager'

export interface MeasurementContextValue extends MeasurementState {
  isActive: boolean
  startMeasurement: (mode?: MeasurementMode) => Promise<boolean>
  stopMeasurement: () => Promise<void>
  subscribeGps: (
    onPosition: PositionCallback,
    onError: PositionErrorCallback,
  ) => () => void
}

export const MeasurementContext =
  createContext<MeasurementContextValue | null>(null)

export function useMeasurement(): MeasurementContextValue {
  const context = useContext(MeasurementContext)

  if (context === null) {
    throw new Error('useMeasurement는 MeasurementProvider 안에서 사용해야 합니다.')
  }

  return context
}
