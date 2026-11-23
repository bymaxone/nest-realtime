/**
 * @fileoverview The built-ins the options, their validation and the admission of a connection call are compared with what they were at load.
 * @layer utils
 *
 * A replaced `startsWith`, `includes` or iterator makes a check pass or a loop end where it should not, so the code that
 * follows must not run: each entry point refuses first, with the count and nothing of what was replaced.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateOptions } from '../config/validate-options'
import type { AuthenticationResult } from '../interfaces/connection-authenticator.interface'
import { admitRooms } from './admit-rooms'
import { assertIdentityIsNotBlank, resolveAuthTenant } from './assert-identity'
import { BUILTIN_SLOTS, assertBuiltinsIntact, replacedBuiltinCount } from './builtin-baseline'
import type * as BuiltinBaseline from './builtin-baseline'
import { reservedRoomPrefix } from './reserved-room'

type Outcome = { count: number; code?: unknown; message?: string; threw: boolean }

// Kept in locals first: `Object.defineProperty` is one of what is replaced, and it is also what puts each back.
const define = Object.defineProperty
const describe_ = Object.getOwnPropertyDescriptor

/** What each holder of a built-in is called in the source, for the label of a slot: the holder and the key. */
const HOLDERS: [object, string][] = [
  [Object, 'Object'],
  [Array, 'Array'],
  [Array.prototype, 'Array.prototype'],
  [Number, 'Number'],
  [Math, 'Math'],
  [String.prototype, 'String.prototype'],
  [Set.prototype, 'Set.prototype'],
  [Reflect, 'Reflect'],
  [Function.prototype, 'Function.prototype'],
  [RegExp.prototype, 'RegExp.prototype'],
  [globalThis, 'globalThis'],
  [Object.getPrototypeOf([][Symbol.iterator]()) as object, 'ArrayIterator.prototype'],
  [Object.getPrototypeOf(''[Symbol.iterator]()) as object, 'StringIterator.prototype'],
  [Object.getPrototypeOf(new Set()[Symbol.iterator]()) as object, 'SetIterator.prototype'],
  [Object.getPrototypeOf(new Map()[Symbol.iterator]()) as object, 'MapIterator.prototype'],
  [Number.prototype, 'Number.prototype'],
  [Date.prototype, 'Date.prototype'],
  [Map.prototype, 'Map.prototype'],
]

/** The label of a slot, as `Holder.key`. */
function labelOf(slot: (typeof BUILTIN_SLOTS)[number]): string {
  const holder = HOLDERS.find((entry) => entry[0] === slot[0])
  const key = typeof slot[1] === 'symbol' ? `[${slot[1].description}]` : String(slot[1])
  return `${holder?.[1] ?? '?'}.${key}`
}

/**
 * Replaces each of the built-ins at `indexes` by a function that answers nothing, runs `run`, and puts them all back. Plain
 * locals and indexed loops only inside the window: the iterator protocol and the array methods are among what is replaced.
 */
function whileReplaced(indexes: number | readonly number[], run: () => void): void {
  const wanted = typeof indexes === 'number' ? [indexes] : indexes
  const saved: (PropertyDescriptor | undefined)[] = []
  for (let n = 0; n < wanted.length; n += 1) {
    const slot = BUILTIN_SLOTS[wanted[n] as number] as (typeof BUILTIN_SLOTS)[number]
    saved[n] = describe_(slot[0], slot[1])
  }
  try {
    for (let n = 0; n < wanted.length; n += 1) {
      const slot = BUILTIN_SLOTS[wanted[n] as number] as (typeof BUILTIN_SLOTS)[number]
      define(slot[0], slot[1], { value: () => undefined, configurable: true, writable: true })
    }
    run()
  } finally {
    for (let n = 0; n < wanted.length; n += 1) {
      const slot = BUILTIN_SLOTS[wanted[n] as number] as (typeof BUILTIN_SLOTS)[number]
      // A slot that was not there is removed again, not given an undefined descriptor.
      if (saved[n] === undefined) Reflect.deleteProperty(slot[0], slot[1])
      else define(slot[0], slot[1], saved[n] as PropertyDescriptor)
    }
  }
}

describe('the built-ins the library calls', () => {
  // Scenario: nothing was replaced. Expected: a count of zero, and no refusal.
  it('counts none and refuses nothing while all are what they were', () => {
    expect(replacedBuiltinCount()).toBe(0)
    expect(() => assertBuiltinsIntact()).not.toThrow()
  })

  // Scenario: a key in the list is misspelled or names nothing, so the slot records an absent property that no replacement of
  // the real built-in can change. Expected: every listed slot holds a function, or the getter of an accessor, at load, but
  // for the eight that hold something else on purpose: the two namespace objects, and the symbol methods a string and a number
  // must not have.
  it('lists only slots that hold a function or the getter of an accessor, bar the eight that do not', () => {
    const empty: string[] = []
    for (let i = 0; i < BUILTIN_SLOTS.length; i += 1) {
      const slot = BUILTIN_SLOTS[i] as (typeof BUILTIN_SLOTS)[number]
      const descriptor = describe_(slot[0], slot[1])
      const held = descriptor === undefined ? undefined : (descriptor.value ?? descriptor.get)
      if (typeof held !== 'function') empty[empty.length] = labelOf(slot)
    }
    expect(empty).toStrictEqual([
      'String.prototype.[Symbol.match]',
      'String.prototype.[Symbol.matchAll]',
      'String.prototype.[Symbol.replace]',
      'String.prototype.[Symbol.search]',
      'String.prototype.[Symbol.split]',
      'Number.prototype.[Symbol.toPrimitive]',
      'globalThis.Reflect',
      'globalThis.Math',
    ])
  })

  // Scenario: each built-in of the list is replaced in turn, after the import. Expected: it is counted once and the refusal
  // has the code and the count, never the name of what was replaced; and all are back afterwards.
  it('counts each one that is replaced, and refuses with a count and nothing else', () => {
    const outcomes: Outcome[] = []
    for (let i = 0; i < BUILTIN_SLOTS.length; i += 1) {
      whileReplaced(i, () => {
        const outcome: Outcome = { count: replacedBuiltinCount(), threw: false }
        try {
          assertBuiltinsIntact()
        } catch (error) {
          outcome.threw = true
          outcome.code = (error as { code?: unknown }).code
          outcome.message = (error as Error).message
        }
        outcomes[i] = outcome
      })
    }

    expect(outcomes).toHaveLength(BUILTIN_SLOTS.length)
    for (let i = 0; i < outcomes.length; i += 1) {
      const outcome = outcomes[i] as Outcome
      const label = labelOf(BUILTIN_SLOTS[i] as (typeof BUILTIN_SLOTS)[number])
      expect([label, outcome.count, outcome.threw, outcome.code]).toStrictEqual([
        label,
        1,
        true,
        'REALTIME_TRANSPORT_UNAVAILABLE',
      ])
      expect(outcome.message).toBe(
        'REALTIME_TRANSPORT_UNAVAILABLE: 1 built-in the library calls was replaced after it was loaded',
      )
    }
    expect(replacedBuiltinCount()).toBe(0)
  })

  // Scenario: two are replaced at once. Expected: the count is two and the text is the plural.
  it('counts two replaced together', () => {
    let message = ''
    whileReplaced([0, 1], () => {
      try {
        assertBuiltinsIntact()
      } catch (error) {
        message = (error as Error).message
      }
    })

    expect(message).toBe(
      'REALTIME_TRANSPORT_UNAVAILABLE: 2 built-ins the library calls were replaced after it was loaded',
    )
  })
})

describe('the additions the audits asked for', () => {
  const find = (label: string): number => BUILTIN_SLOTS.findIndex((slot) => labelOf(slot) === label)

  // Scenario: `Function.prototype.bind` is replaced. A filter over `typeof` of the constructor prototypes would not list it.
  // Expected: it is a slot of its own, and admission is refused while it is replaced.
  it('lists Function.prototype.bind, and refuses while it is replaced', () => {
    let code: unknown
    whileReplaced(find('Function.prototype.bind'), () => {
      try {
        admitRooms({ userId: 'u1', rooms: ['workspace:w1'] })
      } catch (error) {
        code = (error as { code?: unknown }).code
      }
    })

    expect(find('Function.prototype.bind')).toBeGreaterThanOrEqual(0)
    expect(code).toBe('REALTIME_TRANSPORT_UNAVAILABLE')
  })

  // Scenario: the global binding `Object` is replaced, while `Object.keys` and every other member is the original.
  // Expected: counted once, by identity of the binding, and refused.
  it.each([
    'Object',
    'Reflect',
    'Array',
    'Math',
    'Number',
    'String',
    'Set',
    'Map',
    'Promise',
    'Error',
  ])('counts the global binding %s when it is replaced', (name) => {
    let count = -1
    let code: unknown
    whileReplaced(find(`globalThis.${name}`), () => {
      count = replacedBuiltinCount()
      try {
        assertBuiltinsIntact()
      } catch (error) {
        code = (error as { code?: unknown }).code
      }
    })

    expect([count, code]).toStrictEqual([1, 'REALTIME_TRANSPORT_UNAVAILABLE'])
  })

  // Scenario: the three iterators and `push` are replaced together, the things a loop over the list would use if it were
  // written with `for...of` or a method. Expected: the count is four and the check does not throw, so the loop is indexed.
  it('counts while the iterators and push are replaced, since the loop is indexed', () => {
    let count = -1
    let error: unknown
    const together = [
      find('Array.prototype.[Symbol.iterator]'),
      find('String.prototype.[Symbol.iterator]'),
      find('Set.prototype.[Symbol.iterator]'),
      find('Array.prototype.push'),
    ]
    whileReplaced(together, () => {
      try {
        count = replacedBuiltinCount()
      } catch (caught) {
        error = caught
      }
    })

    expect([count, error]).toStrictEqual([4, undefined])
  })
})

describe('the symbol-keyed methods and the flags of a RegExp', () => {
  const find = (label: string): number => BUILTIN_SLOTS.findIndex((slot) => labelOf(slot) === label)

  // Scenario: `split` with a string asks the string for `Symbol.split`, and `String.prototype` answers. Expected: a function
  // planted there is counted, as is one planted for each other symbol the string and number coercions and a regular
  // expression dispatch through; none of them is there to start with.
  it.each([
    'String.prototype.[Symbol.match]',
    'String.prototype.[Symbol.matchAll]',
    'String.prototype.[Symbol.replace]',
    'String.prototype.[Symbol.search]',
    'String.prototype.[Symbol.split]',
    'Number.prototype.[Symbol.toPrimitive]',
  ])('counts %s planted', (label) => {
    expect(find(label)).toBeGreaterThanOrEqual(0)
    let count = -1
    whileReplaced(find(label), () => {
      count = replacedBuiltinCount()
    })

    expect(count).toBe(1)
  })

  // Scenario: the `next` of the iterator of arrays, strings, sets and maps, which `for...of`, spread and destructuring call.
  // Expected: each is a slot, and a replaced one is counted.
  it.each(['ArrayIterator', 'StringIterator', 'SetIterator', 'MapIterator'])(
    'counts a replaced %s.prototype.next',
    (holder) => {
      const index = find(`${holder}.prototype.next`)
      let count = -1
      whileReplaced(index, () => {
        count = replacedBuiltinCount()
      })

      expect([index >= 0, count]).toStrictEqual([true, 1])
    },
  )

  // Scenario: a regular expression's own method for a symbol is replaced, which makes `replace` strip nothing. Expected: counted.
  it('counts a replaced RegExp.prototype[Symbol.replace]', () => {
    expect(find('RegExp.prototype.[Symbol.replace]')).toBeGreaterThanOrEqual(0)
    let count = -1
    whileReplaced(find('RegExp.prototype.[Symbol.replace]'), () => {
      count = replacedBuiltinCount()
    })

    expect(count).toBe(1)
  })

  // Scenario: a flag of a RegExp is an accessor, and `replace` reads `flags`. Expected: a replaced accessor, by another accessor
  // or by a value, is counted: the slot holds the getter, not nothing.
  it.each(['flags', 'global', 'sticky', 'source'])(
    'counts the flag accessor %s replaced by another accessor',
    (name) => {
      const index = find(`RegExp.prototype.${name}`)
      const original = describe_(RegExp.prototype, name) as PropertyDescriptor
      let count = -1
      define(RegExp.prototype, name, {
        __proto__: null,
        get: () => original.get?.call(RegExp.prototype),
        configurable: true,
      } as PropertyDescriptor)
      try {
        count = replacedBuiltinCount()
      } finally {
        define(RegExp.prototype, name, original)
      }

      expect(index).toBeGreaterThanOrEqual(0)
      expect(count).toBe(1)
    },
  )
})

describe('what the library only uses to serialize', () => {
  // Scenario: a host's test suite spies on `JSON.stringify`, or a patch replaces it. Expected: not counted, and the
  // check does not refuse: it serializes, it does not decide who is admitted, so the library takes its own copy at load.
  it('does not count a replaced JSON.stringify', () => {
    const original = describe_(JSON, 'stringify') as PropertyDescriptor
    let count = -1
    let code: unknown
    define(JSON, 'stringify', { value: () => '"x"', configurable: true, writable: true })
    try {
      count = replacedBuiltinCount()
      try {
        assertBuiltinsIntact()
      } catch (error) {
        code = (error as { code?: unknown }).code
      }
    } finally {
      define(JSON, 'stringify', original)
    }

    expect([count, code]).toStrictEqual([0, undefined])
  })
})

describe('a built-in replaced by an accessor that has no getter', () => {
  // Scenario: a method is replaced by a property with a setter and no getter. Expected: counted: there is nothing to call, and
  // nothing a recorded value can equal.
  it('counts a setter-only accessor', () => {
    const saved = describe_(String.prototype, 'trim') as PropertyDescriptor
    let count = -1
    define(String.prototype, 'trim', {
      __proto__: null,
      set: () => undefined,
      configurable: true,
    } as PropertyDescriptor)
    try {
      count = replacedBuiltinCount()
    } finally {
      define(String.prototype, 'trim', saved)
    }

    expect(count).toBe(1)
  })
})

describe('a built-in removed after the library loaded', () => {
  // Scenario: a built-in is deleted outright, so the holder has no descriptor for it. Expected: counted as replaced.
  it('counts a built-in that is no longer there', () => {
    const saved = describe_(String.prototype, 'trim') as PropertyDescriptor
    let count = -1
    Reflect.deleteProperty(String.prototype, 'trim')
    try {
      count = replacedBuiltinCount()
    } finally {
      define(String.prototype, 'trim', saved)
    }

    expect(count).toBe(1)
  })
})

describe('a built-in replaced by an accessor, with a value planted on Object.prototype', () => {
  const find = (label: string): number => BUILTIN_SLOTS.findIndex((slot) => labelOf(slot) === label)

  /**
   * Replaces `String.prototype.startsWith` by an accessor, with `value` planted on the root prototype, runs `run`, and puts
   * everything back. The descriptors have no prototype, since the planted `value` would otherwise be read into them.
   */
  function withAccessorAndPlantedValue(planted: PropertyDescriptor, run: () => void): void {
    const slot = BUILTIN_SLOTS[
      find('String.prototype.startsWith')
    ] as (typeof BUILTIN_SLOTS)[number]
    const saved = describe_(slot[0], slot[1]) as PropertyDescriptor
    define(slot[0], slot[1], {
      __proto__: null,
      get: () => () => false,
      configurable: true,
    } as PropertyDescriptor)
    define(Object.prototype, 'value', {
      __proto__: null,
      ...planted,
      configurable: true,
    } as PropertyDescriptor)
    try {
      run()
    } finally {
      Reflect.deleteProperty(Object.prototype, 'value')
      define(slot[0], slot[1], saved)
    }
  }

  // Scenario: the original `startsWith` is planted as `value` on the root prototype, and `startsWith` is replaced by an
  // accessor, which has no value of its own. Expected: counted as replaced, since the inherited value is not the slot's.
  it('counts an accessor even when the original is planted as the value it would inherit', () => {
    const original = String.prototype.startsWith
    let count = -1
    let code: unknown
    withAccessorAndPlantedValue({ value: original, writable: true }, () => {
      count = replacedBuiltinCount()
      try {
        assertBuiltinsIntact()
      } catch (error) {
        code = (error as { code?: unknown }).code
      }
    })

    expect([count, code]).toStrictEqual([1, 'REALTIME_TRANSPORT_UNAVAILABLE'])
  })

  // Scenario: the planted `value` is a getter that throws. Expected: the refusal is the count-only one; nothing the host
  // wrote is run or escapes.
  it('refuses with the count-only code when the planted value is a getter that throws', () => {
    let count = -1
    let code: unknown
    withAccessorAndPlantedValue(
      {
        get: () => {
          throw new Error('SECRET-planted-getter')
        },
      },
      () => {
        try {
          count = replacedBuiltinCount()
          assertBuiltinsIntact()
        } catch (error) {
          code = (error as { code?: unknown }).code
        }
      },
    )

    expect([count, code]).toStrictEqual([1, 'REALTIME_TRANSPORT_UNAVAILABLE'])
  })
})

describe('a process whose string iterator was replaced before the library loaded', () => {
  // Scenario: `String.prototype[Symbol.iterator]` is not a function when the library loads, so the list of built-ins cannot
  // be made. Expected: the load does not throw, the list is empty, and every use is refused with a count of one.
  it('loads, and refuses every use', () => {
    type Baseline = typeof BuiltinBaseline
    const saved = describe_(String.prototype, Symbol.iterator) as PropertyDescriptor
    let loaded: Baseline | undefined
    let error: unknown
    define(String.prototype, Symbol.iterator, { value: 1, configurable: true, writable: true })
    try {
      jest.isolateModules(() => {
        try {
          loaded = require('./builtin-baseline') as Baseline
        } catch (caught) {
          error = caught
        }
      })
    } finally {
      define(String.prototype, Symbol.iterator, saved)
    }

    expect(error).toBeUndefined()
    expect(loaded?.BUILTIN_SLOTS).toHaveLength(0)
    expect(loaded?.replacedBuiltinCount()).toBe(1)
    expect(() => loaded?.assertBuiltinsIntact()).toThrow(
      'REALTIME_TRANSPORT_UNAVAILABLE: 1 built-in the library calls was replaced after it was loaded',
    )
  })
})

describe('the entry points that read options and admit a connection', () => {
  const index = (label: string): number =>
    BUILTIN_SLOTS.findIndex((slot) => labelOf(slot) === label)
  const auth = (extra: object): AuthenticationResult =>
    ({ userId: 'u1', tenantId: 't1', ...extra }) as AuthenticationResult

  // Scenario: `startsWith` is replaced by a function that says no, and an authenticator names a room of another tenant.
  // Expected: admission is refused, as the count, and nothing is joined: the reserved-prefix check was blinded, and the
  // refusal comes first. This is the cross-tenant join the replacement would otherwise allow.
  it('refuses to admit a room of another tenant while startsWith is replaced', () => {
    const attempt = (): unknown => admitRooms(auth({ rooms: ['tenant:t2'] }))
    let thrown: unknown
    let admitted: unknown
    whileReplaced(index('String.prototype.startsWith'), () => {
      try {
        admitted = attempt()
      } catch (error) {
        thrown = error
      }
    })

    expect(admitted).toBeUndefined()
    expect((thrown as { code?: unknown }).code).toBe('REALTIME_TRANSPORT_UNAVAILABLE')
    expect(() => admitRooms(auth({ rooms: ['tenant:t2'] }))).toThrow('reserved prefix')
  })

  // Scenario: the iterator and the array methods are replaced while rooms and roles are admitted. Expected: refused, not
  // admitted with fewer of them, and not with none.
  it.each([
    'Array.prototype.[Symbol.iterator]',
    'Array.prototype.push',
    'Array.prototype.includes',
  ])('refuses to admit roles and rooms while %s is replaced', (label) => {
    let code: unknown
    whileReplaced(index(label), () => {
      try {
        admitRooms(auth({ roles: ['admin'], rooms: ['workspace:w1'] }))
      } catch (error) {
        code = (error as { code?: unknown }).code
      }
    })

    expect(code).toBe('REALTIME_TRANSPORT_UNAVAILABLE')
  })

  // Scenario: each entry point is called with a built-in it uses replaced. Expected: each refuses first, with the same code.
  it.each([
    ['validateOptions', (): unknown => validateOptions({ transport: 'sse' } as never)],
    ['resolveAuthTenant', (): unknown => resolveAuthTenant({}, auth({}))],
    ['assertIdentityIsNotBlank', (): unknown => assertIdentityIsNotBlank(auth({}))],
    ['reservedRoomPrefix', (): unknown => reservedRoomPrefix('workspace:w1')],
  ])('%s refuses first while a built-in it calls is replaced', (_name, call) => {
    let code: unknown
    whileReplaced(index('Object.keys'), () => {
      try {
        call()
      } catch (error) {
        code = (error as { code?: unknown }).code
      }
    })

    expect(code).toBe('REALTIME_TRANSPORT_UNAVAILABLE')
  })
})

describe('the list of built-ins', () => {
  /** What the scan does not hold to the list, with the reason: none of these is a built-in the checks depend on. */
  const EXEMPT: Record<string, string> = {
    authenticate: 'a method of the host, not a built-in',
    build: 'a function of this library',
    buildAsync: 'a function of this library',
    buildCommonProviders: 'a function of this library',
    buildOptionDerivedProviders: 'a function of this library',
    quit: 'a method of the host',
    disconnect: 'a method of the host',
    log: 'a method of the logger',
    unref: 'a method of a timer',
    iteratorSlots: 'a function of this library',
    now: 'Date.now, which a host replaces on purpose to control time',
    then: 'Promise.prototype.then, which instrumentation and zone libraries patch on purpose',
    catch: 'Promise.prototype.catch, patched like then',
    resolve: 'Promise.resolve, patched like then',
    race: 'Promise.race, patched like then',
  }

  const directories = ['config', 'composition', 'utils'].map((name) => join(__dirname, '..', name))

  /** The source of every file of the options, their validation and admission, with its comments taken out. */
  function sources(): string[] {
    return directories.flatMap((directory) =>
      readdirSync(directory)
        .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
        .map((name) =>
          readFileSync(join(directory, name), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\n]*/g, ''),
        ),
    )
  }

  /**
   * A scan reads the sources, so it runs on plain ones. Under the mutation runner the files are its instrumented copies, which
   * hold every variant of every mutant (a `.startsWith` beside the `.endsWith` it is mutated into): those are not the code.
   */
  const instrumented = sources().some((source) => source.includes('stryMutAct_'))
  const scanned = instrumented ? it.skip : it

  // Scenario: every method called by name in those files. Expected: its name is the key of a built-in in the list, or is
  // exempt with a reason. A call added later that is in neither fails here, and has to be listed or explained.
  scanned('holds every built-in the options, validation and admission code calls by name', () => {
    const keys = new Set(BUILTIN_SLOTS.map((slot) => String(slot[1])))
    const called = new Set<string>()
    for (const source of sources()) {
      for (const match of source.matchAll(/\.([A-Za-z_]+)\(/g)) called.add(match[1] as string)
    }

    const missing = [...called].filter((name) => !keys.has(name) && !(name in EXEMPT)).sort()

    expect(missing).toStrictEqual([])
  })

  // Scenario: every static of a built-in object read in those files. Expected: it is in the list, or is exempt.
  scanned('holds every static of a built-in the code reads', () => {
    const labels = new Set(BUILTIN_SLOTS.map((slot) => labelOf(slot)))
    const read = new Set<string>()
    for (const source of sources()) {
      for (const match of source.matchAll(
        /\b(Object|Array|Number|Math|JSON|Reflect)\.([A-Za-z_]+)\b/g,
      )) {
        read.add(`${match[1]}.${match[2]}`)
      }
    }
    // `JSON.stringify` is taken once, at load, by the captured built-ins, and only serializes: it takes no part in a decision.
    const exempt = new Set([
      'JSON.stringify',
      'Number.MAX_SAFE_INTEGER',
      'Number.NEGATIVE_INFINITY',
      'Array.prototype',
      'Number.prototype',
      'Object.prototype',
    ])

    const missing = [...read].filter((name) => !labels.has(name) && !exempt.has(name)).sort()

    expect(missing).toStrictEqual([])
  })
})

describe('a process whose hasOwnProperty was replaced before the library loaded', () => {
  // Scenario: `Object.prototype.hasOwnProperty` is not a function when the library loads, so the baseline cannot be read.
  // Expected: the load does not throw, and every use is refused with a count of one.
  it('loads, and refuses every use', () => {
    type Baseline = typeof BuiltinBaseline
    const saved = describe_(Object.prototype, 'hasOwnProperty') as PropertyDescriptor
    let loaded: Baseline | undefined
    let error: unknown
    define(Object.prototype, 'hasOwnProperty', { value: 1, configurable: true, writable: true })
    try {
      jest.isolateModules(() => {
        try {
          loaded = require('./builtin-baseline') as Baseline
        } catch (caught) {
          error = caught
        }
      })
    } finally {
      define(Object.prototype, 'hasOwnProperty', saved)
    }

    expect(error).toBeUndefined()
    expect(loaded?.replacedBuiltinCount()).toBe(1)
  })
})

describe('a process whose Array.prototype methods were replaced before the library loaded', () => {
  type Baseline = typeof BuiltinBaseline

  /** Loads the module afresh with one method of arrays replaced by a function that answers an empty array, and puts it back. */
  function loadedWithEmptying(method: 'concat' | 'map'): Baseline | undefined {
    const saved = describe_(Array.prototype, method) as PropertyDescriptor
    let loaded: Baseline | undefined
    define(Array.prototype, method, { value: () => [], configurable: true, writable: true })
    try {
      jest.isolateModules(() => {
        loaded = require('./builtin-baseline') as Baseline
      })
    } finally {
      define(Array.prototype, method, saved)
    }
    return loaded
  }

  // Scenario: `concat` or `map` answers an empty array while the library loads, so the list or what it recorded is empty and
  // the load succeeds. Expected: that is not a baseline: every use is refused with a count of one, not counted as nothing
  // having changed.
  it.each(['concat', 'map'] as const)(
    'refuses every use when %s answered an empty array at load',
    (method) => {
      const loaded = loadedWithEmptying(method)

      expect(loaded?.replacedBuiltinCount()).toBe(1)
      expect(() => loaded?.assertBuiltinsIntact()).toThrow(
        'REALTIME_TRANSPORT_UNAVAILABLE: 1 built-in the library calls was replaced after it was loaded',
      )
    },
  )
})
