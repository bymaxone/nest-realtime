/**
 * @fileoverview Generic realtime event shape shared across transports and the client.
 * @layer shared
 */

/**
 * Generic shape of an event traveling over a realtime transport.
 *
 * Consumers typically declare a mapped type describing their own events and layer
 * it on top of this generic for end-to-end type safety:
 *
 * @example
 * ```ts
 * interface MyAppEvents {
 *   'invoice.paid': { id: string; amount: number }
 *   'webhook.dlq': { webhookId: string; reason: string }
 * }
 *
 * type InvoicePaid = RealtimeEvent<MyAppEvents['invoice.paid']>
 * ```
 */
export interface RealtimeEvent<TData = unknown> {
  /** Monotonically increasing event id — used for `Last-Event-ID` replay. */
  readonly id: string
  /** Event name (matches the consumer's mapped-type key). */
  readonly type: string
  /** Free-form payload. */
  readonly data: TData
}
