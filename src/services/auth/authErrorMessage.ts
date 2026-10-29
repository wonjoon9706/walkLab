export type AuthOperation =
  | 'requestOtp'
  | 'verifyOtp'
  | 'restoreSession'
  | 'signOut'

interface ErrorDetails {
  code: string | null
  name: string | null
  message: string | null
}

function readErrorDetails(error: unknown): ErrorDetails {
  if (typeof error !== 'object' || error === null) {
    return { code: null, name: null, message: null }
  }

  const errorRecord = error as Record<string, unknown>

  return {
    code: typeof errorRecord.code === 'string' ? errorRecord.code : null,
    name: typeof errorRecord.name === 'string' ? errorRecord.name : null,
    message:
      typeof errorRecord.message === 'string' ? errorRecord.message : null,
  }
}

function isNetworkError(details: ErrorDetails): boolean {
  const message = details.message?.toLowerCase() ?? ''

  return (
    details.name === 'TypeError' ||
    details.name === 'AuthRetryableFetchError' ||
    message.includes('fetch') ||
    message.includes('network')
  )
}

export function getAuthErrorMessage(
  error: unknown,
  operation: AuthOperation,
): string {
  const details = readErrorDetails(error)

  if (details.message === 'SUPABASE_NOT_CONFIGURED') {
    return 'Supabase 연결 설정을 확인해 주세요.'
  }

  if (isNetworkError(details)) {
    return '네트워크 연결을 확인한 뒤 다시 시도해 주세요.'
  }

  if (
    details.code === 'over_email_send_rate_limit' ||
    details.code === 'over_request_rate_limit'
  ) {
    return '요청이 너무 많습니다. 잠시 기다린 뒤 다시 시도해 주세요.'
  }

  if (details.code === 'otp_expired') {
    return '인증번호가 잘못되었거나 만료되었습니다. 새 인증번호를 요청해 주세요.'
  }

  if (
    details.code === 'email_address_invalid' ||
    details.code === 'validation_failed'
  ) {
    return '올바른 이메일 주소를 입력해 주세요.'
  }

  if (
    details.code === 'session_not_found' ||
    details.code === 'refresh_token_not_found' ||
    details.code === 'refresh_token_already_used'
  ) {
    return '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.'
  }

  if (operation === 'requestOtp') {
    return '인증번호를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.'
  }

  if (operation === 'verifyOtp') {
    return '인증번호를 확인하지 못했습니다. 다시 입력해 주세요.'
  }

  if (operation === 'signOut') {
    return '로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.'
  }

  return '로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.'
}
