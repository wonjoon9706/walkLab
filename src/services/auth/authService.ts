import type {
  AuthChangeEvent,
  Session,
  SupabaseClient,
  User,
} from '@supabase/supabase-js'
import { supabaseClient } from '../../repositories/remote/supabaseClient'

export interface AuthenticatedUser {
  id: string
  email: string | null
}

export interface AuthChange {
  event: AuthChangeEvent
  user: AuthenticatedUser | null
}

export interface AuthService {
  requestEmailOtp: (email: string) => Promise<void>
  verifyEmailOtp: (
    email: string,
    token: string,
  ) => Promise<AuthenticatedUser>
  getCurrentUser: () => Promise<AuthenticatedUser | null>
  refreshCurrentUser: () => Promise<AuthenticatedUser | null>
  subscribeToAuthChanges: (
    listener: (change: AuthChange) => void,
  ) => () => void
  signOut: () => Promise<void>
}

function requireSupabaseClient(
  client: SupabaseClient | null,
): SupabaseClient {
  if (client === null) {
    throw new Error('SUPABASE_NOT_CONFIGURED')
  }

  return client
}

function toAuthenticatedUser(user: User): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email ?? null,
  }
}

function getUserFromSession(session: Session | null): AuthenticatedUser | null {
  return session === null ? null : toAuthenticatedUser(session.user)
}

export function createAuthService(
  client: SupabaseClient | null,
): AuthService {
  return {
    async requestEmailOtp(email) {
      const configuredClient = requireSupabaseClient(client)
      const { error } = await configuredClient.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
        },
      })

      if (error !== null) {
        throw error
      }
    },

    async verifyEmailOtp(email, token) {
      const configuredClient = requireSupabaseClient(client)
      const { data, error } = await configuredClient.auth.verifyOtp({
        email,
        token,
        type: 'email',
      })

      if (error !== null) {
        throw error
      }

      if (data.user === null) {
        throw new Error('AUTH_USER_MISSING')
      }

      return toAuthenticatedUser(data.user)
    },

    async getCurrentUser() {
      const configuredClient = requireSupabaseClient(client)
      const { data: sessionData, error: sessionError } =
        await configuredClient.auth.getSession()

      if (sessionError !== null) {
        throw sessionError
      }

      if (sessionData.session === null) {
        return null
      }

      // 보호 화면을 열기 전 서버가 검증한 현재 사용자를 다시 확인한다.
      const { data: userData, error: userError } =
        await configuredClient.auth.getUser()

      if (userError !== null) {
        throw userError
      }

      return userData.user === null
        ? null
        : toAuthenticatedUser(userData.user)
    },

    async refreshCurrentUser() {
      const configuredClient = requireSupabaseClient(client)
      const { data, error } = await configuredClient.auth.refreshSession()

      if (error !== null) {
        throw error
      }

      return getUserFromSession(data.session)
    },

    subscribeToAuthChanges(listener) {
      if (client === null) {
        return () => undefined
      }

      const configuredClient = client
      const { data } = configuredClient.auth.onAuthStateChange(
        (event, session) => {
          listener({
            event,
            user: getUserFromSession(session),
          })
        },
      )

      return () => {
        data.subscription.unsubscribe()
      }
    },

    async signOut() {
      const configuredClient = requireSupabaseClient(client)
      const { error } = await configuredClient.auth.signOut()

      if (error !== null) {
        throw error
      }
    },
  }
}

export const authService = createAuthService(supabaseClient)
