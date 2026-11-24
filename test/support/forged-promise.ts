/**
 * @fileoverview Runs a block with one Promise built-in replaced the way a hostile or careless host could:
 * `race`, `resolve` and `then` each answer a forged value instead of what was asked.
 * @layer test
 */

/** Which built-in is replaced. */
export type ForgedBuiltin = 'race' | 'resolve' | 'then'

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
  const realResolve = Promise.resolve.bind(Promise)
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
    target['resolve'] = realResolve
    proto['then'] = realThen
  }
}
