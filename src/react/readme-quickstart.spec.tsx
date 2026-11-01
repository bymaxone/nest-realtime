/**
 * @fileoverview Executes the README Quick Start's React step as written.
 * @layer composition
 *
 * `check:published` compiles the README's snippets, but a type check cannot see that an event
 * name left out of `eventNames` never reaches the hook. The two `tsx` blocks of step 5 are taken
 * from the README text at test time, not copied, compiled and rendered in jsdom against a
 * controllable `EventSource`, so the README and this test cannot drift. `InvoiceList` is the one
 * name `App.tsx` uses without importing, because the README shows it as the next file.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileFunction } from 'node:vm'
import type { ComponentType } from 'react'
import * as react from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { act, render, screen } from '@testing-library/react'
import { JsxEmit, ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { EventSourceMock, emitNamedEvent } from '../../test/setup/react-setup'
import * as realtimeReact from './index'

const README = readFileSync(join(__dirname, '..', '..', 'README.md'), 'utf8')

/** The fenced `tsx` blocks of the Quick Start section, in the order the README shows them. */
function quickStartTsxBlocks(): string[] {
  const start = README.indexOf('## 🚀 Quick Start')
  const end = README.indexOf('## ⚙️ Configuration')
  if (start === -1 || end === -1) throw new Error('README has no Quick Start section')
  return Array.from(
    README.slice(start, end).matchAll(/```tsx\n([\s\S]*?)```/g),
    (match) => match[1] ?? '',
  )
}

/** The one `tsx` block that contains `marker`; zero or several is a README this test no longer reads. */
function block(marker: string): string {
  const found = quickStartTsxBlocks().filter((candidate) => candidate.includes(marker))
  if (found.length !== 1) {
    throw new Error(
      `Expected one Quick Start tsx block containing "${marker}", found ${found.length}`,
    )
  }
  return found[0] as string
}

/** Compile one README block and run it, resolving its imports through `modules`. */
function runBlock(
  source: string,
  globals: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const { outputText } = transpileModule(source, {
    fileName: 'block.tsx',
    compilerOptions: {
      module: ModuleKind.CommonJS,
      target: ScriptTarget.ES2022,
      jsx: JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  })
  const modules: Record<string, unknown> = {
    '@bymax-one/nest-realtime/react': realtimeReact,
    'react/jsx-runtime': jsxRuntime,
    react,
  }
  const exported: Record<string, unknown> = {}
  const load = (specifier: string): unknown => {
    if (specifier in modules) return modules[specifier]
    throw new Error(`The Quick Start imports "${specifier}", which this test does not provide`)
  }
  compileFunction(outputText, ['require', 'exports', ...Object.keys(globals)])(
    load,
    exported,
    ...Object.values(globals),
  )
  return exported
}

describe('README Quick Start — React', () => {
  let sources: EventSourceMock[]
  let OriginalEventSource: typeof global.EventSource

  beforeEach(() => {
    sources = []
    OriginalEventSource = global.EventSource
    ;(global as unknown as { EventSource: unknown }).EventSource = class extends EventSourceMock {
      constructor(url: string, options?: EventSourceInit) {
        super(url, options)
        sources.push(this)
      }
    }
  })

  afterEach(() => {
    ;(global as unknown as { EventSource: unknown }).EventSource = OriginalEventSource
  })

  it('connects to the stream App.tsx names and lists the event InvoiceList receives', async () => {
    /**
     * Guards the README section "Quick Start", step 5, and changes when it does: `App.tsx` and
     * `InvoiceList.tsx` are rendered as the README prints them. The provider opens the stream
     * at the `url` it was given, the list starts disconnected and goes live once the stream
     * opens, and an `invoice.paid` event is delivered because the block lists it in
     * `eventNames` — the requirement the README's note states.
     */
    const { InvoiceList } = runBlock(block('export function InvoiceList')) as {
      InvoiceList: ComponentType
    }
    const { default: App } = runBlock(block('export default function App'), { InvoiceList }) as {
      default: ComponentType
    }

    render(<App />)
    expect(screen.getByText('🔴 disconnected')).toBeTruthy()
    expect(sources).toHaveLength(1)
    const source = sources[0] as EventSourceMock
    expect(source.url).toBe('/realtime/sse')

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(screen.getByText('🟢 live')).toBeTruthy()

    act(() => {
      emitNamedEvent(source, 'invoice.paid', { invoiceId: 'inv-1', amount: 42 })
    })
    expect(screen.getByText(/invoice\.paid — \{"invoiceId":"inv-1","amount":42\}/)).toBeTruthy()
  })
})
