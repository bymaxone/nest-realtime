/**
 * @fileoverview A plain RegExp is copied without the flags that give it state, and nothing else is.
 * @layer utils
 */
import vm from 'node:vm'
import { copyRegExp } from './copy-regexp'

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

  // Scenario: a sticky RegExp. Expected: no copy. The y flag makes `test` match only at the start, so a copy
  // without it would accept what the original rejects.
  it('gives no copy of a sticky RegExp', () => {
    expect(copyRegExp(/x/y)).toBeUndefined()
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

  // Scenario: a pattern longer than the bound the copy allows. Expected: no copy for one over it, a copy for one at it.
  // The bound limits the cost of reading and keeping a pattern; how it behaves on input is the host's to judge.
  it('copies a pattern of exactly 1,000 characters and not one of 1,001', () => {
    expect(copyRegExp(new RegExp('a'.repeat(1000)))).toBeInstanceOf(RegExp)
    expect(copyRegExp(new RegExp('a'.repeat(1001)))).toBeUndefined()
  })

  // Scenario: the built-ins the copy itself would use, replaced after the module loaded: `Function.prototype.call`, the
  // iterator of an array and a `Symbol.iterator` of a string. Expected: the copy touches none of them, so a host
  // that replaced one cannot make it lie, and it is not told that it ran.
  describe('with the built-ins it would use replaced after the module loaded', () => {
    // The assertions run after the built-in is put back: the test framework calls it too.
    it('does not call the live Function.prototype.call', () => {
      const original = Function.prototype.call
      let calls = 0
      let plain: RegExp | undefined
      let sticky: RegExp | undefined
      Function.prototype.call = function (this: Function, ...args: unknown[]): unknown {
        calls += 1
        return (original as (...a: unknown[]) => unknown).apply(this, args)
      } as typeof Function.prototype.call
      try {
        plain = copyRegExp(/x/i)
        sticky = copyRegExp(/x/y)
      } finally {
        Function.prototype.call = original
      }

      expect(calls).toBe(0)
      expect(plain).toBeInstanceOf(RegExp)
      expect(sticky).toBeUndefined()
    })

    it('does not walk the live iterator of an array', () => {
      const original = Array.prototype[Symbol.iterator]
      let walks = 0
      let copy: RegExp | undefined
      Array.prototype[Symbol.iterator] = function (this: unknown[]): ArrayIterator<unknown> {
        walks += 1
        return original.call(this)
      } as (typeof Array.prototype)[typeof Symbol.iterator]
      try {
        copy = copyRegExp(/x/im)
      } finally {
        Array.prototype[Symbol.iterator] = original
      }

      expect(walks).toBe(0)
      expect(copy).toBeInstanceOf(RegExp)
    })
  })

  // Scenario: the sticky accessor absent from RegExp.prototype when the module loads. Expected: every RegExp is refused,
  // not read as one without the y flag, because a sticky one could not be told from a plain one.
  it('refuses every RegExp when the sticky accessor was absent at load', () => {
    const saved = Object.getOwnPropertyDescriptor(RegExp.prototype, 'sticky') as PropertyDescriptor
    let isolated: typeof copyRegExp | undefined
    Reflect.deleteProperty(RegExp.prototype, 'sticky')
    try {
      jest.isolateModules(() => {
        isolated = (require('./copy-regexp') as { copyRegExp: typeof copyRegExp }).copyRegExp
      })
    } finally {
      Object.defineProperty(RegExp.prototype, 'sticky', saved)
    }

    expect(isolated?.(/x/)).toBeUndefined()
    expect(isolated?.(/x/y)).toBeUndefined()
  })

  // Scenario: the accessors the module took at load, called by it. Expected: each is called with the RegExp as its
  // receiver and with no arguments, as a getter is.
  it('calls the accessors with the RegExp as the receiver and no arguments', () => {
    const calls: Array<{ name: string; receiver: unknown; count: number }> = []
    const names = ['source', 'ignoreCase', 'sticky']
    const saved = names.map(
      (name) => [name, Object.getOwnPropertyDescriptor(RegExp.prototype, name)] as const,
    )
    for (const [name, descriptor] of saved) {
      const original = (descriptor as PropertyDescriptor).get as () => unknown
      Object.defineProperty(RegExp.prototype, name, {
        get(this: unknown, ...args: unknown[]) {
          calls.push({ name, receiver: this, count: args.length })
          return Reflect.apply(original, this, [])
        },
        configurable: true,
      })
    }
    let isolated: typeof copyRegExp | undefined
    try {
      jest.isolateModules(() => {
        isolated = (require('./copy-regexp') as { copyRegExp: typeof copyRegExp }).copyRegExp
      })
    } finally {
      for (const [name, descriptor] of saved) {
        Object.defineProperty(RegExp.prototype, name, descriptor as PropertyDescriptor)
      }
    }
    const subject = /x/i

    expect(isolated?.(subject)?.flags).toBe('i')
    expect(calls.map(({ name, count }) => [name, count])).toStrictEqual([
      ['source', 0],
      ['sticky', 0],
      ['ignoreCase', 0],
    ])
    expect(calls.every(({ receiver }) => receiver === subject)).toBe(true)
  })

  // Scenario: the accessors of the newer flags (hasIndices, unicodeSets) absent when the module loads, as on an older
  // runtime. Expected: the flags it can read are kept and the copy is made.
  it('copies a RegExp when the accessors of the newer flags were absent at load', () => {
    const saved = ['hasIndices', 'unicodeSets'].map(
      (name) => [name, Object.getOwnPropertyDescriptor(RegExp.prototype, name)] as const,
    )
    let isolated: typeof copyRegExp | undefined
    for (const [name] of saved) Reflect.deleteProperty(RegExp.prototype, name)
    try {
      jest.isolateModules(() => {
        isolated = (require('./copy-regexp') as { copyRegExp: typeof copyRegExp }).copyRegExp
      })
    } finally {
      for (const [name, descriptor] of saved) {
        Object.defineProperty(RegExp.prototype, name, descriptor as PropertyDescriptor)
      }
    }

    expect(isolated?.(/x/im)?.flags).toBe('im')
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
  // Expected: no copy, because a copy would lose what makes it different.
  it.each([
    ['a subclass', () => new (class Mine extends RegExp {})('x')],
    ['a RegExp with a property of its own', () => Object.assign(/x/, { test: () => false })],
    ['a RegExp from another realm', () => vm.runInNewContext('/x/g') as unknown],
  ])('gives no copy of %s', (_name, build) => {
    expect(copyRegExp(build())).toBeUndefined()
  })

  it('copies a plain RegExp, and not a proxy over one or a primitive', () => {
    expect(copyRegExp(/x/)).toBeInstanceOf(RegExp)
    expect(copyRegExp(new Proxy(/x/, {}))).toBeUndefined()
    expect(copyRegExp('x')).toBeUndefined()
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
