/**
 * @fileoverview Stub for `./jwt`, the consumer's own token helper that the README's
 * authenticator snippet imports without showing it. Copied by
 * `check-published-surface.mjs` to the same relative path in the throwaway consumer,
 * so the snippet's call is typed instead of resolving to `any`.
 */
export declare function verifyAccessToken(token: string): Promise<{ sub: string; tid: string }>
