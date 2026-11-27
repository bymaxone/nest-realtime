/**
 * @fileoverview windowedReport: what is accumulated is written at most once for each window, over a
 * controlled clock.
 * @layer utils
 */
import { REPORT_WINDOW_MS, windowedReport } from './windowed-report'
import type { WindowedReport } from './windowed-report'

beforeEach(() => {
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

/** A counter whose reports are collected. */
function counter(): { report: WindowedReport<number>; reports: number[] } {
  const reports: number[] = []
  const report = windowedReport(
    () => 0,
    (count) => reports.push(count),
  )
  return { report, reports }
}

describe('windowedReport', () => {
  /*
   * Given a report that has written nothing
   * When the first occurrence is recorded
   * Then it is written at once, with that occurrence counted
   */
  it('writes the first occurrence at once', () => {
    const { report, reports } = counter()

    report((count) => count + 1)

    expect(reports).toEqual([1])
  })

  /*
   * Given a report that has just written
   * When more occurrences arrive before the window has passed
   * Then nothing more is written
   */
  it('stays quiet for the rest of the window', () => {
    const { report, reports } = counter()
    report((count) => count + 1)

    jest.advanceTimersByTime(REPORT_WINDOW_MS - 1)
    report((count) => count + 1)

    expect(reports).toEqual([1])
  })

  /*
   * Given occurrences left out during a window
   * When the window passes and another occurrence follows
   * Then what was left out is written at the boundary, and the later one waits for its own window
   */
  it('writes what was left out at the boundary of the window', () => {
    const { report, reports } = counter()
    report((count) => count + 1)
    jest.advanceTimersByTime(REPORT_WINDOW_MS - 1)
    report((count) => count + 1)
    report((count) => count + 1)

    jest.advanceTimersByTime(1)
    report((count) => count + 1)

    expect(reports).toEqual([1, 2])
    jest.advanceTimersByTime(REPORT_WINDOW_MS)
    expect(reports).toEqual([1, 2, 1])
  })

  /*
   * Given a report that has written
   * When the next window's first occurrence is recorded
   * Then the count restarts from empty, so nothing is reported twice
   */
  it('starts each report from an empty accumulator', () => {
    const { report, reports } = counter()
    report((count) => count + 1)
    jest.advanceTimersByTime(REPORT_WINDOW_MS)
    report((count) => count + 1)
    jest.advanceTimersByTime(REPORT_WINDOW_MS)
    report((count) => count + 1)

    expect(reports).toEqual([1, 1, 1])
  })

  /*
   * Given an accumulator that is an object
   * When a report is written and the next window starts
   * Then the next accumulator is a new object, not the one already handed out
   */
  it('hands out an accumulator that the next window does not reuse', () => {
    const handed: { a: number }[] = []
    const report = windowedReport(
      () => ({ a: 0 }),
      (accumulated) => handed.push(accumulated),
    )
    report(({ a }) => ({ a: a + 1 }))
    jest.advanceTimersByTime(REPORT_WINDOW_MS)
    report(({ a }) => ({ a: a + 1 }))

    expect(handed).toEqual([{ a: 1 }, { a: 1 }])
    expect(handed[0]).not.toBe(handed[1])
  })

  /*
   * Given a burst that ends inside a window
   * When the window passes with no later occurrence
   * Then the rest of the burst is written once, and an empty window after it writes nothing
   */
  it('writes the tail of a burst that nothing follows', () => {
    const { report, reports } = counter()
    report((count) => count + 1)
    jest.advanceTimersByTime(4_000)
    report((count) => count + 1)
    report((count) => count + 1)

    jest.advanceTimersByTime(REPORT_WINDOW_MS - 4_000 - 1)
    expect(reports).toEqual([1])
    jest.advanceTimersByTime(1)
    expect(reports).toEqual([1, 2])
    jest.advanceTimersByTime(3 * REPORT_WINDOW_MS)

    expect(reports).toEqual([1, 2])
    expect(jest.getTimerCount()).toBe(0)
  })

  /*
   * Given a window that passed without its timer having run, as on a blocked event loop
   * When an occurrence arrives
   * Then one report carries it with what was left out, and the timer is dropped
   */
  it('writes once when an occurrence arrives before an overdue timer', () => {
    const now = jest.spyOn(performance, 'now').mockReturnValue(0)
    const { report, reports } = counter()
    report((count) => count + 1)
    report((count) => count + 1)

    now.mockReturnValue(REPORT_WINDOW_MS)
    report((count) => count + 1)

    expect(reports).toEqual([1, 2])
    expect(jest.getTimerCount()).toBe(0)
    now.mockRestore()
  })

  /*
   * Given occurrences waiting for the window to pass
   * When the report is stopped, as at shutdown
   * Then they are written at once, no timer stays, and stopping again writes nothing
   */
  it('writes what is waiting when stopped, once', () => {
    const { report, reports } = counter()
    report((count) => count + 1)
    report((count) => count + 1)

    report.stop()
    report.stop()

    expect(reports).toEqual([1, 1])
    expect(jest.getTimerCount()).toBe(0)
  })

  /*
   * Given a report with nothing waiting
   * When it is stopped
   * Then nothing is written
   */
  it('writes nothing when stopped with nothing waiting', () => {
    const { report, reports } = counter()
    report((count) => count + 1)

    report.stop()

    expect(reports).toEqual([1])
  })

  /*
   * Given occurrences waiting for the window to pass
   * When the timer is armed
   * Then it does not keep the process alive
   */
  it('arms a timer that does not keep the process alive', () => {
    jest.useRealTimers()
    const armed = jest.spyOn(globalThis, 'setTimeout')
    const { report } = counter()
    report((count) => count + 1)
    report((count) => count + 1)

    expect((armed.mock.results[0]?.value as NodeJS.Timeout).hasRef()).toBe(false)
    report.stop()
    armed.mockRestore()
  })
})
