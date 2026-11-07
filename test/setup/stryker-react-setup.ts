/**
 * Jest setup for the Stryker run: installs the React test setup only where a DOM exists.
 *
 * The Stryker configuration is flat, so this file runs for every spec, but the React setup
 * needs `window`, which only the jsdom environment of a `react/` spec provides.
 */
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded conditionally, after the environment exists
  require('./react-setup')
}
