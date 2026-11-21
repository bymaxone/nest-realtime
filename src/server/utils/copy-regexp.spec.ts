/**
 * @fileoverview A RegExp is recognised by its brand and copied without the flags that give it state.
 * @layer utils
 */
import vm from 'node:vm'
import { copyRegExp } from './copy-regexp'

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

  // Scenario: a RegExp from another realm. Expected: copied into this realm, where `instanceof` holds.
  it('copies a RegExp from another realm into this one', () => {
    const copy = copyRegExp(vm.runInNewContext('/x/g'))

    expect(copy).toBeInstanceOf(RegExp)
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
