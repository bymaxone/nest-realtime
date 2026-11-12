/**
 * Pins the ESLint rule that keeps authentication packages out of `src/`. The library never imports
 * one, the consumer plugs `IConnectionAuthenticator`, and the README says a lint rule enforces it,
 * so each way of loading a module has to be refused: `no-restricted-imports` sees static imports
 * and re-exports only, and a dynamic `import()` or a `require()` needs its own selector.
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
  // Every form of a module load, for a name from each family the rule covers: the JWT module, this
  // organisation's auth package, Passport and a Passport strategy, and the Nest Passport wrapper.
  const FORMS: ReadonlyArray<readonly [string, string]> = [
    ['a static import', "import { JwtService } from '@nestjs/jwt'\nexport const a = JwtService"],
    ['a re-export', "export * from 'passport-jwt'"],
    ['a dynamic import', "export const b = await import('@bymax-one/nest-auth/server')"],
    ['a require call', "export const c = require('@nestjs/jwt')"],
    ['a dynamic import of a Passport strategy', "export const d = await import('passport-jwt')"],
    [
      'a dynamic import of the Nest Passport wrapper',
      "export const e = import('@nestjs/passport')",
    ],
  ]

  it.each(FORMS)('refuses %s in src/server', async (_form, code) => {
    const result = await lint('src/server/probe.ts', code)

    expect(result.status).toBe(1)
    expect(result.output).toContain(MESSAGE)
  })

  // src/shared carries its own `no-restricted-imports` list, which replaces the general one.
  it('refuses a static import in src/shared, where the rule is configured separately', async () => {
    const result = await lint('src/shared/probe.ts', FORMS[0]?.[1] ?? '')

    expect(result.status).toBe(1)
    expect(result.output).toContain(MESSAGE)
  })

  it('accepts a dynamic import and a require of an ordinary module', async () => {
    const result = await lint(
      'src/server/probe.ts',
      "export const f = await import('@nestjs/common')\nexport const g = require('node:path')",
    )

    expect(result.output).not.toContain(MESSAGE)
  })
})
