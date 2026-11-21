/**
 * @fileoverview A RegExp is recognised by its brand and copied without the flags that give it state.
 * @layer utils
 */
import vm from 'node:vm'
import { copyRegExp, hasRegExpBrand } from './copy-regexp'

describe('copyRegExp', () => {
  // Scenario: a RegExp with the pattern, flags that matter and the g flag, which only carries state. Expected: a new
  // RegExp with the pattern and the other flags, and no g.
  it('copies the pattern and the flags except g', () => {
    const original = /good\.example$/gims

    const copy = copyRegExp(original)

    expect(copy).not.toBe(original)
    expect(copy?.source).toBe(original.source)
    expect(copy?.flags).toBe('ims')
  })

  // Scenario: every flag a copy keeps. Expected: the copy has each, so a flag is never lost by the table that reads them.
  it.each([['dimsu'], ['dimsv'], ['']])('keeps the flags %p', (flags) => {
    expect(copyRegExp(new RegExp('x', flags))?.flags).toBe(flags)
  })

  // Scenario: the g flag, which a copy drops. Expected: a copy of /x/gi keeps only i.
  it('drops g and keeps the others', () => {
    expect(copyRegExp(/x/gi)?.flags).toBe('i')
  })

  // Scenario: a sticky RegExp. Expected: no copy, and it is still known to be a RegExp. The y flag makes `test`
  // match only at the start, so a copy without it would accept what the original rejects.
  it('gives no copy of a sticky RegExp, and knows it for a RegExp', () => {
    expect(copyRegExp(/x/y)).toBeUndefined()
    expect(hasRegExpBrand(/x/y)).toBe(true)
  })

  // Scenario: the flag accessors of RegExp.prototype replaced after the module loaded. Expected: the accessors it took
  // at load decide the flags, so neither a lie nor a throw changes what is copied or refused.
  describe('with the flag accessors of RegExp.prototype replaced', () => {
    const replace = (name: string, get: () => unknown): (() => void) => {
      const saved = Object.getOwnPropertyDescriptor(RegExp.prototype, name) as PropertyDescriptor
      Object.defineProperty(RegExp.prototype, name, { get, configurable: true })
      return () => Object.defineProperty(RegExp.prototype, name, saved)
    }

    it('still refuses a sticky RegExp when sticky says false', () => {
      const restore = replace('sticky', () => false)
      try {
        expect(copyRegExp(/x/y)).toBeUndefined()
      } finally {
        restore()
      }
    })

    // The copy is judged by what it matches, not by its own `flags`, which reads the replaced accessors too.
    it('copies the flags the RegExp has, not the ones the accessors now say', () => {
      const restore = replace('multiline', () => true)
      try {
        const copy = copyRegExp(/^x$/) as RegExp

        expect(copy.test('a\nx')).toBe(false)
        expect(copy.test('x')).toBe(true)
      } finally {
        restore()
      }
    })

    it('raises no error of the host when an accessor throws', () => {
      const restore = replace('global', () => {
        throw new Error('host text')
      })
      try {
        const copy = copyRegExp(/x/g) as RegExp

        expect([copy.test('x'), copy.test('x')]).toStrictEqual([true, true])
      } finally {
        restore()
      }
    })
  })

  // Scenario: the same copy is asked twice. Expected: it answers the same each time, which a g flag would not.
  it('answers the same however many times it is tested', () => {
    const copy = copyRegExp(/good/g)

    expect([copy?.test('good'), copy?.test('good'), copy?.test('good')]).toStrictEqual([
      true,
      true,
      true,
    ])
  })

  // Scenario: a RegExp that is not a plain one: a subclass, one with a property of its own, one from another realm.
  // Expected: no copy, because a copy would lose what makes it different, and it is still known to be a RegExp.
  it.each([
    ['a subclass', () => new (class Mine extends RegExp {})('x')],
    ['a RegExp with a property of its own', () => Object.assign(/x/, { test: () => false })],
    ['a RegExp from another realm', () => vm.runInNewContext('/x/g') as unknown],
  ])('gives no copy of %s, and knows it for a RegExp', (_name, build) => {
    const value = build()

    expect(copyRegExp(value)).toBeUndefined()
    expect(hasRegExpBrand(value)).toBe(true)
  })

  it('recognises a plain RegExp by its brand, and neither a proxy over one nor a primitive', () => {
    expect(hasRegExpBrand(/x/)).toBe(true)
    expect(hasRegExpBrand(new Proxy(/x/, {}))).toBe(false)
    expect(hasRegExpBrand('x')).toBe(false)
  })

  // Scenario: values that are not RegExps, including one with the prototype of one and a proxy over one.
  // Expected: no copy.
  it.each([
    ['an object with the prototype of a RegExp', () => Object.create(RegExp.prototype) as unknown],
    ['a Proxy over a RegExp', () => new Proxy(/x/, {})],
    ['a string', () => 'x'],
    ['null', () => null],
    ['an object that answers source and flags', () => ({ source: 'x', flags: '' })],
  ])('returns nothing for %s', (_name, build) => {
    expect(copyRegExp(build())).toBeUndefined()
  })
})
