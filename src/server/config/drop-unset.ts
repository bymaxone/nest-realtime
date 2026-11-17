/**
 * @fileoverview Option objects without the keys that hold nothing.
 * @layer composition
 */

/** The option groups whose own keys are merged with defaults or read as bounds. */
const GROUPS = ['sse', 'websocket', 'reauthenticationPolicy'] as const

function withoutUnset(source: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== null),
  )
}

/** A group is a plain object; anything else is left for the validator to refuse. */
function isPlainGroup(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Copy module options without the own keys that hold `undefined` or `null`, at the top level and in
 * every group.
 *
 * `{ ...defaults, ...options }` lets an own key holding `undefined` overwrite the default, and a bound
 * that is then missing reads as "switched off". Dropping the key first means an unset option, however
 * it was spelled, resolves to its default and is validated as absent. Values that are objects with
 * behaviour (the authenticator, a queue, a hook table) are kept by reference.
 *
 * @param options - The options as the host wrote them.
 * @returns A copy in which every unset key is absent.
 */
export function dropUnset<T extends object>(options: T): T {
  const kept = withoutUnset(options)
  for (const group of GROUPS) {
    const value = kept[group]
    if (isPlainGroup(value)) kept[group] = withoutUnset(value)
  }
  return kept as T
}
