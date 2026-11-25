/**
 * @fileoverview An `afterAll` that closes a handle its `beforeAll` may never have set is a defect of its own.
 * @layer test
 *
 * When `beforeAll` throws, the handle is still `undefined`, and `await app.close()` in `afterAll` throws a
 * TypeError of its own. Jest reports that as an error of the whole suite, not of a test, and a mutation run counts
 * the mutant that broke the setup as a `RuntimeError` instead of a failed row: 128 mutants were counted that way
 * in the cold run on `e13f41b`, all from one spec file. An `afterEach` is not in scope: its error lands on the test
 * that failed already, so the run still counts that mutant as killed.
 *
 * The scan is a source scan, and its blind spots are these. It reads only an `afterAll` whose body is a block, written
 * as an arrow or as a `function` expression, with or without a name or a return type; an arrow whose body is an
 * expression, and `afterAll(teardown)`, are not seen. It knows a handle only by a `let name: Type` or
 * `let name!: Type` line in the same file, so a handle that is a class field, a destructured value or an import is not
 * seen. It reads a call written `name.close(`, `name!.close(` and the other closers listed below anywhere in the hook
 * body, inside `Promise.all` too, but not one made through an alias or a helper. A call is guarded when it is
 * written `name?.method(`, or when the hook body tests the name, by `if (name`, `name &&` or `name !== undefined`,
 * before the call; a test that only follows the call does not count. A guard written some other way is a false
 * positive the author can answer by declaring the handle `Type | undefined`. Comments are removed before the scan,
 * but a brace inside a string or template literal in a hook body is not, and can end the hook early, and a `//`
 * inside a string removes the rest of its line. The scan of the tree skips this file, whose fixtures are the shape
 * it looks for.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const CLOSERS = 'close|disconnect|quit|stop|destroy|end|terminate'

/** The scan covers every spec the repository runs, unit and end-to-end. */
const ROOTS = ['src', 'test']

/** This file holds the shape the scan looks for as fixtures, so the scan of the tree skips it. */
const OWN_NAME = 'spec-teardown-guard.spec.ts'

const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/** The body of the hook whose opening brace is at `open`, by brace depth. */
function bodyFrom(source: string, open: number): string {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i)
  }
  return source.slice(open + 1)
}

/** Handles declared as `let name: Type` with no `undefined` in the type, and so never guarded by the compiler. */
function unionlessHandles(source: string): Set<string> {
  const names = new Set<string>()
  for (const line of source.split('\n')) {
    const match = /^\s*let\s+(\w+)!?\s*:\s*([^=;]+?)\s*;?\s*$/.exec(line)
    if (match?.[1] !== undefined && !(match[2] ?? '').includes('undefined')) names.add(match[1])
  }
  return names
}

/** Each unguarded `handle.close()` a `afterAll` hook of `source` makes on a handle that may never have been set. */
function unguardedTeardowns(source: string): string[] {
  const text = withoutComments(source)
  const handles = unionlessHandles(text)
  const found: string[] = []
  const hook =
    /\bafterAll\(\s*(?:async\s*)?(?:function\s*\w*\s*\([^)]*\)|\([^)]*\))\s*(?::\s*[^={]+?)?\s*(?:=>\s*)?\{/g
  for (let at = hook.exec(text); at !== null; at = hook.exec(text)) {
    const body = bodyFrom(text, at.index + at[0].length - 1)
    for (const call of body.matchAll(new RegExp(`\\b(\\w+)(\\?|!)?\\.(${CLOSERS})\\(`, 'g'))) {
      const [, name, optional, method] = call
      if (name === undefined || !handles.has(name) || optional === '?') continue
      const tested = new RegExp(
        `if\\s*\\(\\s*${name}\\b|\\b${name}\\s*&&|\\b${name}\\s*!==?\\s*undefined`,
      )
      if (!tested.test(body.slice(0, call.index))) found.push(`${name}.${method ?? ''}()`)
    }
  }
  return found
}

function specFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : specFiles(path)
    return /(?:\.spec|\.e2e-spec)\.tsx?$/.test(entry.name) ? [path] : []
  })
}

describe('the teardown scan', () => {
  const OLD_SHAPE = `
    describe('a', () => {
      let app: INestApplication
      beforeAll(async () => { app = await boot() })
      afterAll(async () => {
        await app.close()
        jest.restoreAllMocks()
      })
    })
    describe('b', () => {
      let server: Server
      afterAll(async () => { await server.close() })
    })`

  it('finds a handle declared without undefined and closed with no guard', () => {
    expect(unguardedTeardowns(OLD_SHAPE)).toStrictEqual(['app.close()', 'server.close()'])
  })

  it.each([
    [
      'declared with undefined and closed with ?.',
      'let app: App | undefined\nafterAll(async () => { await app?.close() })',
    ],
    ['tested first with if', 'let app: App\nafterAll(async () => { if (app) await app.close() })'],
    ['tested first with &&', 'let app: App\nafterAll(async () => { app && (await app.close()) })'],
    [
      'written as a function expression and guarded',
      'let app: App\nafterAll(async function () { await app?.close() })',
    ],
    ['not a handle the file declares', 'afterAll(async () => { await other.close() })'],
    [
      'an afterEach, which the scan leaves out',
      'let app: App\nafterEach(async () => { await app.close() })',
    ],
    [
      'named only in a comment',
      'let app: App\nafterAll(async () => {\n // app.close() would throw\n })',
    ],
  ])('leaves a teardown that is %s', (_name, source) => {
    expect(unguardedTeardowns(source)).toStrictEqual([])
  })

  it.each([
    ['a function expression', 'let app: App\nafterAll(async function () { await app.close() })'],
    [
      'a named function expression',
      'let app: App\nafterAll(async function t() { await app.close() })',
    ],
    [
      'an arrow with a return type',
      'let app: App\nafterAll(async (): Promise<void> => { await app.close() })',
    ],
    [
      'a close inside Promise.all',
      'let app: App\nafterAll(async () => { await Promise.all([app.close()]) })',
    ],
    ['a non-null assertion', 'let app: App\nafterAll(async () => { await app!.close() })'],
    ['a definite-assignment handle', 'let app!: App\nafterAll(async () => { await app.close() })'],
    [
      'a test that comes only after the close',
      'let app: App\nafterAll(async () => { await app.close(); if (app) jest.restoreAllMocks() })',
    ],
  ])('finds an unguarded close written as %s', (_name, source) => {
    expect(unguardedTeardowns(source)).toStrictEqual(['app.close()'])
  })
})

describe('every spec in the repository', () => {
  it('closes in afterAll only a handle that may be undefined, or tests it first', () => {
    const offenders = ROOTS.flatMap((root) => specFiles(root))
      .filter((path) => !path.endsWith(OWN_NAME))
      .flatMap((path) =>
        unguardedTeardowns(readFileSync(path, 'utf8')).map(
          (call) => `${relative('.', path)}: ${call}`,
        ),
      )

    expect(offenders).toStrictEqual([])
  })
})
