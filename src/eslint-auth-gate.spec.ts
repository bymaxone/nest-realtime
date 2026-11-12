/**
 * Pins the ESLint rule that keeps authentication packages out of `src/`. The library never imports
 * one, the consumer plugs `IConnectionAuthenticator`, and the README says a lint rule enforces it.
 * A module can be named by a string in any call shape, so the rule matches the string and each case
 * here is a different shape: `no-restricted-imports` alone sees static imports and re-exports, and
 * a rule written per syntax form missed `import()`, `require()`, `module.require()` and a template
 * literal in turn.
 *
 * Each case lints a snippet from stdin under a `src` path, the way `pnpm lint` would see a file there.
 *
 * Layer: repository tooling, tests.
 */
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

jest.setTimeout(60_000)

const ESLINT = resolve(__dirname, '..', 'node_modules', 'eslint', 'bin', 'eslint.js')
const ROOT = resolve(__dirname, '..')
const MESSAGE = 'This library never imports an auth package'

interface Result {
  readonly status: number | null
  readonly output: string
}

/** Lints `code` as if it were `path`, a file under `src`, and returns the exit code and the report. */
function lint(path: string, code: string): Promise<Result> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [ESLINT, '--stdin', '--stdin-filename', path], {
      cwd: ROOT,
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.on('error', fail)
    child.on('close', (status) => done({ status, output }))
    child.stdin.end(code)
  })
}

describe('the auth-import rule', () => {
  // One shape each, over names from every family the rule covers: the JWT module, this
  // organisation's auth package, Passport, a Passport strategy and the Nest Passport wrapper.
  const FORMS: ReadonlyArray<readonly [string, string]> = [
    ['a static import', "import { JwtService } from '@nestjs/jwt'\nexport const a = JwtService"],
    ['a static import of a subpath', "import { J } from '@nestjs/jwt/dist/x'\nexport const a = J"],
    ['a type-only import', "import type { S } from 'passport-jwt'\nexport type U = S"],
    ['a re-export', "export * from 'passport-jwt'"],
    ['an import-equals require', "import x = require('@bymax-one/nest-auth')\nexport const b = x"],
    ['a dynamic import', "export const c = await import('@bymax-one/nest-auth/server')"],
    ['a dynamic import with a template literal', 'export const d = await import(`passport-jwt`)'],
    [
      'a dynamic import of the Nest Passport wrapper',
      "export const e = import('@nestjs/passport')",
    ],
    ['a require call', "export const f = require('@nestjs/jwt')"],
    ['a require call with a template literal', 'export const g = require(`@nestjs/jwt`)'],
    ['a module.require call', "export const h = module.require('@nestjs/jwt')"],
    ['a require.resolve call', "export const i = require.resolve('@nestjs/jwt')"],
    [
      'a createRequire call',
      "import { createRequire } from 'node:module'\nexport const j = createRequire(import.meta.url)('passport-jwt')",
    ],
    ['a type-level import', "export type T = import('passport-jwt').Strategy"],
  ]

  it.each(FORMS)('refuses %s in src/server', async (_form, code) => {
    const result = await lint('src/server/probe.ts', code)

    expect(result.status).toBe(1)
    expect(result.output).toContain(MESSAGE)
  })

  // src/shared sets `no-restricted-imports` for itself, so the rule has to hold there too.
  it('refuses a static import in src/shared as well', async () => {
    const result = await lint('src/shared/probe.ts', FORMS[0]?.[1] ?? '')

    expect(result.status).toBe(1)
    expect(result.output).toContain(MESSAGE)
  })

  // A string that merely resembles a package name is not a specifier for one.
  it('accepts an ordinary module and a string that only resembles an auth package', async () => {
    const result = await lint(
      'src/server/probe.ts',
      "export const k = await import('@nestjs/common')\nexport const l = require('node:path')\nexport const m = 'passports and visas'",
    )

    expect(result.output).not.toContain(MESSAGE)
  })
})
