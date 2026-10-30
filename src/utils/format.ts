const koreanDateTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

export function formatKoreanDateTime(isoDateTime: string): string {
  const date = new Date(isoDateTime)
  return Number.isNaN(date.getTime())
    ? '시간 정보 없음'
    : koreanDateTimeFormatter.format(date)
}

export function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null || !Number.isFinite(totalSeconds)) {
    return '계산할 수 없음'
  }

  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60

  if (hours > 0) {
    return `${hours}시간 ${minutes}분 ${remainingSeconds}초`
  }
  if (minutes > 0) {
    return `${minutes}분 ${remainingSeconds}초`
  }
  return `${remainingSeconds}초`
}

export function formatDistance(distanceM: number): string {
  return distanceM >= 1000
    ? `${(distanceM / 1000).toFixed(2)} km`
    : `${Math.round(distanceM)} m`
}

export function formatSpeed(speedMps: number | null): string {
  return speedMps === null ? '계산할 수 없음' : `${(speedMps * 3.6).toFixed(2)} km/h`
}

export function formatPace(paceSecondsPerKm: number | null): string {
  if (paceSecondsPerKm === null || !Number.isFinite(paceSecondsPerKm)) {
    return '계산할 수 없음'
  }

  const seconds = Math.max(0, Math.round(paceSecondsPerKm))
  const minutesPart = Math.floor(seconds / 60)
  const secondsPart = (seconds % 60).toString().padStart(2, '0')
  return `${minutesPart}:${secondsPart} /km`
}
