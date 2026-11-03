export interface SeoulSubwayArrivalRecord {
  subwayId: string
  stationName: string
  upDownLine: string
  trainLineName: string
  trainStatus: string | null
  arrivalSeconds: number
  generatedAt: string
  arrivalStatusCode: string
  arrivalMessage: string
}
