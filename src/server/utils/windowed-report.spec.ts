/**
 * @fileoverview windowedReport: what is accumulated is written at most once for each window, over a
 * controlled clock.
 * @layer utils
 */
import { REPORT_WINDOW_MS, windowedReport } from './windowed-report'

beforeEach(() => {
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

/** A counter whose reports are collected. */
function counter(): { report: (add: (n: number) => number) => void; reports: number[] } {
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
   * When the first one after the window is recorded
   * Then one report carries all of them, the late one included
   */
  it('folds what was left out into the next report, at the boundary of the window', () => {
    const { report, reports } = counter()
    report((count) => count + 1)
    jest.advanceTimersByTime(REPORT_WINDOW_MS - 1)
    report((count) => count + 1)
    report((count) => count + 1)

    jest.advanceTimersByTime(1)
    report((count) => count + 1)

    expect(reports).toEqual([1, 3])
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
})
