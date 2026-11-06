#!/usr/bin/env node
/**
 * @fileoverview File-size gate: no source, test or script file may pass 800 lines, except the
 * files on a baseline that can only shrink.
 * @layer scripts
 *
 * AGENTS.md raises a file that a change pushes past 800 lines, or that is already over and grows.
 * A reviewer applying that rule has to count lines, and one that misses a file leaves the next
 * author with a finding they did not cause. This script counts them instead.
 *
 * The baseline (`scripts/file-size-baseline.json`) maps a path to the line count it may not exceed.
 * It exists for files that were over the limit before the gate did, and it can only shrink:
 *
 * - a file over the limit that is not on it fails (a new file, or one a change pushed over);
 * - a file on it that grew past its ceiling fails;
 * - a file on it that is now at or under the limit fails until the entry is removed;
 * - a file on it that shrank fails until its ceiling is lowered to the new count;
 * - an entry for a file that no longer exists fails until it is removed;
 * - a baseline that is not an object of positive integers, or a tree with no file in it, fails.
 *
 * Usage: `node scripts/check-file-size.mjs [--root <dir>] [--limit <lines>]`. The root defaults to
 * the repository and the limit to 800; the options exist so the gate can be run over a small tree.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_LIMIT = 800
/** The directories the repository's own code lives in. */
const SCANNED = ['src', 'test', 'scripts']
const EXTENSIONS = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/
/** Vendored packages are not the repository's own code. */
const SKIPPED = new Set(['node_modules'])

/** Reads `--name value` options, rejecting anything it does not know. */
function parseArgs(argv) {
  const known = new Set(['--root', '--limit'])
  const options = {}
  for (let i = 0; i < argv.length; i += 2) {
    if (!known.has(argv[i]) || argv[i + 1] === undefined) {
      throw new Error(
        `usage: check-file-size.mjs [--root <dir>] [--limit <lines>] (got ${argv[i]})`,
      )
    }
    options[argv[i].slice(2)] = argv[i + 1]
  }
  return options
}

/** Every scanned file under `dir`, as a path relative to `root`. */
function walk(root, dir) {
  const found = []
  if (!existsSync(dir)) return found
  for (const name of readdirSync(dir)) {
    if (SKIPPED.has(name)) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) found.push(...walk(root, path))
    else if (EXTENSIONS.test(name)) found.push(relative(root, path).split(sep).join('/'))
  }
  return found
}

/**
 * Reads the baseline, refusing one it cannot trust: a ceiling that is not a positive integer would
 * make every comparison false and let an over-limit file pass.
 *
 * @param {string} path - Absolute path of the baseline file; a missing file is an empty baseline.
 * @returns {Record<string, number>} Ceiling by relative path.
 */
function readBaseline(path) {
  if (!existsSync(path)) return {}
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error.message}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path} must be an object mapping a path to its line ceiling`)
  }
  for (const [file, ceiling] of Object.entries(parsed)) {
    if (!Number.isInteger(ceiling) || ceiling < 1) {
      throw new Error(
        `the ceiling for ${file} in ${path} must be a positive integer (got ${JSON.stringify(ceiling)})`,
      )
    }
  }
  return parsed
}

/** The number of lines, counted the way `wc -l` counts them. */
function lineCount(path) {
  const text = readFileSync(path, 'utf8')
  let lines = 0
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lines++
  return lines
}

/**
 * Every way the tree breaks the rule.
 *
 * @param {Map<string, number>} sizes - Line count by relative path.
 * @param {Record<string, number>} baseline - Ceiling by relative path.
 * @param {number} limit - The most lines a file not on the baseline may have.
 * @returns {string[]} One message per violation.
 */
export function violations(sizes, baseline, limit) {
  const problems = []
  for (const [path, lines] of [...sizes].sort(([a], [b]) => a.localeCompare(b))) {
    const ceiling = baseline[path]
    if (ceiling === undefined) {
      if (lines > limit) {
        problems.push(
          `${path}: ${lines} lines, over the ${limit}-line limit and not on the baseline`,
        )
      }
    } else if (lines > ceiling) {
      problems.push(`${path}: ${lines} lines, past its baseline ceiling of ${ceiling}`)
    } else if (lines <= limit) {
      problems.push(`${path}: ${lines} lines, within the limit; remove it from the baseline`)
    } else if (lines < ceiling) {
      problems.push(
        `${path}: ${lines} lines; lower its baseline ceiling from ${ceiling} to ${lines}`,
      )
    }
  }
  for (const path of Object.keys(baseline).sort()) {
    if (!sizes.has(path)) problems.push(`${path}: on the baseline but no longer exists; remove it`)
  }
  return problems
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const root = resolve(options.root ?? join(dirname(fileURLToPath(import.meta.url)), '..'))
  const limit = Number(options.limit ?? DEFAULT_LIMIT)
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`invalid --limit: ${options.limit}`)

  const baseline = readBaseline(join(root, 'scripts', 'file-size-baseline.json'))
  const sizes = new Map()
  for (const directory of SCANNED) {
    for (const path of walk(root, join(root, directory)))
      sizes.set(path, lineCount(join(root, path)))
  }

  if (sizes.size === 0) {
    throw new Error(
      `no file found under src, test or scripts in ${root}; a gate that finds none checks none`,
    )
  }

  const problems = violations(sizes, baseline, limit)
  if (problems.length === 0) {
    console.log(
      `File-size gate: ${sizes.size} files, none over ${limit} lines outside the baseline.`,
    )
    return
  }
  console.error(`File-size gate failed (${problems.length}):`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(`File-size gate: ${error.message}`)
    process.exitCode = 1
  }
}
