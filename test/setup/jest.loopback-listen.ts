/**
 * Binds every port-only `listen` of the test suites to the IPv4 loopback address, and makes
 * supertest wait for a listener it starts itself.
 *
 * Layer: test support, loaded through `setupFiles` of the e2e runner and of the `server` project.
 *
 * The reasoning, the patches and their limits are in `test/support/loopback-listen.ts`.
 */
import { installLoopbackListen, installSupertestWait } from '../support/loopback-listen'

installLoopbackListen()
installSupertestWait()
