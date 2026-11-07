import { describe, expect, it } from 'vitest'
import { sideEffectBudgetMs } from '../lib/newsroom-time-budget'

describe('newsroom side-effect budget', () => {
  it('defers work when the request budget is nearly exhausted', () => {
    expect(sideEffectBudgetMs(10_000, 9_100)).toBeNull()
    expect(sideEffectBudgetMs(10_000, 9_000)).toBeNull()
  })

  it('leaves a safety margin before the hosting deadline', () => {
    expect(sideEffectBudgetMs(10_000, 5_000)).toBe(4_750)
  })

  it('never returns a timeout below the minimum when work is allowed', () => {
    expect(sideEffectBudgetMs(10_000, 8_700)).toBe(1_050)
    expect(sideEffectBudgetMs(10_000, 8_999)).toBe(1_000)
  })
})
