import { describe, expect, it } from 'vitest'
import { getAuthErrorMessage } from './authErrorMessage'

describe('인증 오류 메시지', () => {
  it('잘못되거나 만료된 인증번호를 구분해 안내한다', () => {
    const message = getAuthErrorMessage(
      { code: 'otp_expired' },
      'verifyOtp',
    )

    expect(message).toContain('잘못되었거나 만료')
  })

  it('이메일 발송 제한을 안내한다', () => {
    const message = getAuthErrorMessage(
      { code: 'over_email_send_rate_limit' },
      'requestOtp',
    )

    expect(message).toContain('요청이 너무 많습니다')
  })

  it('네트워크 실패에 원본 오류 내용을 노출하지 않는다', () => {
    const message = getAuthErrorMessage(
      new TypeError('Failed to fetch secret details'),
      'requestOtp',
    )

    expect(message).toBe('네트워크 연결을 확인한 뒤 다시 시도해 주세요.')
    expect(message).not.toContain('secret details')
  })
})
