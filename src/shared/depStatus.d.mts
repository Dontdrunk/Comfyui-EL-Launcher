export interface DepSummaryLike {
  total: number
  missing: number
  error?: string | null
}

export function depVisualTone(
  hasRequirements: boolean,
  summary: DepSummaryLike | null | undefined
): 'busy' | 'none' | 'ok' | 'warn' | 'error'

export function depDot(
  hasRequirements: boolean,
  summary: DepSummaryLike | null | undefined
): { tone: 'idle' | 'ok' | 'warn' | 'error'; hint: string } | null
