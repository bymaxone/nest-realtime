/**
 * @fileoverview Jest test environment for the Stryker run: jsdom for a spec under `react/`, node
 * for every other spec.
 *
 * Stryker's Jest runner takes one flat configuration and ignores `projects`, so the split that
 * `jest.config.ts` makes with two projects is made here per test file.
 */
const { TestEnvironment: JsdomEnvironment } = require('jest-environment-jsdom')
const { TestEnvironment: NodeEnvironment } = require('jest-environment-node')

/** Whether a spec file belongs to the React sources, which need a DOM. */
function needsDom(testPath) {
  return /[\\/]react[\\/]/.test(testPath)
}

/** Builds the environment Jest asks for; a constructor that returns an object hands that object back. */
module.exports = class StrykerEnvironment {
  constructor(config, context) {
    return needsDom(context.testPath)
      ? new JsdomEnvironment(config, context)
      : new NodeEnvironment(config, context)
  }
}
