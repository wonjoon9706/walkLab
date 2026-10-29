import { type FormEvent, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { publicEnvironment } from '../app/env'
import { useAuth } from '../features/auth/authContext'
import { getAuthErrorMessage } from '../services/auth/authErrorMessage'

type LoginStep = 'email' | 'otp'
type LoginProgress = 'idle' | 'sending' | 'verifying'

const RESEND_WAIT_SECONDS = 60

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function readRequestedPath(state: unknown): string {
  if (typeof state !== 'object' || state === null) {
    return '/'
  }

  const from = (state as Record<string, unknown>).from
  return typeof from === 'string' && from.startsWith('/') ? from : '/'
}

export function LoginPage() {
  const {
    message: sessionMessage,
    requestEmailOtp,
    verifyEmailOtp,
  } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [step, setStep] = useState<LoginStep>('email')
  const [progress, setProgress] = useState<LoginProgress>('idle')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [informationMessage, setInformationMessage] = useState<string | null>(
    null,
  )
  const [resendSeconds, setResendSeconds] = useState(0)
  const otpLength = publicEnvironment.emailOtpLength

  useEffect(() => {
    if (resendSeconds <= 0) {
      return
    }

    const timerId = window.setTimeout(() => {
      setResendSeconds((currentSeconds) => currentSeconds - 1)
    }, 1000)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [resendSeconds])

  async function sendOtp() {
    const normalizedEmail = email.trim()

    if (!isValidEmail(normalizedEmail)) {
      setErrorMessage('올바른 이메일 주소를 입력해 주세요.')
      return
    }

    setProgress('sending')
    setErrorMessage(null)
    setInformationMessage(null)

    try {
      await requestEmailOtp(normalizedEmail)
      setEmail(normalizedEmail)
      setOtp('')
      setStep('otp')
      setResendSeconds(RESEND_WAIT_SECONDS)
      setInformationMessage(
        '이메일로 인증번호를 보냈습니다. 받은 번호를 입력해 주세요.',
      )
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error, 'requestOtp'))
    } finally {
      setProgress('idle')
    }
  }

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await sendOtp()
  }

  async function handleOtpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (otp.length !== otpLength) {
      setErrorMessage(`${otpLength}자리 인증번호를 입력해 주세요.`)
      return
    }

    setProgress('verifying')
    setErrorMessage(null)
    setInformationMessage(null)

    try {
      await verifyEmailOtp(email, otp)
      const requestedPath = readRequestedPath(location.state)
      navigate(requestedPath, { replace: true })
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error, 'verifyOtp'))
    } finally {
      // 검증 결과와 관계없이 OTP 원문은 화면 메모리에서 바로 제거한다.
      setOtp('')
      setProgress('idle')
    }
  }

  async function handleResend() {
    if (resendSeconds > 0 || progress !== 'idle') {
      return
    }

    await sendOtp()
  }

  function handleEmailChange() {
    setStep('email')
    setOtp('')
    setErrorMessage(null)
    setInformationMessage(null)
  }

  const displayedMessage = errorMessage ?? sessionMessage

  return (
    <main className="page-shell login-page">
      <p className="eyebrow">WalkLab</p>
      <h1>이메일 OTP 로그인</h1>
      <p className="page-description">
        이메일로 받은 일회용 인증번호를 입력하면 WalkLab을 사용할 수
        있습니다.
      </p>

      {step === 'email' ? (
        <form className="auth-form" onSubmit={handleEmailSubmit} noValidate>
          <label htmlFor="email">이메일 주소</label>
          <input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={progress !== 'idle'}
            placeholder="name@example.com"
            required
          />
          <button type="submit" disabled={progress !== 'idle'}>
            {progress === 'sending' ? '보내는 중…' : '인증번호 받기'}
          </button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={handleOtpSubmit} noValidate>
          <div className="email-summary">
            <span>{email}</span>
            <button
              className="text-button"
              type="button"
              onClick={handleEmailChange}
              disabled={progress !== 'idle'}
            >
              이메일 변경
            </button>
          </div>

          <label htmlFor="otp">인증번호</label>
          <input
            id="otp"
            name="otp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={otpLength}
            value={otp}
            onChange={(event) => {
              const numericOtp = event.target.value.replace(/\D/g, '')
              setOtp(numericOtp.slice(0, otpLength))
            }}
            disabled={progress !== 'idle'}
            placeholder={`${otpLength}자리 숫자`}
            required
          />

          <button type="submit" disabled={progress !== 'idle'}>
            {progress === 'verifying' ? '확인 중…' : '인증번호 확인'}
          </button>

          <button
            className="secondary-button"
            type="button"
            onClick={handleResend}
            disabled={resendSeconds > 0 || progress !== 'idle'}
          >
            {resendSeconds > 0
              ? `${resendSeconds}초 후 다시 요청`
              : '인증번호 다시 받기'}
          </button>
        </form>
      )}

      {informationMessage !== null && (
        <p className="auth-message success-message" role="status">
          {informationMessage}
        </p>
      )}

      {displayedMessage !== null && (
        <p className="auth-message error-message" role="alert">
          {displayedMessage}
        </p>
      )}
    </main>
  )
}
