import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../features/auth/AuthProvider'
import type { AuthService } from '../services/auth/authService'
import { createFakeAuthService } from '../test/fakeAuthService'
import { LoginPage } from './LoginPage'

function renderLogin(service: AuthService) {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider service={service}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<h1>로그인 성공 화면</h1>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

async function requestOtp(service: AuthService) {
  renderLogin(service)
  const emailInput = await screen.findByLabelText('이메일 주소')

  fireEvent.change(emailInput, {
    target: { value: 'walker@example.com' },
  })
  fireEvent.click(screen.getByRole('button', { name: '인증번호 받기' }))

  await screen.findByLabelText('인증번호')
}

afterEach(() => {
  vi.useRealTimers()
})

describe('이메일 OTP 로그인 화면', () => {
  it('정상 이메일로 OTP를 요청하고 60초 재요청 제한을 표시한다', async () => {
    const service = createFakeAuthService()

    await requestOtp(service)

    expect(service.requestEmailOtp).toHaveBeenCalledWith(
      'walker@example.com',
    )
    expect(
      screen.getByRole('button', { name: '60초 후 다시 요청' }),
    ).toBeDisabled()
  })

  it('잘못된 이메일은 서버에 요청하지 않는다', async () => {
    const service = createFakeAuthService()
    renderLogin(service)
    const emailInput = await screen.findByLabelText('이메일 주소')

    fireEvent.change(emailInput, { target: { value: 'wrong-email' } })
    fireEvent.click(screen.getByRole('button', { name: '인증번호 받기' }))

    expect(
      await screen.findByText('올바른 이메일 주소를 입력해 주세요.'),
    ).toBeInTheDocument()
    expect(service.requestEmailOtp).not.toHaveBeenCalled()
  })

  it('6자리 OTP 검증 성공 후 홈으로 이동한다', async () => {
    const service = createFakeAuthService()
    await requestOtp(service)
    const otpInput = screen.getByLabelText('인증번호')

    fireEvent.change(otpInput, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '인증번호 확인' }))

    expect(
      await screen.findByRole('heading', { name: '로그인 성공 화면' }),
    ).toBeInTheDocument()
    expect(service.verifyEmailOtp).toHaveBeenCalledWith(
      'walker@example.com',
      '123456',
    )
  })

  it('잘못되거나 만료된 OTP 오류를 표시하고 입력값을 제거한다', async () => {
    const service = createFakeAuthService({
      verifyEmailOtp: vi.fn().mockRejectedValue({ code: 'otp_expired' }),
    })
    await requestOtp(service)
    const otpInput = screen.getByLabelText('인증번호')

    fireEvent.change(otpInput, { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: '인증번호 확인' }))

    expect(
      await screen.findByText(
        '인증번호가 잘못되었거나 만료되었습니다. 새 인증번호를 요청해 주세요.',
      ),
    ).toBeInTheDocument()
    expect(otpInput).toHaveValue('')
  })

  it('OTP와 토큰을 화면 코드에서 별도 저장하거나 출력하지 않는다', async () => {
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const service = createFakeAuthService()

    await requestOtp(service)
    const otpInput = screen.getByLabelText('인증번호')
    fireEvent.change(otpInput, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '인증번호 확인' }))
    await waitFor(() => {
      expect(service.verifyEmailOtp).toHaveBeenCalledOnce()
    })

    expect(storageSpy).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()

    storageSpy.mockRestore()
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })
})
