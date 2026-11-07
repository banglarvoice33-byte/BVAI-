const DEFAULT_MIN_REMAINING_MS = 1_000
const DEFAULT_SAFETY_MARGIN_MS = 250

export function sideEffectBudgetMs(
  deadline: number,
  now = Date.now(),
  minRemainingMs = DEFAULT_MIN_REMAINING_MS,
  safetyMarginMs = DEFAULT_SAFETY_MARGIN_MS,
): number | null {
  const remainingMs = deadline - now
  if (remainingMs <= minRemainingMs) return null
  return Math.max(minRemainingMs, remainingMs - safetyMarginMs)
}
