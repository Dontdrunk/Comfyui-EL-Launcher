export interface DepSummaryLike {
  total: number
  missing: number
  error?: string | null
}

export function depDot(
  hasRequirements: boolean,
  summary: DepSummaryLike | null | undefined
): { tone: 'idle' | 'ok' | 'warn' | 'error'; hint: string } | null
