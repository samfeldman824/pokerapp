import { describe, it, expect } from 'vitest'
import { Suit, Rank, GamePhase } from '@/engine/types'
import type { Card } from '@/engine/types'
import {
  FLOP_STAGGER,
  PER_CARD_REVEAL_DURATION,
  REVEAL_SETTLE_BUFFER,
  TURN_RIVER_DELAY,
  getBoardSnapshotKey,
  detectNewIndices,
  isResetCondition,
  getRevealSchedule,
} from './communityCardReveal'

describe('communityCardReveal', () => {
  describe('timing constants', () => {
    it('FLOP_STAGGER should be 90ms', () => {
      expect(FLOP_STAGGER).toBe(90)
    })

    it('PER_CARD_REVEAL_DURATION should be 260ms', () => {
      expect(PER_CARD_REVEAL_DURATION).toBe(260)
    })

    it('REVEAL_SETTLE_BUFFER should be 120ms', () => {
      expect(REVEAL_SETTLE_BUFFER).toBe(120)
    })

    it('TURN_RIVER_DELAY should be 0ms', () => {
      expect(TURN_RIVER_DELAY).toBe(0)
    })
  })

  describe('getRevealSchedule', () => {
    it('returns empty array for empty input', () => {
      expect(getRevealSchedule([])).toEqual([])
    })

    it('returns flop schedule with stagger for indices [0,1,2]', () => {
      const schedule = getRevealSchedule([0, 1, 2])
      expect(schedule).toEqual([
        { index: 0, delay: 0 },
        { index: 1, delay: 90 },
        { index: 2, delay: 180 },
      ])
    })

    it('returns turn schedule with no delay for index [3]', () => {
      const schedule = getRevealSchedule([3])
      expect(schedule).toEqual([{ index: 3, delay: 0 }])
    })

    it('returns river schedule with no delay for index [4]', () => {
      const schedule = getRevealSchedule([4])
      expect(schedule).toEqual([{ index: 4, delay: 0 }])
    })
  })

  describe('isResetCondition', () => {
    const emptyCards: Card[] = []
    const threeCards: Card[] = [
      { suit: Suit.Hearts, rank: Rank.Ace },
      { suit: Suit.Diamonds, rank: Rank.King },
      { suit: Suit.Clubs, rank: Rank.Queen },
    ]

    it('returns true for Waiting phase', () => {
      expect(isResetCondition(GamePhase.Waiting, threeCards)).toBe(true)
    })

    it('returns true for Preflop phase', () => {
      expect(isResetCondition(GamePhase.Preflop, threeCards)).toBe(true)
    })

    it('returns true for empty cards', () => {
      expect(isResetCondition(GamePhase.Flop, emptyCards)).toBe(true)
    })

    it('returns false for Flop phase with cards', () => {
      expect(isResetCondition(GamePhase.Flop, threeCards)).toBe(false)
    })

    it('returns false for Turn phase with cards', () => {
      expect(isResetCondition(GamePhase.Turn, threeCards)).toBe(false)
    })

    it('returns false for River phase with cards', () => {
      expect(isResetCondition(GamePhase.River, threeCards)).toBe(false)
    })

    it('returns false for Showdown phase with cards', () => {
      expect(isResetCondition(GamePhase.Showdown, threeCards)).toBe(false)
    })
  })

  describe('detectNewIndices', () => {
    it('returns empty array when boards are identical', () => {
      const cards: Card[] = [
        { suit: Suit.Hearts, rank: Rank.Ace },
        { suit: Suit.Diamonds, rank: Rank.King },
      ]
      expect(detectNewIndices(cards, cards)).toEqual([])
    })

    it('returns empty array when next is smaller than prev', () => {
      const prev: Card[] = [
        { suit: Suit.Hearts, rank: Rank.Ace },
        { suit: Suit.Diamonds, rank: Rank.King },
      ]
      const next: Card[] = [{ suit: Suit.Hearts, rank: Rank.Ace }]
      expect(detectNewIndices(prev, next)).toEqual([])
    })

    it('returns [3] when a 4th card is added (turn)', () => {
      const prev: Card[] = [
        { suit: Suit.Hearts, rank: Rank.Ace },
        { suit: Suit.Diamonds, rank: Rank.King },
        { suit: Suit.Clubs, rank: Rank.Queen },
      ]
      const next: Card[] = [
        { suit: Suit.Hearts, rank: Rank.Ace },
        { suit: Suit.Diamonds, rank: Rank.King },
        { suit: Suit.Clubs, rank: Rank.Queen },
        { suit: Suit.Spades, rank: Rank.Jack },
      ]
      expect(detectNewIndices(prev, next)).toEqual([3])
    })

    it('returns [4] when a 5th card is added (river)', () => {
      const prev: Card[] = [
        { suit: Suit.Hearts, rank: Rank.Ace },
        { suit: Suit.Diamonds, rank: Rank.King },
        { suit: Suit.Clubs, rank: Rank.Queen },
        { suit: Suit.Spades, rank: Rank.Jack },
      ]
      const next: Card[] = [
        { suit: Suit.Hearts, rank: Rank.Ace },
        { suit: Suit.Diamonds, rank: Rank.King },
        { suit: Suit.Clubs, rank: Rank.Queen },
        { suit: Suit.Spades, rank: Rank.Jack },
        { suit: Suit.Hearts, rank: Rank.Ten },
      ]
      expect(detectNewIndices(prev, next)).toEqual([4])
    })

    it('returns [0,1,2] when flop is dealt from empty', () => {
      const prev: Card[] = []
      const next: Card[] = [
        { suit: Suit.Hearts, rank: Rank.Ace },
        { suit: Suit.Diamonds, rank: Rank.King },
        { suit: Suit.Clubs, rank: Rank.Queen },
      ]
      expect(detectNewIndices(prev, next)).toEqual([0, 1, 2])
    })
  })

  describe('getBoardSnapshotKey', () => {
    it('returns same key for identical cards and hand number', () => {
      const cards: Card[] = [
        { suit: Suit.Hearts, rank: Rank.Ace },
        { suit: Suit.Diamonds, rank: Rank.King },
      ]
      const key1 = getBoardSnapshotKey(cards, 1)
      const key2 = getBoardSnapshotKey(cards, 1)
      expect(key1).toBe(key2)
    })

    it('returns different key for different hand numbers', () => {
      const cards: Card[] = [
        { suit: Suit.Hearts, rank: Rank.Ace },
        { suit: Suit.Diamonds, rank: Rank.King },
      ]
      const key1 = getBoardSnapshotKey(cards, 1)
      const key2 = getBoardSnapshotKey(cards, 2)
      expect(key1).not.toBe(key2)
    })

    it('returns different key for different cards', () => {
      const cards1: Card[] = [
        { suit: Suit.Hearts, rank: Rank.Ace },
        { suit: Suit.Diamonds, rank: Rank.King },
      ]
      const cards2: Card[] = [
        { suit: Suit.Hearts, rank: Rank.Ace },
        { suit: Suit.Diamonds, rank: Rank.Queen },
      ]
      const key1 = getBoardSnapshotKey(cards1, 1)
      const key2 = getBoardSnapshotKey(cards2, 1)
      expect(key1).not.toBe(key2)
    })

    it('returns deterministic string format', () => {
      const cards: Card[] = [{ suit: Suit.Hearts, rank: Rank.Ace }]
      const key = getBoardSnapshotKey(cards, 5)
      expect(typeof key).toBe('string')
      expect(key).toMatch(/^\d+:/)
    })
  })
})
