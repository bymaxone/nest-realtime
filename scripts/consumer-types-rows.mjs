/**
 * @fileoverview Compiles a consumer against the packed declarations, with one copy of socket.io and with two.
 *
 * A consumer that installs `socket.io` at a patch other than the one `@nestjs/platform-socket.io` pins gets two copies of
 * its declarations, and every type this package re-declares from `socket.io` then differs from the one Nest's classes use.
 * A class that extends `IoAdapter` fails to compile there (TS2416) while the sources, the tests and `attw` stay green.
 * The second copy is a devDependency alias, so the existing install fetches it and the lockfile pins it: this gate
 * fetches nothing.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const MODULE_RESOLUTIONS = ['node16', 'bundler']
const SECOND_COPY = 'socket-io-4-8-3'

const consumerSource = `import { RealtimeIoAdapter } from '@bymax-one/nest-realtime/websocket'

export class HostAdapter extends RealtimeIoAdapter {}
`

/** The first diagnostic of a `tsc` run that failed: one in the package or in the consumer's own file fails the same. */
function firstDiagnostic(output) {
  return output.split('\n').find((line) => line.includes('error TS')) ?? output.trim()
}

/**
 * @param {{ rootDir: string, tarball: string, packageName: string, workDir: string }} context
 * @returns {string[]} one message for each layout and module resolution whose declarations do not compile
 */
export function consumerTypeFailures({ rootDir, tarball, packageName, workDir }) {
  const requireFromRoot = createRequire(join(rootDir, 'package.json'))
  const tsc = requireFromRoot.resolve('typescript/bin/tsc')
  const secondCopy = realpathSync(join(rootDir, 'node_modules', SECOND_COPY))
  const failures = []
  for (const copies of ['one', 'two']) {
    const dir = join(workDir, `types-${copies}`)
    // The package is extracted into each layout, not linked: TypeScript resolves a link to its real path, and from there
    // the walk to `socket.io` would never see the copy placed beside it.
    const packageDir = join(dir, 'node_modules', packageName)
    mkdirSync(packageDir, { recursive: true })
    execFileSync('tar', ['-xzf', tarball, '-C', packageDir, '--strip-components=1'])
    if (copies === 'two') symlinkSync(secondCopy, join(dir, 'node_modules', 'socket.io'))
    writeFileSync(join(dir, 'index.ts'), consumerSource)
    for (const moduleResolution of MODULE_RESOLUTIONS) {
      const config = {
        compilerOptions: {
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          target: 'ES2022',
          module: moduleResolution === 'node16' ? 'node16' : 'esnext',
          moduleResolution,
          types: ['node'],
          typeRoots: [join(rootDir, 'node_modules', '@types')],
        },
        files: ['index.ts'],
      }
      writeFileSync(join(dir, `tsconfig.${moduleResolution}.json`), JSON.stringify(config))
      const label = `${copies} socket.io ${copies === 'one' ? 'copy' : 'copies'}, ${moduleResolution}`
      try {
        execFileSync('node', [tsc, '-p', join(dir, `tsconfig.${moduleResolution}.json`)], {
          cwd: dir,
          encoding: 'utf8',
          stdio: 'pipe',
        })
        console.log(`✓ declarations compile with ${label}`)
      } catch (error) {
        failures.push(`${label}: ${firstDiagnostic(`${error.stdout ?? ''}${error.stderr ?? ''}`)}`)
      }
    }
  }
  return failures
}
