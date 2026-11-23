/**
 * @fileoverview What the count does with the standard names of `Object.prototype` that were wrong, changed or replaced.
 * @layer transport
 *
 * Each row loads the module afresh, with the root prototype in a state of its own, because the baseline is taken once, when
 * the library loads: a name wrong at load, a name changed since, a descriptor field planted, a built-in the check could have
 * called replaced after the load, and a value planted under a name `vm` reads as an option before it.
 */
import { EventEmitter } from 'node:events'
import { plantedKeyCount, shadowDecoder } from './server-option-names'
import type * as ServerOptionNames from './server-option-names'

/**
 * The module, loaded afresh. It imports the baseline of built-ins from the package's shared runtime, which loads the whole of
 * Nest, and Nest cannot load in a process whose standard names were replaced before it: the rows that replace them stand in
 * for that one function, which has its own rows in the spec of the baseline.
 */
function loadFresh(): typeof ServerOptionNames {
  let loaded: typeof ServerOptionNames | undefined
  jest.isolateModules(() => {
    jest.doMock('@bymax-one/nest-realtime/internal', () => ({ replacedBuiltinCount: () => 0 }))
    loaded = require('./server-option-names') as typeof ServerOptionNames
  })
  return loaded as typeof ServerOptionNames
}

describe('a process whose Object.prototype was changed before the library was loaded', () => {
  type Names = typeof ServerOptionNames
  const loadedWith = (change: () => void, restore: () => void): Names => {
    let loaded: Names | undefined
    change()
    try {
      loaded = loadFresh()
    } finally {
      restore()
    }
    return loaded as Names
  }
  const descriptorOfProto = (): PropertyDescriptor =>
    Object.getOwnPropertyDescriptor(Object.prototype, '__proto__') as PropertyDescriptor
  const override = (name: string, value: unknown): [() => void, () => void] => {
    const saved = Object.getOwnPropertyDescriptor(Object.prototype, name) as PropertyDescriptor
    return [
      () => Object.defineProperty(Object.prototype, name, { ...saved, value }),
      () => Object.defineProperty(Object.prototype, name, saved),
    ]
  }

  // Scenario: a standard name holds a non-function, a function with another name, or (for __proto__) a plain value when
  // the library is loaded. Expected: the library loads, and the count is not zero on any use after, restored or not.
  it.each([
    ['hasOwnProperty', 1],
    ['toString', function other() {}],
    [
      'hasOwnProperty',
      function hasOwnProperty() {
        return false
      },
    ],
    [
      'valueOf',
      function valueOf() {
        return 1
      },
    ],
    ['hasOwnProperty', new Proxy(Object.prototype.hasOwnProperty, {})],
    ['hasOwnProperty', Object.prototype.hasOwnProperty.bind(null)],
    ['hasOwnProperty', Object.prototype.isPrototypeOf],
    ['constructor', 'x'],
  ])('counts %s, set to %p at load, on every use', (name, value) => {
    const [change, restore] = override(name, value)
    const loaded = loadedWith(change, restore)

    // The one at load, and the name that is not what the polluted snapshot holds once it is restored.
    expect(loaded.plantedKeyCount()).toBe(2)
    expect(loaded.plantedKeyCount()).toBe(2)
  })

  // Scenario: __proto__ is an accessor whose getter and setter are plain JavaScript functions at load. Expected: counted.
  it('counts a __proto__ whose accessor is not built in', () => {
    const saved = Object.getOwnPropertyDescriptor(
      Object.prototype,
      '__proto__',
    ) as PropertyDescriptor
    const loaded = loadedWith(
      () =>
        Object.defineProperty(Object.prototype, '__proto__', {
          get: new Proxy(descriptorOfProto().get as () => unknown, {}),
          set: descriptorOfProto().set as (value: unknown) => void,
          configurable: true,
        }),
      () => Object.defineProperty(Object.prototype, '__proto__', saved),
    )

    expect(loaded.plantedKeyCount()).toBe(2)
  })

  it('counts a __proto__ that is not an accessor at load', () => {
    const saved = Object.getOwnPropertyDescriptor(
      Object.prototype,
      '__proto__',
    ) as PropertyDescriptor
    const loaded = loadedWith(
      () =>
        Object.defineProperty(Object.prototype, '__proto__', {
          value: 1,
          configurable: true,
          writable: true,
        }),
      () => Object.defineProperty(Object.prototype, '__proto__', saved),
    )

    expect(loaded.plantedKeyCount()).toBe(2)
  })

  it('counts a standard name that is missing at load', () => {
    const saved = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'isPrototypeOf',
    ) as PropertyDescriptor
    const loaded = loadedWith(
      () => Reflect.deleteProperty(Object.prototype, 'isPrototypeOf'),
      () => Object.defineProperty(Object.prototype, 'isPrototypeOf', saved),
    )

    expect(loaded.plantedKeyCount()).toBe(2)
  })

  it('counts nothing for a clean process', () => {
    expect(
      loadedWith(
        () => undefined,
        () => undefined,
      ).plantedKeyCount(),
    ).toBe(0)
  })
})

describe('a descriptor field planted on Object.prototype', () => {
  const FIELD_NAMES = ['get', 'set', 'value', 'writable', 'enumerable', 'configurable']
  const planting = <T>(run: () => T): T => {
    for (const name of FIELD_NAMES) {
      // The descriptor has no prototype, since defineProperty itself reads the fields a descriptor lacks.
      const descriptor = Object.assign(Object.create(null) as object, {
        get: () => {
          throw new Error(`the field ${name} was read`)
        },
        configurable: true,
      })
      Object.defineProperty(Object.prototype, name, descriptor)
    }
    try {
      return run()
    } finally {
      for (const name of FIELD_NAMES) Reflect.deleteProperty(Object.prototype, name)
    }
  }

  // Scenario: accessors named like the fields of a descriptor, which throw, are planted. Expected: counting reads no field
  // the descriptors do not hold themselves, so it returns the count (one per planted name) and does not throw.
  it('is not read while the planted keys are counted', () => {
    expect(planting(() => plantedKeyCount())).toBe(FIELD_NAMES.length)
  })
})

describe('the count, with the built-ins of the process replaced after the library loaded', () => {
  type Slot = [object, PropertyKey]
  const SLOTS: Slot[] = [
    [Array.prototype, 'some'],
    [Array.prototype, 'every'],
    [Array.prototype, 'filter'],
    [Array.prototype, 'indexOf'],
    [Array.prototype, 'includes'],
    [Array.prototype, Symbol.iterator],
    [Set.prototype, 'has'],
    [Map.prototype, 'get'],
    [Object, 'is'],
    [Object, 'getOwnPropertyNames'],
    [Object, 'getOwnPropertyDescriptor'],
    [Reflect, 'apply'],
    [Function.prototype, 'call'],
    [Function.prototype, 'apply'],
    [Function.prototype, 'toString'],
  ]

  // Scenario: each built-in the check could have used is replaced by one that answers as if nothing changed, and a standard
  // name is then overwritten. Expected: the overwrite is still counted, so is a key outside the standard names, and so is each
  // replaced built-in the library's other code calls (14 of the 15 are in that list).
  it('still counts an overwrite and a new key', () => {
    // Index loops and no destructuring throughout: the iterator protocol is one of the things replaced.
    const saved: (PropertyDescriptor | undefined)[] = []
    for (let n = 0; n < SLOTS.length; n += 1) {
      const slot = SLOTS[n] as Slot
      saved[n] = Object.getOwnPropertyDescriptor(slot[0], slot[1])
    }
    const toStringBefore = Object.getOwnPropertyDescriptor(Object.prototype, 'toString')
    let count = -1
    try {
      for (let n = 0; n < SLOTS.length; n += 1) {
        const slot = SLOTS[n] as Slot
        Object.defineProperty(slot[0], slot[1], {
          value: () => false,
          configurable: true,
          writable: true,
        })
      }
      Object.defineProperty(Object.prototype, 'toString', {
        value: 0,
        configurable: true,
        writable: true,
      })
      Object.defineProperty(Object.prototype, 'zzNew', { value: 1, configurable: true })
      count = plantedKeyCount()
    } finally {
      for (let n = 0; n < SLOTS.length; n += 1) {
        const slot = SLOTS[n] as Slot
        Object.defineProperty(slot[0], slot[1], saved[n] as PropertyDescriptor)
      }
      Object.defineProperty(Object.prototype, 'toString', toStringBefore as PropertyDescriptor)
      Reflect.deleteProperty(Object.prototype, 'zzNew')
    }

    expect(count).toBe(16)
  })
})

describe('the count, in the cases a loop bound or a branch could hide', () => {
  type Names = typeof ServerOptionNames

  // Scenario: a standard name is missing when the library loads and is still missing when it counts. Expected: one, for
  // the name that was not there at load, and nothing for a name that has not changed since.
  it('counts a name that was missing at load once while it stays missing', () => {
    const saved = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'isPrototypeOf',
    ) as PropertyDescriptor
    let count = -1
    try {
      Reflect.deleteProperty(Object.prototype, 'isPrototypeOf')
      count = loadFresh().plantedKeyCount()
    } finally {
      Object.defineProperty(Object.prototype, 'isPrototypeOf', saved)
    }

    expect(count).toBe(1)
  })

  // Scenario: a key named `undefined` is planted. Expected: it is one planted key, like any other new name.
  it('counts a key named undefined once', () => {
    Object.defineProperty(Object.prototype, 'undefined', {
      value: 1,
      configurable: true,
      enumerable: true,
      writable: true,
    })
    try {
      expect(plantedKeyCount()).toBe(1)
    } finally {
      Reflect.deleteProperty(Object.prototype, 'undefined')
    }
  })

  // Scenario: __proto__ keeps its built-in getter but has a setter written in JavaScript when the library loads.
  // Expected: counted, so the setter is compared as well as the getter.
  it('counts a __proto__ whose setter is not built in', () => {
    const saved = Object.getOwnPropertyDescriptor(
      Object.prototype,
      '__proto__',
    ) as PropertyDescriptor
    let loaded: Names | undefined
    try {
      Object.defineProperty(Object.prototype, '__proto__', {
        get: saved.get as () => unknown,
        set: () => undefined,
        configurable: true,
      })
      loaded = loadFresh()
    } finally {
      Object.defineProperty(Object.prototype, '__proto__', saved)
    }

    expect(loaded?.plantedKeyCount()).toBe(2)
  })

  // Scenario: a decoder of the replaced class. Expected: its two own names can be removed and rewritten by the host's
  // listener code, and show up when the object is enumerated, as an own name the class would have set itself.
  it('gives a decoder its own names as ordinary, changeable properties', () => {
    class Decoder {}
    const server: { _parser?: { Decoder: new () => object } } = { _parser: { Decoder } }
    shadowDecoder(server)
    const decoder = new (server._parser?.Decoder as new () => object)()

    for (const name of ['reconstructor', '_callbacks']) {
      expect(Object.getOwnPropertyDescriptor(decoder, name)).toStrictEqual({
        value: undefined,
        writable: true,
        enumerable: true,
        configurable: true,
      })
    }
  })
})

describe('a process whose vm options were planted before the library loaded', () => {
  type Names = typeof ServerOptionNames
  const SECRET = 'SECRET-planted-value'

  // Scenario: a wrong-typed value is planted under a name `vm` reads as an option, and the library is loaded. Expected: the
  // load does not throw, and the count is one, from then on, whatever is done to the planted key afterwards: the clean
  // realm could not be made, so no baseline was taken.
  it.each(['microtaskMode', 'timeout', 'contextCodeGeneration', 'importModuleDynamically'])(
    'loads, and refuses every use, with %s planted',
    (name) => {
      let loaded: Names | undefined
      // `vm` builds its options in the realm of Node itself, which is not the realm the test runs in.
      const roots = [Object.prototype, Object.getPrototypeOf(EventEmitter.prototype) as object]
      for (const root of roots) {
        Object.defineProperty(root, name, {
          value: SECRET,
          configurable: true,
          enumerable: true,
          writable: true,
        })
      }
      try {
        loaded = loadFresh()
      } finally {
        for (const root of roots) Reflect.deleteProperty(root, name)
      }

      expect(loaded?.plantedKeyCount()).toBe(1)
      expect(loaded?.plantedKeyMessage(1)).not.toContain(SECRET)
    },
  )

  // Scenario: `vm` itself throws while the realm is made, with a message that holds what was planted. Expected: the load
  // does not throw and the message is not kept anywhere the refusal could print it.
  it('loads, and refuses every use, when the realm cannot be made', () => {
    let loaded: Names | undefined
    jest.isolateModules(() => {
      jest.doMock('@bymax-one/nest-realtime/internal', () => ({ replacedBuiltinCount: () => 0 }))
      jest.doMock('node:vm', () => ({
        runInNewContext: () => {
          throw new Error(SECRET)
        },
      }))
      loaded = require('./server-option-names') as Names
    })

    // Short-circuits: more planted keys do not change a count that is one because nothing could be compared with.
    for (const name of ['zzFirstPlanted', 'zzSecondPlanted']) {
      Object.defineProperty(Object.prototype, name, {
        value: 1,
        configurable: true,
        enumerable: true,
        writable: true,
      })
    }
    let withPlanted = -1
    try {
      withPlanted = loaded?.plantedKeyCount() ?? -1
    } finally {
      Reflect.deleteProperty(Object.prototype, 'zzFirstPlanted')
      Reflect.deleteProperty(Object.prototype, 'zzSecondPlanted')
    }

    expect(loaded?.plantedKeyCount()).toBe(1)
    expect(withPlanted).toBe(1)
    expect(loaded?.plantedKeyMessage(loaded.plantedKeyCount())).not.toContain(SECRET)
  })
})
