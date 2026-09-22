import { describe, expect, it } from 'vitest'
import { comboFromEvent, normalizeCombo } from './registry'

function press(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  } as KeyboardEvent
}

describe('normalizeCombo', () => {
  it('orders modifiers canonically regardless of input order', () => {
    expect(normalizeCombo('Shift+Mod+C')).toBe('mod+shift+c')
    expect(normalizeCombo('mod+shift+c')).toBe('mod+shift+c')
  })

  it('lowercases and tolerates stray separators', () => {
    expect(normalizeCombo('MOD+K')).toBe('mod+k')
    expect(normalizeCombo('mod++k')).toBe('mod+k')
  })

  it('handles a bare key', () => {
    expect(normalizeCombo('?')).toBe('?')
    expect(normalizeCombo('Escape')).toBe('escape')
  })
})

describe('comboFromEvent', () => {
  it('maps both Cmd and Ctrl to mod, so one binding covers both platforms', () => {
    expect(comboFromEvent(press({ key: 'k', metaKey: true }))).toBe('mod+k')
    expect(comboFromEvent(press({ key: 'k', ctrlKey: true }))).toBe('mod+k')
  })

  it('records shift for letters', () => {
    expect(comboFromEvent(press({ key: 'c', metaKey: true, shiftKey: true }))).toBe('mod+shift+c')
  })

  it('does not fold shift into punctuation that already requires it', () => {
    // '?' is Shift+/ on most layouts. Recording shift would make it unmatchable.
    expect(comboFromEvent(press({ key: '?', shiftKey: true }))).toBe('?')
  })

  it('normalizes named keys and space', () => {
    expect(comboFromEvent(press({ key: 'Escape' }))).toBe('escape')
    expect(comboFromEvent(press({ key: 'Enter', metaKey: true }))).toBe('mod+enter')
    expect(comboFromEvent(press({ key: ' ' }))).toBe('space')
    expect(comboFromEvent(press({ key: 'ArrowDown', altKey: true }))).toBe('alt+arrowdown')
  })

  it('agrees with normalizeCombo, so declarations match keypresses', () => {
    const cases: Array<[Partial<KeyboardEvent> & { key: string }, string]> = [
      [{ key: 'k', metaKey: true }, 'mod+k'],
      [{ key: 'c', metaKey: true, shiftKey: true }, 'mod+shift+c'],
      [{ key: 'Escape' }, 'escape'],
      [{ key: '1', metaKey: true }, 'mod+1'],
    ]
    for (const [event, declared] of cases) {
      expect(comboFromEvent(press(event))).toBe(normalizeCombo(declared))
    }
  })
})
