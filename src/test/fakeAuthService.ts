import { vi } from 'vitest'
import type {
  AuthenticatedUser,
  AuthService,
} from '../services/auth/authService'

export const testUser: AuthenticatedUser = {
  id: 'test-user-id',
  email: 'walker@example.com',
}

export function createFakeAuthService(
  overrides: Partial<AuthService> = {},
): AuthService {
  return {
    requestEmailOtp: vi.fn().mockResolvedValue(undefined),
    verifyEmailOtp: vi.fn().mockResolvedValue(testUser),
    getCurrentUser: vi.fn().mockResolvedValue(null),
    subscribeToAuthChanges: vi.fn(() => () => undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}
