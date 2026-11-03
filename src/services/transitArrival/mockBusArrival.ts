import type {
  BusArrivalInfo,
  BusArrivalLookupStatus,
} from '../../domain/busArrival'
import type { TransitItinerary } from '../../domain/transitRoute'

export interface MockBusArrivalResult {
  legIndex: number
  arrival: BusArrivalInfo
}

function createStatusMessageData(
  itinerary: TransitItinerary,
  legIndex: number,
  fetchedAt: Date,
  status: BusArrivalLookupStatus,
): MockBusArrivalResult {
  const leg = itinerary.legs[legIndex]
  const boardingStop = leg.stops?.[0]
  const base = {
    routeName: leg.routeName ?? '노선 정보 없음',
    stopName: boardingStop?.name ?? leg.startName,
    fetchedAt: fetchedAt.toISOString(),
    provider: 'tago' as const,
    dataMode: 'mock' as const,
    walkingTimeToStopSeconds: null,
  }
  if (status === 'available') {
    return {
      legIndex,
      arrival: {
        ...base,
        stopId: `MOCK-TAGO-${legIndex + 1}`,
        arrivalSeconds: 360 + legIndex * 60,
        remainingStops: 3 + legIndex,
        status,
      },
    }
  }
  return {
    legIndex,
    arrival: {
      ...base,
      stopId: null,
      arrivalSeconds: null,
      remainingStops: null,
      status,
    },
  }
}

export function createMockBusArrivals(
  itinerary: TransitItinerary,
  fetchedAt: Date = new Date(),
  statuses: Partial<Record<number, BusArrivalLookupStatus>> = {},
): MockBusArrivalResult[] {
  return itinerary.legs.flatMap((leg, legIndex) =>
    leg.mode === 'BUS'
      ? [createStatusMessageData(
          itinerary,
          legIndex,
          fetchedAt,
          statuses[legIndex] ?? 'available',
        )]
      : [],
  )
}
