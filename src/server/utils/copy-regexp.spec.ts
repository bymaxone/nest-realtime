/**
 * @fileoverview A RegExp is recognised by its brand and copied without the flags that give it state.
 * @layer utils
 */
import vm from 'node:vm'
import { copyRegExp, hasRegExpBrand } from './copy-regexp'

describe('copyRegExp', () => {
  // Scenario: a RegExp with the pattern and flags that matter and the two that carry state. Expected: a new
  // RegExp with the pattern and the other flags, and neither g nor y.
  it('copies the pattern and the flags except g and y', () => {
    const original = /good\.example$/gimsy

    const copy = copyRegExp(original)

    expect(copy).not.toBe(original)
    expect(copy?.source).toBe(original.source)
    expect(copy?.flags).toBe('ims')
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
