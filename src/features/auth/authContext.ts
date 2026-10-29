import { createContext, useContext } from 'react'
import type { AuthenticatedUser } from '../../services/auth/authService'

export type AuthStatus =
  | 'initializing'
  | 'signed_out'
  | 'authenticated'
  | 'expired'
  | 'error'

export interface AuthContextValue {
  status: AuthStatus
  user: AuthenticatedUser | null
  message: string | null
  requestEmailOtp: (email: string) => Promise<void>
  verifyEmailOtp: (email: string, token: string) => Promise<void>
  confirmCurrentUser: () => Promise<AuthenticatedUser | null>
  signOut: () => Promise<boolean>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)

  if (context === null) {
    throw new Error('useAuth는 AuthProvider 안에서 사용해야 합니다.')
  }

  return context
}
