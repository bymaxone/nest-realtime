/**
 * Binds every port-only `listen` of the test suites to the IPv4 loopback address.
 *
 * Layer: test support, loaded through `setupFiles` by the Jest configurations that start servers.
 *
 * The reasoning, the patch and its limits are in `test/support/loopback-listen.ts`.
 */
import { installLoopbackListen } from '../support/loopback-listen'

installLoopbackListen()
