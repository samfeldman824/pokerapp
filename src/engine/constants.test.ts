import { describe, expect, it } from 'vitest'

import { CONFIG_LIMITS, DEFAULT_CONFIG } from './constants'
import { GameConfig } from './types'

describe('DEFAULT_CONFIG', () => {
  it('has betweenHandsDelay of 3', () => {
    expect(DEFAULT_CONFIG.betweenHandsDelay).toBe(3)
  })

  it('has expected default values for all fields', () => {
    expect(DEFAULT_CONFIG.smallBlind).toBe(1)
    expect(DEFAULT_CONFIG.bigBlind).toBe(2)
    expect(DEFAULT_CONFIG.startingStack).toBe(1000)
    expect(DEFAULT_CONFIG.timePerAction).toBe(30)
    expect(DEFAULT_CONFIG.maxPlayers).toBe(9)
  })
})

describe('CONFIG_LIMITS.betweenHandsDelay', () => {
  it('has min of 2', () => {
    expect(CONFIG_LIMITS.betweenHandsDelay.min).toBe(2)
  })

  it('has max of 15', () => {
    expect(CONFIG_LIMITS.betweenHandsDelay.max).toBe(15)
  })

  it('default value is within limits', () => {
    expect(DEFAULT_CONFIG.betweenHandsDelay).toBeGreaterThanOrEqual(CONFIG_LIMITS.betweenHandsDelay.min)
    expect(DEFAULT_CONFIG.betweenHandsDelay).toBeLessThanOrEqual(CONFIG_LIMITS.betweenHandsDelay.max)
  })
})

describe('GameConfig betweenHandsDelay validation', () => {
  it('accepts a value of 10 (within limits)', () => {
    const config: GameConfig = {
      ...DEFAULT_CONFIG,
      betweenHandsDelay: 10,
    }
    expect(config.betweenHandsDelay).toBe(10)
    expect(config.betweenHandsDelay).toBeGreaterThanOrEqual(CONFIG_LIMITS.betweenHandsDelay.min)
    expect(config.betweenHandsDelay).toBeLessThanOrEqual(CONFIG_LIMITS.betweenHandsDelay.max)
  })

  it('value of 1 is below the minimum limit of 2', () => {
    const value = 1
    expect(value).toBeLessThan(CONFIG_LIMITS.betweenHandsDelay.min)
  })

  it('value of 16 is above the maximum limit of 15', () => {
    const value = 16
    expect(value).toBeGreaterThan(CONFIG_LIMITS.betweenHandsDelay.max)
  })

  it('boundary value of 2 is at the minimum limit', () => {
    const value = 2
    expect(value).toBeGreaterThanOrEqual(CONFIG_LIMITS.betweenHandsDelay.min)
    expect(value).toBeLessThanOrEqual(CONFIG_LIMITS.betweenHandsDelay.max)
  })

  it('boundary value of 15 is at the maximum limit', () => {
    const value = 15
    expect(value).toBeGreaterThanOrEqual(CONFIG_LIMITS.betweenHandsDelay.min)
    expect(value).toBeLessThanOrEqual(CONFIG_LIMITS.betweenHandsDelay.max)
  })
})
