/**
 * @fileoverview Pins the README's option defaults and name catalogs to the code.
 * @layer composition
 *
 * `check:published` compiles the README's fenced snippets, but a table cell or a sentence
 * is prose, and prose drifts silently: a default changes in code and the table keeps
 * the old value, a constant is renamed and the catalog keeps the old name. These tests
 * parse the README itself and compare what it says with the constants the code uses.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PRESENCE_EVENT_NAMES,
  RESERVED_EVENT_NAMES,
} from '../shared/constants/reserved-events.constants'
import { REALTIME_ERROR_CODES } from '../shared/constants/error-codes.constants'
import { DEFAULT_SSE } from './config/default-options'
import * as injectionTokens from './constants/injection-tokens.constants'
import { resolvePolicy } from './services/reauthentication.service'

const README = readFileSync(join(__dirname, '..', '..', 'README.md'), 'utf8')

/** Every backticked span in `text`, in order. */
function backticked(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string)
}

/** The cells of the README table row whose first cell is `**name**`. */
function rowCells(name: string): string[] {
  const line = README.split('\n').find((l) => l.startsWith(`| **${name}**`))
  if (line === undefined) throw new Error(`README has no table row for ${name}`)
  // A literal `|` inside a cell is escaped as `\|`, so split only on the unescaped ones.
  return line
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((cell) => cell.trim())
}

/** The README text under the `###` heading `title`, up to the next heading. */
function section(title: string): string {
  const lines = README.split('\n')
  const start = lines.findIndex((l) => l === `### ${title}`)
  if (start === -1) throw new Error(`README has no section ${title}`)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => l.startsWith('#'))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

/** A default as the README writes it: surrounding quotes stripped. */
const unquote = (token: string): string => token.replace(/^'(.*)'$/, '$1')

describe('README — Configuration table defaults', () => {
  // The table lists keys and defaults in two cells, in the same order, so the zip below
  // is the contract: reordering one cell without the other fails here.
  it('lists every sse option with the default the code applies', () => {
    const [, keys, defaults] = rowCells('sse') as [string, string, string]

    expect(backticked(keys)).toEqual(Object.keys(DEFAULT_SSE))
    expect(backticked(defaults)).toEqual(Object.values(DEFAULT_SSE).map(String))
  })

  it('lists every reauthenticationPolicy option with the default the code applies', () => {
    const [, keys, defaults] = rowCells('reauthenticationPolicy') as [string, string, string]
    const policy = resolvePolicy(undefined)

    // The key cell also quotes the allowed `onFailure` values, which are not keys.
    const names = backticked(keys).filter((token) => /^[A-Za-z]+$/.test(token))
    expect(names).toEqual(Object.keys(policy))
    expect(backticked(defaults).map(unquote)).toEqual(Object.values(policy).map(String))
  })
})

describe('README — name catalogs', () => {
  it('lists exactly the error codes the library defines', () => {
    expect(new Set(backticked(section('Error Codes')))).toEqual(
      new Set(Object.values(REALTIME_ERROR_CODES)),
    )
  })

  it('lists exactly the DI tokens the library exports', () => {
    expect(new Set(backticked(section('DI Tokens')))).toEqual(
      new Set(Object.keys(injectionTokens).filter((name) => name.endsWith('_TOKEN'))),
    )
  })

  it('lists exactly the reserved event names, emitted and not', () => {
    const documented = backticked(section('Reserved Events')).filter((token) =>
      /^(error|[a-z]+:[a-z-]+)$/.test(token),
    )

    expect(new Set(documented)).toEqual(
      new Set([...Object.values(RESERVED_EVENT_NAMES), ...Object.values(PRESENCE_EVENT_NAMES)]),
    )
  })
})
