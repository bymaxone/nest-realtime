/**
 * What is specific to this library in `stryker-scope.spec.ts`: the shipped files `mutate` leaves out and why, the
 * numbers that show the closure of the package entries was found, and the data files the build copies. This file is
 * not compared with the template.
 *
 * Layer: repository tooling, tests.
 */
import type { Exclusion } from './stryker-scope.spec'

/** Every shipped source file that `mutate` leaves out. */
export const EXCLUSIONS: readonly Exclusion[] = [
  {
    kind: 'barrel',
    reason:
      'Re-exports only: there is no statement to mutate, and a barrel that gains logic fails this spec. ' +
      '`src/internal/index.ts` is one too: it re-exports the shared runtime from `src/server`, which `mutate` covers.',
    files: [
      'src/internal/index.ts',
      'src/server/index.ts',
      'src/server/interfaces/index.ts',
      'src/shared/index.ts',
      'src/websocket/index.ts',
      'src/react/index.ts',
    ],
  },
  {
    kind: 'types',
    reason:
      'Types only: it compiles to nothing, and a runtime declaration added to it fails this spec.',
    files: [
      'src/server/composition/transport-wiring.interface.ts',
      'src/server/interfaces/*.interface.ts',
      'src/shared/types/*.ts',
    ],
  },
  {
    kind: 'const-table',
    reason:
      'Frozen `as const` value tables and their derived types: Stryker does not mutate an `as const` literal, so ' +
      'there is nothing to judge, and `src/shared/constants/constants.spec.ts` pins every value by exact equality. ' +
      'A function or a non-`as const` declaration added to one fails this spec.',
    files: ['src/shared/constants/*.constants.ts'],
  },
]

/** What the closure of the package entries must contain, so that an empty closure cannot pass every check. */
export const EXPECTED = {
  entries: 5,
  includes: [
    'src/internal/index.ts',
    'src/server/index.ts',
    'src/websocket/index.ts',
    'src/shared/index.ts',
    'src/react/index.ts',
  ],
  minShipped: 40,
} as const

/** Shipped files that are data, not TypeScript, copied by `tsup.config.ts`. This library ships none. */
export const SHIPPED_DATA: readonly { readonly path: string; readonly tsupNeedle: string }[] = []

/** The end-to-end suites that exercise the subpath of the `e2e-owned` files; `null` when no file is e2e-owned. */
export const E2E_OWNED: { readonly suites: readonly string[]; readonly subpath: string } | null =
  null
