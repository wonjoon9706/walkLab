import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  authService as defaultAuthService,
  type AuthChange,
  type AuthService,
} from '../../services/auth/authService'
import { getAuthErrorMessage } from '../../services/auth/authErrorMessage'
import {
  AuthContext,
  type AuthContextValue,
} from './authContext'

interface AuthProviderProps {
  children: ReactNode
  service?: AuthService
  canSignOut?: () => boolean
}

const initialAuthState: Pick<
  AuthContextValue,
  'status' | 'user' | 'message'
> = {
  status: 'initializing',
  user: null,
  message: null,
}

export function AuthProvider({
  children,
  service = defaultAuthService,
  canSignOut = () => true,
}: AuthProviderProps) {
  const [authState, setAuthState] = useState(initialAuthState)
  const initializedRef = useRef(false)
  const explicitSignOutRef = useRef(false)

  const applyAuthChange = useCallback((change: AuthChange) => {
    // 초기 보호 화면은 getUser() 서버 확인이 끝난 뒤에만 열어야 한다.
    if (!initializedRef.current) {
      return
    }

    if (change.user !== null) {
      setAuthState({
        status: 'authenticated',
        user: change.user,
        message: null,
      })
      return
    }

    setAuthState((currentState) => {
      const sessionExpired =
        initializedRef.current &&
        !explicitSignOutRef.current &&
        currentState.status === 'authenticated'

      return {
        status: sessionExpired ? 'expired' : 'signed_out',
        user: null,
        message: sessionExpired
          ? '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.'
          : null,
      }
    })
  }, [])

  useEffect(() => {
    let isMounted = true
    const unsubscribe = service.subscribeToAuthChanges((change) => {
      if (isMounted) {
        applyAuthChange(change)
      }
    })

    async function restoreSession() {
      try {
        const user = await service.getCurrentUser()

        if (!isMounted) {
          return
        }

        initializedRef.current = true
        setAuthState({
          status: user === null ? 'signed_out' : 'authenticated',
          user,
          message: null,
        })
      } catch (error) {
        if (!isMounted) {
          return
        }

        initializedRef.current = true
        setAuthState({
          status: 'error',
          user: null,
          message: getAuthErrorMessage(error, 'restoreSession'),
        })
      }
    }

    void restoreSession()

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [applyAuthChange, service])

  const requestEmailOtp = useCallback(
    async (email: string) => {
      await service.requestEmailOtp(email)
    },
    [service],
  )

  const verifyEmailOtp = useCallback(
    async (email: string, token: string) => {
      const user = await service.verifyEmailOtp(email, token)

      setAuthState({
        status: 'authenticated',
        user,
        message: null,
      })
    },
    [service],
  )

  const signOut = useCallback(async () => {
    // G2 이후 측정 상태가 추가되면 이 guard에 종료 가능 여부를 연결한다.
    if (!canSignOut()) {
      return false
    }

    explicitSignOutRef.current = true

    try {
      await service.signOut()
      setAuthState({
        status: 'signed_out',
        user: null,
        message: null,
      })
      return true
    } finally {
      explicitSignOutRef.current = false
    }
  }, [canSignOut, service])

  const value = useMemo<AuthContextValue>(
    () => ({
      ...authState,
      requestEmailOtp,
      verifyEmailOtp,
      signOut,
    }),
    [authState, requestEmailOtp, signOut, verifyEmailOtp],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
