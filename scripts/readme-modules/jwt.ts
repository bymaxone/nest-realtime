/**
 * @fileoverview Typed stub for `./jwt`, the consumer's own token helper, which the
 * README's authenticator snippet imports without showing it.
 */
export declare function verifyAccessToken(token: string): Promise<{ sub: string; tid: string }>
