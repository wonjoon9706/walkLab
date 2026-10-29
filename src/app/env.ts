export interface PublicEnvironment {
  supabaseUrl: string | null
  supabasePublishableKey: string | null
  mapStyleUrl: string | null
  mapTilerApiKey: string | null
  emailOtpLength: number
}

type EnvironmentSource = Record<string, string | boolean | undefined>

const DEFAULT_OTP_LENGTH = 6

function readOptionalText(value: string | boolean | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? trimmedValue : null
}

function readOtpLength(value: string | boolean | undefined): number {
  const textValue = readOptionalText(value)
  const parsedValue = Number(textValue)

  if (Number.isInteger(parsedValue) && parsedValue >= 6 && parsedValue <= 10) {
    return parsedValue
  }

  return DEFAULT_OTP_LENGTH
}

export function readPublicEnvironment(
  source: EnvironmentSource,
): PublicEnvironment {
  return {
    supabaseUrl: readOptionalText(source.VITE_SUPABASE_URL),
    supabasePublishableKey: readOptionalText(
      source.VITE_SUPABASE_PUBLISHABLE_KEY,
    ),
    mapStyleUrl: readOptionalText(source.VITE_MAP_STYLE_URL),
    mapTilerApiKey: readOptionalText(source.VITE_MAPTILER_API_KEY),
    emailOtpLength: readOtpLength(source.VITE_EMAIL_OTP_LENGTH),
  }
}

export function findMissingEnvironmentVariables(
  environment: PublicEnvironment,
): string[] {
  const missingVariables: string[] = []

  if (environment.supabaseUrl === null) {
    missingVariables.push('VITE_SUPABASE_URL')
  }

  if (environment.supabasePublishableKey === null) {
    missingVariables.push('VITE_SUPABASE_PUBLISHABLE_KEY')
  }

  if (environment.mapStyleUrl === null) {
    missingVariables.push('VITE_MAP_STYLE_URL')
  }

  if (environment.mapTilerApiKey === null) {
    missingVariables.push('VITE_MAPTILER_API_KEY')
  }

  return missingVariables
}

export const publicEnvironment = readPublicEnvironment(import.meta.env)
