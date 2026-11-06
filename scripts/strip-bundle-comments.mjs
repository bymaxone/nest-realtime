#!/usr/bin/env node
/**
 * @fileoverview Post-build step: removes the comments from the shipped JavaScript bundles.
 * @layer scripts
 *
 * tsup builds without minifying, so esbuild leaves every JSDoc block and `//` comment in
 * `dist/**\/index.mjs` and `index.cjs`. About half of those bundles' brotli size is that prose,
 * which a consumer's runtime never reads: the documentation people see in an editor comes from
 * the `.d.ts` and `.d.cts` files, and this script never touches them.
 *
 * What is removed and what is kept:
 * - Every comment goes, and a line that held only a comment goes with it, so the code keeps its
 *   structure, its identifiers and its line-by-line shape. A stack frame still points at readable
 *   code, which minifying the whitespace would not give.
 * - Kept: `/*!` and `//!` blocks, `@license` and `@preserve`, the `__PURE__` and
 *   `__NO_SIDE_EFFECTS__` annotations (a consumer's bundler uses them to drop unused calls), and
 *   the `// src/...` region markers esbuild writes between modules, which tell a reader which
 *   source file a stretch of the bundle came from.
 * - The TypeScript parser finds the comments, so text that only looks like one, inside a string,
 *   a template literal or a regular expression, is never touched.
 *
 * Running it twice gives the same bytes. Usage (from the package root):
 *   node scripts/strip-bundle-comments.mjs            strips dist/
 *   node scripts/strip-bundle-comments.mjs <dir>      strips another directory, for tests
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')

const BUNDLE_FILE_RE = /^index\.(mjs|cjs)$/
const KEPT_COMMENT_RE = /^\/\*!|^\/\/!|@license|@preserve|__PURE__|__NO_SIDE_EFFECTS__|^\/\/ src\//

/** Characters that never join the character next to them into a longer token. */
const NEVER_JOINS = new Set('(){}[];,')

/**
 * Whether two stretches of code, once the comment between them is gone, would touch in a way that
 * lets the parser read a different token: `return` and `1` as `return1`, `+` and `+` as `++`, `/`
 * and `/` as a comment. Anything but whitespace or a bracket, comma or semicolon on both sides is
 * treated as able to join.
 *
 * @param {string} left - Code before the comment, without the blanks that preceded it.
 * @param {string} right - Code after the comment.
 * @returns {boolean} `true` when one space has to stay between them.
 */
function needsSpace(left, right) {
  const a = left.at(-1)
  const b = right.at(0)
  if (a === undefined || b === undefined) return false
  return !/\s/.test(a) && !/\s/.test(b) && !NEVER_JOINS.has(a) && !NEVER_JOINS.has(b)
}

/**
 * Removes the comments of one bundle.
 *
 * @param {string} source - Contents of a `.mjs` or `.cjs` bundle.
 * @returns {string} The same code without its comments, apart from the kept ones.
 */
export function stripComments(source) {
  const file = ts.createSourceFile(
    'bundle.js',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  )
  const ranges = new Map()
  const collect = (node) => {
    // A token's comments are its leading trivia; the end of file token holds the last ones.
    for (const range of ts.getLeadingCommentRanges(source, node.getFullStart()) ?? []) {
      if (!KEPT_COMMENT_RE.test(source.slice(range.pos, range.end))) ranges.set(range.pos, range)
    }
    for (const range of ts.getTrailingCommentRanges(source, node.getEnd()) ?? []) {
      if (!KEPT_COMMENT_RE.test(source.slice(range.pos, range.end))) ranges.set(range.pos, range)
    }
    // JSDoc nodes are children too, but their text is comment text, not code.
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode)
      return
    for (const child of node.getChildren(file)) collect(child)
  }
  collect(file)

  let output = source
  for (const { pos, end } of [...ranges.values()].sort((a, b) => b.pos - a.pos)) {
    const lineStart = output.lastIndexOf('\n', pos - 1) + 1
    const lineEndAt = output.indexOf('\n', end)
    const lineEnd = lineEndAt === -1 ? output.length : lineEndAt
    const before = output.slice(lineStart, pos)
    const after = output.slice(end, lineEnd)
    if (before.trim() === '' && after.trim() === '') {
      // The comment owned its line: remove the line, newline included.
      output = output.slice(0, lineStart) + output.slice(lineEndAt === -1 ? lineEnd : lineEnd + 1)
    } else {
      // Code shares the line: drop the comment and the blanks that separated it from the code. A
      // comment that spans lines counts as a line break to the parser (after `return` it ends the
      // statement), so one break stays when code follows it.
      const lineBreak =
        before.trim() !== '' && after.trim() !== '' && source.slice(pos, end).includes('\n')
      const kept = output.slice(0, pos - (before.length - before.trimEnd().length))
      output =
        kept +
        (lineBreak ? '\n' : needsSpace(kept, output.slice(end)) ? ' ' : '') +
        output.slice(end)
    }
  }
  return output
}

/** The program of a bundle, printed without its comments or its formatting. */
function printProgram(source) {
  const file = ts.createSourceFile(
    'bundle.js',
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  )
  return ts.createPrinter({ removeComments: true }).printFile(file)
}

/**
 * Whether two bundles are the same program: parsed and printed without comments, they are equal.
 * A strip that fused two tokens, dropped a line break the parser counted, or removed code reads
 * differently here even when both files are valid.
 *
 * @param {string} before - The bundle as built.
 * @param {string} after - The bundle with its comments removed.
 * @returns {boolean} `true` when only comments and formatting differ.
 */
export function sameProgram(before, after) {
  return printProgram(before) === printProgram(after)
}

/** The `index.mjs` and `index.cjs` files under `root`, never a declaration file. */
function bundleFiles(root) {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (BUNDLE_FILE_RE.test(entry)) found.push(path)
    }
  }
  walk(root)
  return found.sort()
}

/**
 * Strips every bundle under `root`, after proving that each one is still the same program.
 * Nothing is written unless every bundle passes.
 *
 * @param {string} root - Directory that holds the bundles, `dist` for the build.
 * @param {(source: string) => string} [strip] - The strip to apply; a test passes a broken one.
 * @returns {{ ok: boolean, message?: string, files: { path: string, before: number, after: number }[] }}
 */
export function stripDirectory(root, strip = stripComments) {
  const paths = bundleFiles(root)
  if (paths.length === 0) {
    return {
      ok: false,
      message: `No index.mjs or index.cjs under ${root}: run the build first.`,
      files: [],
    }
  }
  const results = paths.map((path) => {
    const before = readFileSync(path, 'utf8')
    return { path, before, after: strip(before) }
  })
  const changed = results.filter((result) => result.after !== result.before)
  const diverged = changed.filter((result) => !sameProgram(result.before, result.after))
  if (diverged.length > 0) {
    return {
      ok: false,
      message: `Removing the comments changed the program of: ${diverged.map((r) => r.path).join(', ')}. Nothing was written.`,
      files: [],
    }
  }
  for (const { path, after } of changed) writeFileSync(path, after)
  return {
    ok: true,
    files: results.map(({ path, before, after }) => ({
      path,
      before: before.length,
      after: after.length,
    })),
  }
}

function main() {
  const result = stripDirectory(resolve(process.argv[2] ?? 'dist'))
  if (!result.ok) {
    console.error(result.message)
    return 1
  }
  for (const { path, before, after } of result.files)
    console.log(`${path}: ${before} -> ${after} bytes`)
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main())
}
