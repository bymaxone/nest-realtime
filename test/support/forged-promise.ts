/**
 * @fileoverview Runs a block with one Promise built-in replaced the way a hostile or careless host could:
 * `race`, `resolve` and `then` each answer a forged value instead of what was asked.
 * @layer test
 */

/** Which built-in is replaced. */
export type ForgedBuiltin = 'race' | 'resolve' | 'then'

/** Every Promise built-in the forgery tests replace in turn, so a site is exercised once per kind. */
export const FORGED_BUILTINS: readonly ForgedBuiltin[] = ['race', 'resolve', 'then']

/**
 * Runs `run` with `kind` replaced, and restores it before returning or throwing, so a failing
 * assertion cannot leave the process with a forged Promise for the next test.
 *
 * @param kind - The built-in to replace.
 * @param forged - What the replaced built-in makes every promise appear to settle with.
 * @param run - The block under test. It must not call the replaced built-in itself.
 */
export async function withPromiseForged<T>(
  kind: ForgedBuiltin,
  forged: unknown,
  run: () => Promise<T>,
): Promise<T> {
  const originalResolve = Promise.resolve
  const realResolve = originalResolve.bind(Promise)
  const realRace = Promise.race
  const realThen = Promise.prototype.then
  const target = Promise as unknown as Record<string, unknown>
  const proto = Promise.prototype as unknown as Record<string, unknown>
  if (kind === 'race') target['race'] = () => realResolve(forged)
  else if (kind === 'resolve') target['resolve'] = () => realResolve(forged)
  else {
    proto['then'] = function (this: Promise<unknown>, onFulfilled?: (value: unknown) => unknown) {
      if (typeof onFulfilled === 'function') onFulfilled(forged)
      return realThen.call(this, () => undefined)
    }
  }
  try {
    return await run()
  } finally {
    target['race'] = realRace
    target['resolve'] = originalResolve
    proto['then'] = realThen
  }
}

/**
 * Runs `run` with the constructor of every promise replaced and a `then` that puts the real one back before it answers
 * `forged`: a check made after the await sees nothing wrong. Both are restored before returning or throwing.
 *
 * @param forged - What every promise appears to settle with.
 * @param run - The block under test.
 */
export async function withConstructorReplacedAndRestored<T>(
  forged: unknown,
  run: () => Promise<T>,
): Promise<T> {
  const proto = Promise.prototype as unknown as Record<string, unknown>
  const realThen = Promise.prototype.then
  const realConstructor = Object.getOwnPropertyDescriptor(
    Promise.prototype,
    'constructor',
  ) as PropertyDescriptor
  Object.defineProperty(Promise.prototype, 'constructor', {
    ...realConstructor,
    value: function Fake() {},
  })
  proto['then'] = function (
    this: Promise<unknown>,
    onFulfilled?: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) {
    Object.defineProperty(Promise.prototype, 'constructor', realConstructor)
    // A rejection passes through untouched: only an answer is forged.
    return realThen.call(this, () => onFulfilled?.(forged), onRejected)
  }
  try {
    return await run()
  } finally {
    Object.defineProperty(Promise.prototype, 'constructor', realConstructor)
    proto['then'] = realThen
  }
}

/**
 * Plants, on `root`, a `then` that erases itself on first use and then answers `forged`. The caller removes it again if
 * nothing used it.
 *
 * @param root - The prototype to plant it on.
 * @param forged - What the first promise resolved with an object appears to settle with.
 */
export function plantSelfErasingThen(root: object, forged: unknown): void {
  Object.defineProperty(root, 'then', {
    configurable: true,
    value: (resolve: (value: unknown) => void) => {
      Reflect.deleteProperty(root, 'then')
      resolve(forged)
    },
  })
}

/**
 * Runs `run` with a `then` planted on `root` that erases itself on first use and then answers `forged`: it answers for
 * whichever promise is resolved with an object first, and leaves no trace. It is removed again before returning. The
 * test runner reads `then` as well, so `run` keeps what it observes in variables of its own and returns nothing.
 *
 * @param root - The prototype to plant it on.
 * @param forged - What the first promise resolved with an object appears to settle with.
 * @param run - The block under test.
 */
export async function withSelfErasingThen(
  root: object,
  forged: unknown,
  run: () => Promise<void>,
): Promise<void> {
  plantSelfErasingThen(root, forged)
  try {
    await run()
  } finally {
    Reflect.deleteProperty(root, 'then')
  }
}
