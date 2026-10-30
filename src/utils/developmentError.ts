function getSafeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'UNKNOWN_ERROR'
  }

  return /^[A-Z0-9_]+$/.test(error.message) ? error.message : error.name
}

export function reportDevelopmentError(stage: string, error: unknown): void {
  if (!import.meta.env.DEV) {
    return
  }

  // GPS 원본, 사용자 ID, 인증정보 대신 처리 단계와 안전한 오류 코드만 출력한다.
  console.error(`[WalkLab G5] ${stage}: ${getSafeErrorCode(error)}`)
}
