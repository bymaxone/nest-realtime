# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning is **not** strict [SemVer](https://semver.org/spec/v2.0.0.html) while this API is pre-stable: breaking changes ship in minor and patch releases by explicit `@bymax-one` policy, so a version number carries no compatibility information. The **Apply to a derived backend** note, on the entries that carry one, is the compatibility contract: read it, not the number.

## [Unreleased]

## [1.2.35] - 2026-11-22

### Security

- **`maxAge` of `websocket.cors` must be a whole number of seconds, zero or more.** A negative number, a fraction, `NaN`, `Infinity`, a string, a boolean or an object was handed to Socket.IO, which writes it into `Access-Control-Max-Age`. Each is now refused at boot with `REALTIME_INVALID_OPTIONS`, naming the type and never the value.
- **The read of the options no longer depends on a built-in a host can replace.** `Object.keys`, `Object.freeze` and `Object.prototype.toString` are taken when the library loads, and the read walks its keys by index, without a `Set`, a spread or a `for...of`, so a program that replaces one afterwards cannot make the cors block lose an option or leave the resolved options unfrozen. The check of `extraProviders` takes `Array.isArray` from the same place and walks the list by index, so a replaced `Array.isArray` or `Array.prototype.forEach` cannot let an invalid one through. The README lists the built-ins trusted as imported.

#### Apply to a derived backend

A `maxAge` that is not a whole number of seconds, zero or more, now refuses boot: write it as `600`, not `'600'` or `600.5`.

## [1.2.34] - 2026-11-21

### Security

- **The entries of `methods`, `allowedHeaders` and `exposedHeaders` must be strings.** A list entry that was an object, a nested list, a number or a hole, and a value that was a number, a `Set` or an object, was handed to Socket.IO, which joins it into a header. Each is now refused at boot with `REALTIME_INVALID_OPTIONS`, naming the option and saying only what kind of value it received.
- **The copy of a list takes `Array.isArray`, `Number.isInteger`, `Object.freeze` and `Array.prototype.push` when the library loads**, like the rest of what the copy relies on, so one a host replaces afterwards can neither change what is copied nor watch it. The README says which built-ins are trusted as imported.

### Changed

- **The types now declare the existing `allowedHeaders`, `exposedHeaders` and `maxAge` of `CorsConfig`**, which Socket.IO accepted and the library already copied or handed over, so a TypeScript host can write them without a cast. The block is now read for those names like the others.

### Tooling

- **`scripts/check-dist-fresh.mjs` skips its comparison only with a flag the size script does not pass**, so the size script no longer clears `PACKAGE_TARBALL`; it names the manifest and the two tsconfig files the build reads besides `tsup.config.ts`.

#### Apply to a derived backend

A `methods`, `allowedHeaders` or `exposedHeaders` with an entry that is not a string, or that is not a string or a list, now refuses boot: write each header token as a string.

## [1.2.33] - 2026-11-21

### Security

- **The lists `allowedHeaders` and `exposedHeaders` of `websocket.cors` are copied once at boot**, like `origin` and `methods`: a list given for either was shared with Socket.IO, so a `push` after boot reached later requests, and a list over 1,000 entries or with a length that is not a count was never checked. Neither decides which origin is allowed, but a list the host can still change is not the list that was configured. A change made after boot now reaches nothing.
- **A `RegExp` whose source is over 1,000 characters is refused at boot**, with "use a function origin for custom matching". The bound limits the cost of reading and keeping a pattern. A pattern runs as written, so how it behaves on a hostile origin (a catastrophic backtrack, say) is the host's to judge, and the README says so.

- **The copy of a `RegExp` no longer calls through the live built-ins.** It called the accessors it took at load through `Function.prototype.call` and walked its flag table with the iterator of an array, both of which a host could replace after the library was imported; it now calls through the `Reflect.apply` taken at load and walks the table by index, and a `sticky` accessor that was absent at load refuses every `RegExp`, because a sticky one could not be told from a plain one. The copy trusts the built-ins as they were when the library was imported, so import order matters.

### Changed

- **The `CorsConfig` comment and the README say where origins are matched.** `websocket.cors` is the WebSocket transport's alone; the SSE endpoint is a plain HTTP GET whose cross-origin access is the host's `app.enableCors`. A real request to the SSE endpoint gets no `Access-Control-Allow-Origin` from the module, with the allowlist set or not, and a test says so.

### Tooling

- **`pnpm size` refuses a `dist` older than the sources** (`scripts/check-dist-fresh.mjs`), so a size budget is not measured on a stale build, whatever `PACKAGE_TARBALL` holds, because the budget always measures `dist/`; its test and the test of that wiring run with `pnpm lint`.
- **The no-AI-attribution caller workflow sets `contents: read` at the top**, which clears a code-scanning alert for a workflow without top-level permissions.

#### Apply to a derived backend

A `RegExp` origin with a source over 1,000 characters now refuses boot: use a function origin, or a shorter pattern. A list for `allowedHeaders` or `exposedHeaders` that is changed after boot no longer reaches Socket.IO.

## [1.2.32] - 2026-11-21

### Security

- **The flags of a `RegExp` origin are read through the accessors taken when the library loaded.** The copy and the refusal of a sticky `RegExp` read the flags through the `flags` accessor of `RegExp.prototype`, which reads `sticky`, `global`, `multiline` and the others from whatever the prototype holds at the time. A host that replaced one of them before boot could make `/…/y` look unflagged and be copied unanchored, or change the flags of the copy. Each flag is now read through its own accessor taken at load, and the flag string is built from them; a flag accessor that throws no longer raises the host's error.

### Changed

- **A value that is or looks like a `RegExp` and cannot be copied gets the same way out**: an object that only has the prototype of a `RegExp`, a proxy over one and an object with a `test` are refused with "use a function origin for custom matching", as a subclass already was.
- **The README and the `CorsConfig` comment say what happens to `allowedHeaders`, `exposedHeaders` and `maxAge` after boot**: arrays given for the first two are shared with Socket.IO, so a change to the array itself reaches later requests, while replacing the property or changing a scalar such as `maxAge` does not; none of them decides which origin is allowed.

#### Apply to a derived backend

None for a host that does not change `RegExp.prototype`. A value that looks like a `RegExp` and is not one now refuses boot with the way out.

## [1.2.31] - 2026-11-21

### Security

- **The entries of an origin list are copied too, and a `RegExp` is recognised by its brand.** 1.2.30 copied the list and left its entries as the host wrote them, and Socket.IO matches an entry by its prototype: after boot, `Object.setPrototypeOf` on an entry, or a proxy entry whose `getPrototypeOf` answered differently, made it answer any origin. Each `RegExp`, in the list or as the origin itself, is now replaced at boot by a plain one with the same pattern and flags except `g`, read once through the accessors of `RegExp.prototype`; a `g` flag made an entry answer alternately allowed and refused, and an object that only had the prototype of a `RegExp` passed validation and then failed every request. A `RegExp` that is not plain (a subclass, one with a property of its own, one from another realm) or has the `y` flag is refused at boot with "use a function origin for custom matching", because a plain copy would lose its behaviour, and a copy more permissive than the original would answer origins the host meant to refuse: a sticky `RegExp` matches only at the start of the origin, so `/https:\/\/a\.com/y` rejects `https://evil.io/#https://a.com`, and a copy without the flag accepts it. A function origin stays the host's own code.

### Changed

- **`websocket.cors.methods` is a string or a list of at most 1,000 strings**, read once like the origin list; anything else is refused at boot with `REALTIME_INVALID_OPTIONS`. The declared type now says string too, as Socket.IO accepts.
- **A list entry that is not a string or a `RegExp` is refused**: `false`, a number, an object and a `String` object were accepted before 1.2.30 and are not any more. A refusal of a `websocket.cors` option no longer prints a number, only that it was one.
- **Any other key of the `cors` block reaches Socket.IO as written**; the library does not validate it. This is documented in the README.

#### Apply to a derived backend

A `RegExp` subclass, a `RegExp` with a property of its own, a `RegExp` from another realm and a `RegExp` with the `y` flag now refuse boot: use a function origin for custom matching, or an anchored pattern. A list entry that is not a string or a `RegExp`, and a `methods` that is not a string or a list of strings, now refuse boot.

## [1.2.30] - 2026-11-21

### Security

- **A `websocket.cors.origin` of a kind Socket.IO reads as "any origin", and a `cors` that is not an object, no longer open the server.** Socket.IO matches an origin that is a string, a `RegExp` of its own realm or a list of those, and answers the asking origin for anything else: an object, a number, a symbol, a list with such an entry and a `RegExp` from another realm. A `cors` that is a string, a number, `true`, an array or a `Map` was ignored, so the server answered `*`; `false` closed the server, and is refused with the others because `cors` is an object. All of these are now refused at boot with `REALTIME_INVALID_OPTIONS`, naming `options.websocket.cors.origin` or `options.websocket.cors`.

- **An origin list is copied once, and capped, instead of being read again on every request.** Socket.IO matches the list it is given by index and length on each request, while validation walked it through its iterator, so a subclass whose iterator and indexes differ, a proxy that answered differently the second time, and a list the host pushed to after boot each passed validation and then allowed any origin. The length and each entry are now read once into a frozen copy that is both validated and handed to Socket.IO; the length must be an integer from 0 to 1,000. A function, and a `RegExp` subclass that overrides `test`, remain the host's own code and are trusted as such.
- **A `cors` object that holds none of `origin`, `credentials` or `methods` and is not a plain object is refused** (an `Error`, a `Date`, a `Map`, an array), instead of being read as an empty block that answers `*`.

### Changed

- **`CorsConfig.origin` is typed as what Socket.IO accepts.** The declaration now includes `RegExp`, a list of strings and `RegExp`s, and the function Socket.IO calls per origin, which the runtime already honoured. `true` stays accepted and answers every origin; `false` answers none.
- **A `cors` that is absent or `null` stays valid, and `cors: {}` or a block with only `credentials` still answers `*`.** Socket.IO sends no CORS header for it, so the server is closed to browsers on other origins.

#### Apply to a derived backend

An `origin` that is not a string, a `RegExp`, a function, a list of strings and `RegExp`s, or a boolean now refuses boot, and so does a `cors` that is present and not an object: write the allowlist as one of those kinds, or remove the key.

### Tests

- A row for a `cors` block whose `has` trap throws, which is refused with the host's error as the cause, and real-handshake rows for each refused kind.

## [1.2.29] - 2026-11-21

### Security

- **A `websocket.cors.origin` that is set to nothing no longer opens the server to every origin.** The module read `null` and `undefined` as an unset option and dropped them, so the block reached Socket.IO without an `origin` and the server answered `*`; Socket.IO itself answers no origin for either value. A host whose allowlist came from a missing environment variable (`origin: process.env.APP_ORIGIN`) therefore allowed every origin.

### Changed

- **A present-but-nullish `websocket.cors.origin` is refused at boot.** `null`, `undefined` as a key of its own, and an environment variable that is missing are refused with `REALTIME_INVALID_OPTIONS`, naming `options.websocket.cors.origin`. A block with no `origin` key keeps the documented default, which answers `*`.
- **`websocket.cors.credentials` must be a boolean.** `'true'`, `'false'`, `1` and an object were ignored by Socket.IO, so credentials were silently off; they are refused with `REALTIME_INVALID_OPTIONS`.

#### Apply to a derived backend

A nullish `cors.origin` now refuses boot: set the allowlist, or remove the key to take the default. A `credentials` that is set to something other than `true` or `false` now refuses boot: write the boolean.

## [1.2.28] - 2026-11-21

### Documentation

- **The README states what a `tenantResolver`'s promise cannot have handled, and what `websocket.cors` does without an `origin`.** A promise the resolver returns has its rejection absorbed except in the cases the 1.2.27 entry lists. A `cors` block with no `origin` key leaves Socket.IO's own default, which answers `*`; browsers refuse `*` together with `credentials: true`, so the origin is the host's to set.

#### Apply to a derived backend

None. No code changed.

## [1.2.27] - 2026-11-21

### Fixed

- **`roles` is read with a bound, and a `roles` that cannot be read is refused in every shape.** A revoked proxy over an array made `Array.isArray` throw a raw `TypeError` before the guard; the check now sits inside it, so the refusal is `REALTIME_AUTH_FAILED` with the host's error as the cause. The copy stops at 1,024 roles: an authentication result with more is refused with `REALTIME_AUTH_FAILED`, and an iterator that never ends is no longer read to exhaustion. The bound is there to cap the cost of the copy, not to say how many roles a user may hold; exactly 1,024 is admitted.
- **The rejection of a promise a `tenantResolver` returns is absorbed whatever kind of promise it is.** The check was `instanceof Promise`, which a promise from another realm fails, and the handler was the promise's own `catch`, which a subclass can override; either left an unhandled rejection that ended the process. The handler is now attached with the intrinsic `then`, which accepts a real promise of any realm and refuses every other value without reading a property of it. A proxy over a promise whose `get` trap binds the promise's methods to it is given its own `catch` when the intrinsic refuses it, so its rejection is absorbed too; a thenable that is not a promise is still never asked for its `then`. These cannot be given a handler by either path, and their rejection is left to the process: a proxy with no traps, a proxy whose `catch` trap throws, and a promise whose species lookup throws (see the README for which values do that).

### Documentation

- **What a `tenantResolver` that returns something other than a native promise gets.** A thenable that is not a promise is never asked for its `then`, because asking could run a lazy query, so its own rejection is not absorbed; a promise whose `constructor` cannot be read cannot be given a handler either. Both are refused as a blank tenant.
- **`roles` that is not an array is kept as it is.** A string, a `Set` or an array-like proxy is not copied, so it is read later by whoever uses it.
- **A `websocket.cors` key outside `CorsConfig`.** Only the keys the library names (`origin`, `credentials`, `methods`) and the block's own enumerable keys are carried; any other key defined as a getter on a prototype or as non-enumerable is not.

### Tests

- Rows for `websocket.cors` with `origin: false`, a `RegExp`, a function and a proxy over an empty target that answers by name, over a real Socket.IO server.

#### Apply to a derived backend

An authenticator that returns more than 1,024 roles is now refused; none is expected to.

## [1.2.26] - 2026-11-21

### Fixed

- **An origin allowlist in `websocket.cors` is no longer dropped when it is defined as a class getter, a non-enumerable property or a prototype property.** The block was copied by its own enumerable keys, so `origin` went missing, Socket.IO fell back to its default and answered every origin with `Access-Control-Allow-Origin: *`. The block is now read by the names of `CorsConfig` whenever it is a non-array object, however it reports its type: a block with a `Symbol.toStringTag`, or a strict proxy, is read the same way. A block whose names cannot be read is refused with `REALTIME_INVALID_OPTIONS` and the host's error as the cause, never answered with a wildcard.
- **`roles` whose read throws is refused at admission.** A proxy or getter on `roles` was first read when the connection event or a hook needed it, so the host's error reached the framework raw. The array is now read once at admission into a frozen copy, and a read that throws is refused with `REALTIME_AUTH_FAILED` and the host's error as the cause. A `roles` value that is not an array is left as it is.
- **An `async` `tenantResolver` no longer leaves an unhandled rejection.** The resolver is synchronous; a promise is refused as a tenant that is not a string, and its rejection is now absorbed.

#### Apply to a derived backend

Nothing to change. A host that defined `websocket.cors.origin` as a getter, non-enumerable or on a prototype now gets the allowlist it wrote; check that it is the list you intend, since until now such a server answered every origin.

## [1.2.25] - 2026-11-21

### Fixed

- **A `tenantResolver` is given the authenticator's own result again, and the library keeps its own record.** From 1.2.22 to 1.2.24 the resolver received a copy of the result, and every shape of host object turned out to lose something in a copy: a hidden or symbol-keyed field, a field a class default or `Object.create` supplies from the prototype, an accessor that shadows one, a getter over a private field that throws on the copy. The resolver is now handed the object the authenticator returned, so none of that applies. The record the library keeps is built by name (`userId`, `tenantId`, `roles`, `rooms`, `metadata`), each field read once, before the resolver runs; what a resolver writes to the result does not change it, and `roles`, `rooms` and `metadata` stay shared. What the resolver returns is what routes, so the tenant that was tested and the tenant that is used stay one value.
- **The entries of `extraProviders` are read under the guard, and a value whose type cannot be read says so.** An entry that throws when its type or its `provide` is read raised the host's own error or a refusal without it; it is now refused with the library's code and the error as the `cause`. A refusal of the options, a group or an entry whose type could not be read says `received an object that could not be read`, where it said `a built-in object` or `an object` according to a second read of the value.
- **A log field named `service` or `version` can no longer reach a log line.** A logger that stamps those on every line would have been given two answers; `logEvent` drops them with the other names it reserves.

#### Apply to a derived backend

A `tenantResolver` now receives the authenticator's original result, not a copy: it sees a `null` or absent `tenantId` as the authenticator returned it, and a resolver that wrote to the copy it was given from 1.2.22 to 1.2.24 now writes to the authenticator's object. The record the library keeps is built by name from `userId`, `tenantId`, `roles`, `rooms` and `metadata`, and is read the way JavaScript reads a property: a field supplied by a class default, `Object.create` or an accessor on the prototype is now honoured, where 1.2.22 to 1.2.24 dropped it, so a result whose `userId` exists only on its prototype is admitted, and a blank one is still refused. Properties of the result beyond those five were never exposed to hooks and are not kept.

## [1.2.24] - 2026-11-20

### Fixed

- **A `tenantResolver` that writes to the result it receives no longer changes the connection.** With an absent or `null` tenant, the copy handed to the resolver was the object the library kept, so a resolver that assigned to it (for example to `userId`) changed the connection record. The resolver is given its own copy in every case; the copy is shallow, so nested objects are still shared and a write inside them still changes what is kept.
- **A log field named like what a structured logger writes itself no longer reaches the line.** `logEvent` already dropped `err`, `msg` and `level`; it now also drops `time`, `pid`, `hostname`, `name`, `v`, `req` and `res`, which a logger writes on every line.
- **Every read of an object the host hands over fails with the library's error and the host's error as its cause.** The keys of a `forRootAsync` registration were read without a guard, so a getter or a proxy on the registration raised the host's own error; they are read once, under the guard. An object that throws when its type is read, as the options, a group or the registration, was refused without the error it threw; the error is now the `cause`. What a synchronous factory returns is read for `then` once and its answer is boxed, so a trap that throws on a later read cannot escape.

### Documentation

- **The `tenantResolver` documentation says exactly what the copy holds.** The result's own enumerable properties, and the `tenantId` as the library read it, which counts when an accessor on the prototype supplies it. This replaces "own enumerable properties only", which was true of the rest of the copy and not of the tenant.

## [1.2.23] - 2026-11-20

### Fixed

- **A field named `msg` or `level` can no longer reach a log line.** A structured logger reads `msg` as the text of a line and `level` as its severity, so a field of either name could change what a library line says or how it is filed. `logEvent` drops them, as it already did `err`; `event` and `message` stay the library's own.

### Documentation

- **The README and the `tenantResolver` documentation say that the resolver receives a plain copy.** The options table, the paragraph on identity and the JSDoc state that the copy has its own enumerable properties only and no `tenantId` when the tenant is absent or `null`.

## [1.2.22] - 2026-11-20

### Fixed

- **The tenant of an authentication result is read once.** The routing tenant was read from the result more than once, so a getter that answers differently the second time could route on a value that was not the one tested. It is read once, the rest of the result is copied beside it, and a `tenantResolver` is given that copy, so a resolver that reads `auth.tenantId` reads the same value.
- **A field named `err` can no longer stand for the error of a log line.** `logEvent` wrote a caller's `err` field when no error was passed, and `err` is where a logger's serializer reads an error from. Only the error argument writes `err` now. The `logEvent` documentation also says that a field whose read throws, such as a getter, loses the line instead of throwing.

#### Apply to a derived backend

A `tenantResolver` now receives a plain copy of the authentication result, with its own enumerable properties only, and not the authenticator's original object. A resolver that relies on a prototype method of that object, on its identity, or on a property that is not enumerable must read what it needs in the authenticator and carry it in the result's `metadata`. The result the library hands to the rest of the code was already such a copy.

### Documentation

- **The README says what a getter that throws on the authenticator's result does.** The error is the host's own and is not wrapped: the handshake fails, it is logged under `err` and counted as `reason="error"`.

## [1.2.21] - 2026-11-20

### Fixed

- **A proxy whose trap throws on `then`, or one that was revoked, returned by a factory is refused with the typed error.** `await` reads `then` on what a synchronous `useFactory` or `createRealtimeOptions` returns, which ran the trap inside the library before the options were read; a revoked proxy given to `forRoot` or returned by a factory raised the engine's `TypeError`. Both now raise `REALTIME_INVALID_OPTIONS` with the error as the `cause`.
- **`REALTIME_REDIS_ADAPTER_FAILED` no longer carries the text of the error underneath in its message.** The message names what could not be installed and the remedy; the error that was thrown is the `cause`.
- **A field named `event`, `message` or `err` cannot replace the event, the message or the error of a log line.** The library's own values are written after the fields.
- **A logger that throws no longer turns a reported failure into another one.** `logEvent` writes every `warn` and `error` line the library emits, often from a `catch` block or a promise handler; when the host's logger threw there, the error left the handler, and in the timer of the re-authentication service it was an unhandled rejection, which ends a Node process by default. The throw is now absorbed and the line is lost.

#### Apply to a derived backend

Code that read the reason from the message of a `REALTIME_REDIS_ADAPTER_FAILED` error reads `error.cause` instead.

### Documentation

- **The README says what a logger that rejects does and what a proxy that throws on its type keeps.** A logger whose method returns a rejected promise is not absorbed, because Nest's `Logger` discards the return value, so the rejection is an unhandled rejection of the host's process, which ends a Node process with exit code 1 unless the application handles `unhandledRejection`. A proxy that throws on every read, its type tag included, is refused as a built-in object without its error as the `cause`.
- **The README says that an `async` factory's object is read as the factory's own failure, and how a library refusal is recognised.** A factory written as an `async` function that returns a proxy whose trap throws rejects its own promise with that error, which the library cannot tell from the factory failing. A refusal the library raised is recognised by its stable code, so an error of the host's own that carries a `REALTIME_` code is not wrapped.

## [1.2.20] - 2026-11-20

### Fixed

- **A getter or a proxy that throws, in an object the host hands over, is refused with the library's typed error.** A proxy or a getter returned as the options by a `useFactory` or by `createRealtimeOptions`, one on the provider `useExisting` names, and one as the `authenticator` raised the host's own error at registration; they now raise `REALTIME_INVALID_OPTIONS` with the error that was thrown as the `cause`. An `extraProviders` that is not an array of providers raised a raw `TypeError` or was accepted until the container reached it; it is now refused at registration, naming the entry.
- **An `onConnect` that fails under `onConnectFailure: 'close'` is no longer counted as a refused handshake on WebSocket.** The connection was admitted first, as on SSE, where nothing was counted; `bymax_realtime_connections_refused_total{reason="error"}` now means a handshake that failed with an unexpected error on both transports.
- **A `*_UNAVAILABLE` error no longer carries the text of the error underneath in its message.** The message names what could not be reached; the error that was thrown is the `cause`, as it already was. The `Subscribed to` line of `RedisRealtimePubSub` no longer names the channel.

#### Apply to a derived backend

Code that read the text of the underlying failure from the `message` of a `REALTIME_PUBSUB_UNAVAILABLE` or `REALTIME_TRANSPORT_UNAVAILABLE` error must read `error.cause` instead. A dashboard that summed `reason="error"` and counted WebSocket connections that `onConnect` closed will see those no longer counted. A log filter that matched `Subscribed to "<channel>"` matches `Subscribed to the realtime channel`.

### Documentation

- **The README names `createRealtimeOptions` and `ConnectionAuthContext.userAgent`.**

## [1.2.19] - 2026-11-20

### Added

- **Observability, all optional: metrics, a health indicator, spans and log events with stable codes.** A new subpath, `@bymax-one/nest-realtime/observability`, exports `RealtimeMetrics` and `RealtimePubSubHealthIndicator`. Registered as providers of a module of the application, `RealtimeMetrics` publishes `bymax_realtime_connections{transport}`, `bymax_realtime_connections_refused_total{reason}`, `bymax_realtime_evictions_total{reason}`, `bymax_realtime_events_emitted_total{transport}` and `bymax_realtime_slow_consumer_drops_total`, every label from a closed set, and the indicator reports `down` when the bus says it is not subscribed. With `@opentelemetry/api` installed, the library starts `realtime.handshake` and `realtime.reauthenticate` spans, and with no SDK registered they are no-ops. The root and the shared runtime import none of `@bymax-one/nest-core`, `prom-client` or `@opentelemetry/api` statically, which are optional peers, and `pnpm size` fails if one of them reaches those bundles. The README has the Metrics table, the Traces and Health notes and a Log events table.

### Changed

- **Every `warn` and `error` line is an object with a stable code.** The line is `{ event: 'REALTIME_<EVENT>', message, ...fields }`, so a structured logger writes each as a JSON field and Nest's default logger prints the object instead of a sentence. The message text no longer names a user, a tenant, a room, a channel or a socket: those values were removed from the text, and the logger's own context carries identity. A connection id may be a field. A line that says the library started stays a string.
- **`bymax_realtime_events_emitted_total` is described as what it counts.** It counts emit calls handled on the instance, including a call with no recipient, and under `'both'` each transport counts it. The metric help text and the README say so.

#### Apply to a derived backend

An alert or a log filter that matched the text of a `warn` or `error` line now matches the `event` field instead; the codes are in the README. A host that parsed a line for a user, tenant, room or channel will not find it. Metrics start only when the application registers `RealtimeMetrics`, and spans only when it installs `@opentelemetry/api`; without them nothing changes. A class that subclasses `SseTransport`, `SseSubscriptionHandler`, `WebSocketTransport`, `RealtimeGateway` or `ReauthenticationService` and builds it by hand gains optional trailing constructor parameters and keeps working without them.

### Fixed

- **Inputs were accepted, or failed as a raw `TypeError`, where a typed refusal belongs.** The `sseEndpoint` of `forRootAsync` was not covered by the check `sse.endpoint` got: a number failed as `endpoint.startsWith is not a function` and a blank one registered and served no route. A `forRoot` or `forRootAsync` called with no options, `null`, a string, a number or an array failed as "Cannot convert undefined or null to object", or as a message about `options.transport`; a factory that answered a string or a number was read the same way. A `Date` was accepted as `sse`, `websocket`, `reauthenticationPolicy` or `hooks`, because it is not an array. `new RedisOfflineQueue(undefined)` threw a raw `TypeError` and a string was accepted with no `client`. An endpoint with a space in it, `' /x '` or `'/a b'`, was registered and unreachable. Each of those is now refused with `REALTIME_INVALID_OPTIONS`, naming the option and what it received (`a built-in object` for a `Date`, a `Map` and the like). A `forRootAsync` pattern (`useFactory`, `useClass` or `useExisting`) set to `null` now reads as unset, like `undefined`: beside the pattern in use it is no longer counted as a second one, and alone it is refused at registration instead of failing at bootstrap with the container's own error.
- **A handshake that failed with an unexpected error counted in no metric, a `useExisting` that resolved to nothing failed with a raw `TypeError`, a proxy whose reads throw reached the application with its own error, and the cache warning was written before the logger was in place.** A 500 handshake now counts under `bymax_realtime_connections_refused_total{reason="error"}`. A `useExisting` or `useClass` provider with no `createRealtimeOptions` is refused with `REALTIME_INVALID_OPTIONS` at bootstrap. A proxy whose reads throw, given as the options or as a group, is refused as `a built-in object`. `REALTIME_REAUTH_CACHE_WEAKENS_POLICY` is written when the re-authentication service starts, through the application's logger, and no longer at registration.

#### Apply to a derived backend

A `sseEndpoint` or `sse.endpoint` that held whitespace, an options argument or factory result that was not an object, and a group that was a `Date` or another built-in now fail at registration, where they used to start or fail later: fix the value. A `RedisOfflineQueue` built without options or without a `client` now throws at construction. An instance of your own class is still read as a group by its keys, unless it sets its own `Symbol.toStringTag` to something other than `'Object'`.

A dashboard that sums `bymax_realtime_connections_refused_total` over its labels now includes `reason="error"`. A log pipeline that found `REALTIME_REAUTH_CACHE_WEAKENS_POLICY` at registration finds it at start-up, after `app.useLogger`, and only when the authenticator implements `revalidate`.

### Security

- **A log line no longer carries the text of an error raised by the application's own code.** Events such as `REALTIME_HANDSHAKE_FAILED`, `REALTIME_HOOK_FAILED`, `REALTIME_DELIVERY_FAILED`, `REALTIME_DISCONNECT_FAILED`, `REALTIME_OFFLINE_QUEUE_ACK_FAILED`, `REALTIME_PUBSUB_UNSUBSCRIBE_FAILED`, `REALTIME_REAUTH_FAILED`, `REALTIME_REVOCATION_FAILED`, `REALTIME_COMPOSITE_PARTIAL_FAILURE`, `REALTIME_PUBSUB_UNAVAILABLE` put the error's own message into `message`, so an authenticator or a hook that threw `x user=U tenant=T` reached the line. `message` now holds the library's own text only, and the error goes under `err` as the error itself, which is where a structured logger applies its serializer and its redaction. A spec reads every `logEvent` call and fails when a message reads an error.

#### Apply to a derived backend

An alert, a filter or a dashboard that matched the text of an application error in the `message` of one of those events must read the `err` field instead. A custom `LoggerService` that turns a log argument into a string prints the object, including `err`; give it the object, or serialize `err` in it.

### Documentation

- **The README names every export of every public subpath.** A spec now fails when a name in the public-surface snapshot, or one of the contract members an implementor writes, is missing from it. The README gained a Types and constants section and the Observability section.
- **The README says what a duplicate `socket.io` does.** Two copies in `node_modules` make TypeScript report TS2416 on `RealtimeIoAdapter` under `skipLibCheck: false`; the fix is one copy.
- **The README names the `./internal` exports and `ITransport.kind`, and a spec holds it.** The spec that fails when a public export is not named now covers the names `./internal` exports explicitly. The README also says that `./observability` needs its optional peers, and that without them the import fails with the runtime's own `Cannot find module` error, which names the peer.

## [1.2.18] - 2026-11-17

### Security

- **An option set to `undefined` resolved to "no bound", and a refusal echoed what it was given.** The defaults were merged with `{ ...DEFAULT_SSE, ...options.sse }`, so an own key holding `undefined` overwrote its default. Measured on 1.2.17 with `sse: { maxConnectionsPerUser: undefined, maxQueuedBytes: undefined, maxQueuedEvents: undefined, stallHeartbeats: undefined, replayBufferSize: undefined }`: the options the services receive carried `undefined` for all five, the per-user eviction returns early on `undefined` (no cap), and the three queue bounds are read with `?? 0`, which switches them off. A host that spelled an option as `cond ? value : undefined` therefore ran with the bound off instead of the default. Separately, the refusals of the numeric and enum options ended in `got <value>`, which printed whatever the host had passed: a token pasted into the wrong field, or the source text of a function. Now the keys that hold `undefined` or `null` are dropped, at the top level and in `sse`, `websocket` and `reauthenticationPolicy`, before the defaults are merged and before validation, so such an option resolves to its default and is validated as absent; a group handed over as a class instance is read through its fields and getters, as the services read it, so it is covered too. Every refusal of an option names the option and the type of what it received (`received a string`), prints a finite number, and echoes nothing else; the two `forRootAsync` endpoint refusals no longer print the paths.

- **`RedisOfflineQueue` accepted a `maxPerUser` or a `ttlSeconds` that loses or corrupts the queue.** Measured on Redis 7: a `ttlSeconds` of `0` or a negative made `EXPIRE` delete the key, so every append was dropped without an error; a `maxPerUser` of `0` made the trim remove every entry; and `NaN`, a fraction, `Infinity`, `1e300` or a value Redis rejects made the pipeline fail after `ZADD` had already run, which left the entries untrimmed or the key without an expiry, and every append rejected. A numeric string such as `'3'` concatenated in the trim (`'3' + 1` is `'31'`), keeping up to 30 events. The constructor now refuses anything that is not a safe integer from 1 to 100,000 for `maxPerUser` and from 1 to 2,147,483,647 for `ttlSeconds`, with `REALTIME_INVALID_OPTIONS` naming the option and its range and describing what it received by type (a finite number is printed). A `maxPerUser` or `ttlSeconds` of `undefined` or `null` is read as unset and takes its default.

- **A malformed pluggable piece, group or flag was accepted at start-up and failed later, or did the opposite of what it said.** Measured on 1.2.17 with `forRoot`: `pubsub: {}` and a `pubsub` without `subscribe` were accepted and the application then failed at init with a raw `this.pubsub.subscribe is not a function`; `sse.endpoint: 5` failed at registration with `endpoint.startsWith is not a function`; `offlineQueue: {}` and `presence: {}` were accepted, and with `offlineQueue: {}` an emit to an offline user rejected at run time with `REALTIME_TRANSPORT_UNAVAILABLE`; `tenantResolver: 'x'` was accepted and every handshake then threw a `TypeError` at `tenantResolver?.(auth)`; `hooks`, `sse`, `websocket` and `reauthenticationPolicy` were accepted as strings; `sse.emitConnectionEvent: 'no'` was accepted and read as true because it is truthy. `forRoot` now refuses each at registration with `REALTIME_INVALID_OPTIONS`, naming the option and describing what it received by type: a group (`sse`, `websocket`, `reauthenticationPolicy`) and `hooks` must be objects; `pubsub`, `offlineQueue` and `presence` must be objects with every function of their interface, which may be on a class prototype; each lifecycle hook that is set and `tenantResolver` must be functions; the two `emitConnectionEvent` flags must be booleans; and `sse.endpoint` must be a non-blank string, with or without a leading slash.

#### Apply to a derived backend

An option that holds `null` was refused (`got null`) and is now read as unset, like `undefined`: it takes its default. An option you meant to leave unlimited with `undefined` now takes its default instead, so say `0` where `0` switches the bound off. A test that pinned the text of a refusal (`got 1000`, `(got: carrier-pigeon)`) now reads `received 1000` and `received a string`.

A queue built with `new RedisOfflineQueue({ client, maxPerUser, ttlSeconds })` now throws at construction for a value outside those ranges, where it used to start and lose events. If you passed `0` to mean unlimited, there is no such mode: pick the count you can afford to hold per user.

A test double for the bus, the offline queue or presence that implements only the functions a test calls is now refused at registration: give it every required function, as a no-op where it does nothing. A flag you passed as a string (`'false'`) is refused instead of being read as true; pass a boolean.

### Documentation

- **Details the 1.2.17 notes did not state.** A subclass of `WebSocketTransport` that replaces `joinRooms` drops, besides the user, tenant and connection rooms, the rooms an authenticator returns (`AuthenticationResult.rooms`) and the update of the `RoomRegistry`; a `static` member named `joinRooms` or `runOnConnect` compiles, because only the instance members are private; and for `emitToRoom` the change a caller can observe in 1.2.17 is that a `roomId` that is not a non-empty string is refused as a rejected promise, an outcome 1.2.16 did not have. `CONTRIBUTING.md` no longer describes a `commit-msg` hook and a `pre-commit` hook that this repository does not have.

- **A shutdown can wait six seconds for a client that stopped reading.** `app.close()` ends every stream at once, but Node's HTTP server then waits for the sockets of clients that no longer read, for `keepAliveTimeout` and a check interval: 6,004 ms measured, against 3 ms with `forceCloseConnections: true`. The README's "Shutdown" section now says so. Apply: pass `{ forceCloseConnections: true }` to `NestFactory.create`, or give the process a termination grace of at least 7 seconds.

## [1.2.17] - 2026-11-17

### Added

- **`onConnectFailure: 'ignore' | 'close'`, a module option for what a failing `onConnect` does to its connection.** A hook that throws or rejects was only logged on both transports, so a host whose `onConnect` did work the connection depends on (a presence record, a scoped join) kept serving a connection that work had not reached. With `'close'` the failure is logged and the connection is closed. On both transports the hook has run, so `onConnect` is seen before the `onDisconnect` that follows it, and an event published while the hook runs may already have reached the client: on WebSocket the connection is closed before `connection:established` is sent, on SSE the stream is ended once the hook settles. Scope a connection in `AuthenticationResult.rooms` when no event may be missed. On WebSocket a hook that does not settle within `hookTimeoutMs` counts as a failure; on SSE the hook has no limit. The default is `'ignore'`, the behaviour of every earlier release, and any other value is refused at start-up with `REALTIME_INVALID_OPTIONS`.

#### Apply to a derived backend

Nothing changes unless you set the option. If you do, make sure your `onConnect` fails only when the connection should not stand: a hook that throws for a transient reason (a metrics client down) will then close the connection.

### Security

- **The text of a driver or a broker travelled on the 503 errors the library raises when they were stringified.** `unavailableError` set the failure underneath, a driver's message naming a host and a port, on the instance's own enumerable `message` and `cause`. A controller's 503 body was generic, but a filter, a logger or a socket acknowledgement that ran `JSON.stringify` on the instance sent them on. Both are now non-enumerable: `error.message` and `error.cause` still hold the text for whoever logs it, and the stringified instance carries the generic response and the stable `code`.

- **`joinRoom` could put a connection in another user's or tenant's room.** `AuthenticationResult.rooms` refused names that start with `user:`, `tenant:` or `connection:`, but `RealtimeService.joinRoom` and `leaveRoom` took any name. On WebSocket `emitToUser` and `emitToTenant` are delivered to the room named after the identity, so a host that forwarded a client-supplied room id to `joinRoom` let that client receive `user:<victim>` or `tenant:<other>` events by naming the room. Both calls now refuse those three prefixes with `REALTIME_AUTH_FAILED`, by the same rule admission uses; the message names the call, the field and the prefix, never the room id. `emitToRoom` does not refuse the prefixes: a name it is given only reaches that user's or tenant's own connections.

- **A room name that was not a string skipped that check.** socket.io's `join` and `leave` accept an array of names, so on WebSocket `joinRoom(id, ['user:<victim>'])`, `['tenant:<other>']`, `['connection:<id>']`, `['ok', 'user:<victim>']` and a nested array all resolved, and the connection then received what `emitToUser`, `emitToTenant` and the per-connection room delivered; `leaveRoom` took the same values. On SSE `emitToUser` and `emitToTenant` read the connection registry rather than a room, so the same names did not reach those events there; a room named that way was still joined, and `emitToRoom` with that name reached it. `joinRoom`, `leaveRoom` and `emitToRoom` now refuse a `roomId` that is not a non-empty string, before any room API sees it, with `REALTIME_AUTH_FAILED` and a message that names the call and the kind of value, never the value. The check is on `RealtimeService`, `WebSocketTransport`, `CompositeTransport` and the SSE transport, so injecting a transport directly is covered too. Measured: with real Socket.IO clients, an array, a nested array, a mixed array and a `Set` naming another identity's room are refused and the attacker's connection receives none of the events published for that identity; an object with a `toString`, a number, `null`, `undefined`, a `String` object and the empty string are refused in a unit table on the service and the SSE transport.

- **A per-user connection cap, the replay ring's size and the WebSocket payload bound could be switched off by a value that is not an integer.** The checks on `sse.maxConnectionsPerUser` and `sse.replayBufferSize` were comparisons (`< 0`), and `websocket.maxConnectionsPerUser` and `websocket.maxHttpBufferSize` had none, so `NaN`, which fails every comparison, passed and made the bounds they feed never trip. Measured: five connections of one user were all kept under `NaN` and `Infinity` on both transports; a replay ring given 1,000 events held all 1,000; and a Socket.IO server given `NaN`, `Infinity`, `-1` or `0` delivered a 2,000,000-byte payload that the default 1,000,000 bound refuses. A fraction and a numeric string were accepted too and then coerced by the comparison they fed. The four options are now validated at start-up as safe integers, `>= 0` for the counts and `>= 1` for the payload bound, each with a most, with `REALTIME_INVALID_OPTIONS`: 100,000 for either per-user cap and for `sse.replayBufferSize`, and 104,857,600 bytes (100 MiB) for `websocket.maxHttpBufferSize`. `Number.isInteger(1e300)` is true and the comparisons these options feed never trip at that size, so `1e300`, `Number.MAX_VALUE` and `2 ** 53` were a bound in name only; the integer options that had no most now refuse anything past 9,007,199,254,740,991.

#### Apply to a derived backend

Read the failure from `error.message` and `error.cause`, as before; do not rely on them appearing in `JSON.stringify(error)` or in `Object.keys(error)`.

A host that puts connections in a `user:`, `tenant:` or `connection:` room by hand now gets a rejected promise from `joinRoom` or `leaveRoom`; no call puts a connection in those rooms, because the library joins them itself from the identity it resolved. To send to one identity or tenant use `emitToUser` or `emitToTenant`; on WebSocket, to send to one connection use `emitToRoom('connection:<id>', ...)`, which is not refused. A `roomId` that is not a non-empty string, an array included, is refused the same way. Application rooms are unaffected.

At start-up a value that is not an integer is refused where it used to be accepted: `NaN`, `Infinity`, fractions and numeric strings for `sse.maxConnectionsPerUser`, `sse.replayBufferSize`, `websocket.maxConnectionsPerUser` and `websocket.maxHttpBufferSize`, plus `-1` for `websocket.maxConnectionsPerUser` (it switched the cap off, as `0` does) and `0` or a negative for `websocket.maxHttpBufferSize` (each switched the payload bound off). `0` is still how to switch off the two per-user caps, and `0` still means no replay for `sse.replayBufferSize`. If you want an unbounded value, say it with `0` where that is allowed, not with `Infinity`. A value above 100,000 for either per-user cap or `sse.replayBufferSize`, or above 104,857,600 for `websocket.maxHttpBufferSize`, is refused too.

`WebSocketTransport` gains two private members, `joinRooms` and `runOnConnect`, which `registerSocket` calls. A TypeScript subclass that declares a member with either name no longer compiles (TS2415, a private member of the base), and a JavaScript subclass that defines either replaces the joins of the user, tenant and connection rooms, or the call to `onConnect`, without any error. Do not declare members named `joinRooms` or `runOnConnect` in a subclass.

`RealtimeService.emitToRoom` is now an `async` method: it already returned `Promise<void>`, and a synchronous throw, including the refusal of a `roomId` that is not a non-empty string, now comes back as a rejected promise. `./internal` exports `requireRoomName` and `refuseReservedRoom`; `./internal` is not public API and carries no compatibility promise, so do not import them.

On SSE the `reason` that `onDisconnect` receives is set when the library closed the connection with one (`disconnect(connectionId, reason)`, the connection bounds) and is `undefined` otherwise: a connection that ended on its own, one that `onConnectFailure: 'close'` refused, or one closed at shutdown.

## [1.2.16] - 2026-11-14

### Fixed

- **A publish to a Redis that had stopped answering never settled.** `RedisRealtimePubSub.publish` awaited the `PUBLISH` with no limit once its client reported `ready`, and a paused or partitioned Redis accepts the socket and never replies, so every `emitToRoom`, `emitToTenant` and `broadcast` that waited on the bus, and every `disconnect()` of a connection held on another instance, stayed pending. A publish now gives up after two seconds and rejects with `REALTIME_PUBSUB_UNAVAILABLE`, the error it already raised when the client was not ready, so no caller changes: an emit reports the failure through `onDeliveryFailure`, and `disconnect()` rejects. The rejection means the server did not confirm the publish in time, not that it was not delivered: the command had already been written to the socket, so Redis can still process it when it answers, and an emit can arrive after it was reported failed.
- **A pub/sub payload that was not an object was dropped without a trace, and the messages the subscriber could not act on flooded the log.** A payload that parsed to `null` threw inside the subscriber into a catch that discarded it, with no count and no line; a message with no known op, or a known op with no `args`, wrote one warning for each message, with no limit, and carried the op or the error's message, which whoever can publish to the channel controls. A payload that is not an object is now counted by the report of malformed payloads, and everything else the subscriber cannot act on is reported once for each ten seconds, with a count and a reason that is either `unknown op` or the class of the last failure, never the op, the payload or an error's message.

#### Apply to a derived backend

Set `commandTimeout` on the ioredis client you give `RedisRealtimePubSub` (for example `new Redis({ commandTimeout: 5000 })`) if you want the command itself rejected: the library's limit stops the caller waiting, but the command stays queued in the client until the server answers or the connection drops. If you alert on the log lines `Unknown pub/sub op: …` or `Pub/sub message handling failed: …`, they no longer exist: alert on `Pub/sub dropped N message(s) it could not act on since the last report` instead. Nothing else changes.

## [1.2.15] - 2026-11-14

### Fixed

- **Closing the application waited for ever on a Redis that had stopped answering.** The Redis pub/sub subscriber is closed with a `QUIT`, a command on a connection, and on a connection that accepts the socket and never replies (a paused or partitioned Redis) it never settles, so `app.close()` stayed pending until the process was killed. The close now waits two seconds for the reply and then disconnects the connection. The subscriber that `RealtimeIoAdapter` opens for the Socket.IO Redis adapter with `pubClient.duplicate()` was never closed at all; it now is, in `dispose()`, once every server has closed, and on one bound for all of them. Your `pubClient` is never closed or changed.
- **A failing command of the Socket.IO Redis adapter's subscriber could end the process.** The adapter sends its `subscribe` and `unsubscribe` without awaiting them, so a command that failed, as every pending one does when its connection is closed, was an unhandled rejection. Each is now handled, and logged once per connection by the error's class only, never its message.

#### Apply to a derived backend

`RealtimeIoAdapter` gains a public `dispose()`, which closes the subscriber connection it opened; a class that extends it and overrides `dispose()` must call `super.dispose()`, or that connection stays open. Nothing else changes. Against a healthy Redis a shutdown is as it was; against one that does not answer it now finishes instead of never finishing, waiting a bounded time for each Redis connection it closes. The documentation said the library never opens its own Redis connection; the Socket.IO Redis adapter's subscriber is one, and `RealtimeIoAdapter` is what closes it.

## [1.2.14] - 2026-11-14

### Security

- **A reconnect could wait for a hung offline queue for ever.** The read of the offline queue that a `Last-Event-ID` reconnect makes before its stream opens had no time limit, so a store that accepts the call and never answers left every such request open, each holding a socket, a request and a place against `maxConnections`. The read is now made with the authentication, before the response is committed, and bounded by `authenticateTimeoutMs` (default 10,000 ms): a queue that has not answered in time ends the handshake with a `503` and the generic body, registers nothing and gives the place back, and the late answer is ignored. A queue that fails is unchanged: the error is reported and the client gets its live events with an empty gap. The timeouts are logged once for each ten seconds with a count. The queue is read a second time when the stream is built, for what was appended while the application's interceptors ran (an event emitted to the reconnecting user then is in the queue and in no replay ring), and what the first read came to decides what follows: when the store failed on the first read the reconnect is served without a gap, as an outage has always been served, with no second read; when the first read succeeded, a timeout of the second, its refusal because the reads waiting are all taken, or an error from the store ends the attempt before anything is delivered, so the client's cursor does not move past events that are still stored. The call to the store cannot be cancelled, so it runs on until the store gives up, and it keeps its place among the `maxPendingHandshakes` (default 1,000) offline reads waiting at once until it settles: a reconnect that finds them all taken gets the `503` at once, without a call to the store. Set `commandTimeout` on the ioredis client behind `RedisOfflineQueue`.

#### Apply to a derived backend

A reconnect whose offline queue takes longer than `authenticateTimeoutMs` now gets a `503` where it used to wait; raise `authenticateTimeoutMs` if your queue is legitimately slower. `OfflineQueueDeliveryService` takes the options as an optional last constructor argument, and `retrieve` can now reject with the new `OfflineQueueTimeoutError`.

- **Nothing limited how many connections an instance accepted.** `maxConnectionsPerUser` bounds one user, but many users, or a token minted for each request, could open connections until the process ran out of file descriptors and stopped serving, on either transport. The new `maxConnections` (default `10000`, an integer of 1 or more) bounds the instance: it counts the connections of both transports together and the handshakes admitted and not yet registered, and a handshake past it is refused before `authenticate` is called, so a flood of them costs your backend no call. SSE answers `503` with the generic body (no `Retry-After`), WebSocket the generic `connect_error`; the refusals are logged once for each ten seconds with a count. A place held for a handshake is given back when its connection is registered or when its request or socket closes, whichever comes first, and in any case after `authenticateTimeoutMs` plus 5,000 ms, so a handshake that dies half way does not use up the limit. A reconnect whose offline-queue read outlives its place takes one again before it registers, and its stream ends if the instance has filled in the meantime. The limit trades a crash for refused new connections: it cannot evict, so an attacker who fills it keeps real clients out until sockets close, and limits for each address and the proxy stay the real controls.

#### Apply to a derived backend

**An instance that holds more than 10,000 connections at once now refuses the next ones.** Set `maxConnections` to what the instance really serves, below the process's file-descriptor limit less headroom (see the README for a worked example); there is no value that switches the bound off, so a larger instance sets a larger number. `BymaxRealtimeModuleOptions` gains `maxConnections`, an integer of 1 or more, checked at start-up. `SseTransport` and `WebSocketTransport` take an optional `ConnectionAdmission` as their last constructor argument and expose `admit()`; a transport built by hand without it admits every connection, as before. `SseResponse` gains an optional `once('close', listener)` and an optional `raw`, which the handler uses to give a place back when a response ends: on the response itself (Express), on the Node response behind a reply (Fastify's `reply.raw`), or on the socket. Whatever the framework reports, a place that nothing has given back within `authenticateTimeoutMs` plus 5,000 ms is given back at the next admission, so a request that dies unseen cannot fill the instance.

- **A `revalidate` that returned nothing kept the connection.** The result was defaulted to `true` when the call returned `undefined`, so an authenticator whose `revalidate` forgot to return (a missing `return`, a branch that falls through) approved every connection at every cycle, for ever, and so did one that resolved to `null`. Only an explicit `true` keeps a connection now; `false`, `undefined`, `null` and any other value disconnect it by the same path, with the same reason and hook. An authenticator with no `revalidate` at all is unchanged: there is nothing to check.

#### Apply to a derived backend

A `revalidate` that does not return `true` on every path now disconnects the connection at its next cycle where it used to keep it. Check that each branch of yours returns a boolean.

- **The replay buffer kept the events of every user it was told about, for ever.** `emitToUser` appended to a per-user ring for any user id, whether or not that user had ever connected, and nothing removed an entry: a service that emitted to every user in its database made every instance hold up to `replayBufferSize` events for every one of them, without bound (20,000 users that never connected, 10 events each, were still held after the module closed). The buffer now keeps only the users that have a connection on the instance, or had one lately: an entry is created when a connection opens, kept for `sse.replayTtlMs` (default 300,000 ms) after the user's last connection closes, and at most `sse.replayMaxIdleUsers` (default 1,000) idle entries are kept at once, the one that closed longest ago going first. The ring of a user with a connection open is never evicted, so the most the buffer holds is (connections open + `replayMaxIdleUsers`) x `replayBufferSize` x the size of an event. Expiry is checked when the buffer is used, so there is no timer. **Behaviour change:** replay is per instance. An instance used to buffer the events of users that were not connected to it, so a client that reconnected to a different instance could be replayed events emitted before it arrived, when the ids happened to line up; ring ids are per instance, so that could skip or repeat events. It no longer happens: without sticky routing, a reconnect to another instance gets the offline queue (when configured), not replay.

#### Apply to a derived backend

`SseOptions` gains `replayTtlMs` (an integer from 1 to 2,147,483,647) and `replayMaxIdleUsers` (an integer of 1 or more), both checked at start-up. `EventReplayBuffer` gains `open(userId)` and `close(userId)`, which `SseTransport` calls when a connection registers and when it is released, and `append` drops the event of a user with no entry: a derived transport that appended directly must call `open` first.

- **One re-authentication call that never settled kept every connection after it from being revalidated or revoked.** The cycle ran serially and `revalidate` had no time limit, so a call that hung (an auth backend that accepts the request and never answers) left every later connection un-checked, and a connection whose credentials had been refused stayed connected, on every cycle after. Each call is now bounded by `reauthenticationPolicy.revalidateTimeoutMs` (default 10,000 ms), and a call that does not settle in time is treated as one that threw: the connection is revoked. The cycle runs up to `concurrency` (default 8) connections at once, and a connection with a call in flight is not asked again, so overlapping cycles no longer call `revalidate` several times at once for one connection. An auth backend that is down or slower than the timeout therefore revokes every connection due in that cycle, and the clients are refused at the handshake until it recovers: set the timeout above the backend's p99.

#### Apply to a derived backend

`ReauthenticationPolicy` gains `revalidateTimeoutMs` and `concurrency`; `IConnectionAuthenticator.revalidate` takes an optional third argument `{ signal: AbortSignal }` (new exported type `AuthenticatorCallOptions`), aborted on timeout; `ConnectionRecord` gains an optional `revalidatedAt`, which holds the time of the last confirmation instead of a map in the service. The re-authentication options are now validated when the application starts: `intervalSeconds`, `revalidateTimeoutMs` and `concurrency` must be integers of 1 or more, `cacheTtlMs` an integer of 0 or more, and `onFailure` `'disconnect'` or `'event'`. An `intervalSeconds` of 0 or a fractional one used to start a timer firing every millisecond or so, and now stops the application at start-up.

- **The memory kept for re-authentication no longer outlives the connection.** The cache of successful checks was a map that was cleared only on revocation and at shutdown, so every connection that was revalidated and then closed left an entry behind (1,000 closed connections left 1,000). It now lives on the connection's record.

- **A re-authentication failure could leave a connection connected.** When a connection's credentials were refused, a `onReauthenticationFailed` hook that threw before it returned (a plain function, which the interface allows) aborted the failure handling before the connection was disconnected, so a failing notification hook could keep a connection whose credentials had been refused until the next cycle, and the same on every cycle after. The hook's failure is now logged and the connection is disconnected as before.

- **An authenticator that never answered held every handshake for ever, and nothing limited how many could be waiting.** `authenticate` was awaited with no time limit, on SSE and on WebSocket, so a backend that accepts the request and never answers left every request or handshake pending, each holding a socket and a request, with no cap: one slow dependency, or one attacker, could exhaust the instance. A call that has not settled in the new `authenticateTimeoutMs` (default 10,000 ms) is now given up on, and the client is refused: a `503` with the generic body on SSE, the generic `connect_error` on WebSocket, and nothing about the cause reaches the client. At most `maxPendingHandshakes` (default 1,000) calls are waiting at once across both transports, and a call keeps its place until it actually settles, so an authenticator that never answers fills the limit and further handshakes are refused at once without being asked, instead of being given a new call each. A slow backend can therefore hold the limit full for as long as it stays slow, which is intended. The refusals are logged once for each ten seconds with a count, and nothing of the request is in the line.

#### Apply to a derived backend

`BymaxRealtimeModuleOptions` gains `authenticateTimeoutMs` (an integer from 1 to 2,147,483,647) and `maxPendingHandshakes` (an integer of 1 or more), both checked at start-up. `IConnectionAuthenticator.authenticate` takes an optional second argument `{ signal: AbortSignal }`, aborted on timeout; the type that `revalidate` already used is now named `AuthenticatorCallOptions` and is shared by both (it was `RevalidateOptions`, in this unreleased version). `SseTransport` takes the new `AuthenticationGate` in place of the authenticator, and `WebSocketTransport.authenticator()` is replaced by `authenticate(context)`, which goes through the same gate. An SSE handshake can now be answered `503` where it used to wait or answer `500`.

- **A WebSocket user could hold any number of connections.** `websocket.maxConnectionsPerUser` was opt-in, so with nothing configured one user (or one token) could open sockets without limit, each holding a file descriptor and its memory, while SSE already stopped at 5. The default is now `5` on both transports: the sixth connection of a user closes the user's oldest, which is sent a disconnect and gives up its slot, so a user is left with five. The new connection is registered before the oldest is closed, so for the moment between the two a user can hold six. The cap is per user only; it does not bound the sockets of an instance.

#### Apply to a derived backend

A user who legitimately holds more than five simultaneous WebSocket connections (many tabs or devices) now has the oldest closed unless `websocket.maxConnectionsPerUser` is raised. An explicit `0` keeps its meaning and switches the cap off. No option is added, and the type of the option is unchanged.

### Fixed

- **Retiring the subscription of a subscriber that had ended, or was waiting to reconnect, kept the process alive for about two seconds.** ioredis arms a timer in `disconnect()`, 2,000 ms by default, and clears it only when the socket emits `close`; a client that has ended, or is waiting to try again, has no open socket whose close is still to come, so the timer runs its whole length. `RedisRealtimePubSub` disconnected its subscriber in that state when it retired the subscription (at shutdown or when the last handler left) and when the first `SUBSCRIBE` failed, so an application that closed while Redis was unreachable was delayed by that timer. The subscriber is now created with a `disconnectTimeout` of 1 ms, so a retired subscriber has nothing to wait for; the publisher client you pass in is yours and is unchanged.

#### Apply to a derived backend

Nothing to change. An application or a test that closes while Redis is unreachable no longer waits about two seconds for the process to exit.

- **A client that opened a new `EventSource` after a refusal was never replayed what it missed, and a store that returns its events instead of a promise could fill the offline reads.** `useRealtimeSse` replaces its `EventSource` after an error (once its backoff has passed) and on a manual `reconnect()`, and a new `EventSource` has no last event id, so it sent no `Last-Event-ID`: after a `503` from the offline queue or the instance limit the gap was never read. The hook now keeps the id of the last event it saw, for the url it was opened with, and adds it to the url of the next stream it opens as the `lastEventId` query parameter (before any fragment, encoded, replacing a `lastEventId` the url already carries; nothing is added until an event has been seen). The server reads the id from the `Last-Event-ID` header or, when there is none, from `lastEventId`, at the three places it uses it (the replay ring, the guard's read of the offline queue and the second read), and the header wins when both are present. An id longer than 256 characters, from either place, and a query value that is not a single string are read as no id; the ids this library generates are 20 characters. Separately, `OfflineQueueDeliveryService` counted a call to the store before it knew the call was a promise, so a store whose `retrieveSince` returns its events directly (a JavaScript consumer, say) left the place taken for ever, and enough of them refused every reconnect with `503` until a restart; the result is now wrapped before it is counted.

#### Apply to a derived backend

Nothing to change: an older server ignores the parameter, and an older client does not send it. A server in front of which a proxy or a CDN caches or logs URLs now sees `lastEventId=<id>` on a reconnect, so treat the id as logged. If you pass your own `EventSource` url, you can add `lastEventId` yourself. A custom `IOfflineQueueStorage` whose `retrieveSince` returns a promise is unchanged.

- **A call that found no path left answered `500`.** `emitToUser` with no delivery path, a `disconnect` the bus refused and a transport with no server attached rejected with a plain `Error`, so a controller that let it escape answered `500`, which reads as a defect in the application for what is an outage of its store. The rejection is now Nest's `ServiceUnavailableException`: `503` with the generic body `{"statusCode":503,"message":"Service Unavailable"}`. The message that names the failed call, `error.code` and the `cause`, which can hold a driver's text with a host and credentials, stay on the instance for your logs and are never in the response. A WebSocket handshake refused because the authenticator is unavailable (a timeout or `maxPendingHandshakes`) or because the instance is full (`maxConnections`) now carries `data.code` `REALTIME_TRANSPORT_UNAVAILABLE`, with the message still generic, so a client can tell a retryable refusal from a refused identity; a blank identity or any other failure of `authenticate` stays generic with no code.

#### Apply to a derived backend

If you matched the rejection of `emitToUser`, `disconnect`, `joinRoom` or `leaveRoom` with `error.constructor === Error`, or answered `500` for it in a filter, it is now a `ServiceUnavailableException` (`error.getStatus()` is `503`); `error.code`, `error.message` and `error.cause` are as before, so code that branched on `error.code` is unchanged. Nest's default filter logged the plain `Error` with its stack but does not log an `HttpException`, so log these from an exception filter if you relied on that line. A WebSocket client that treated every generic `connect_error` alike can read `error.data?.code === 'REALTIME_TRANSPORT_UNAVAILABLE'` to retry.

- **The replay buffer could count a repeated close against a user's open connections, and aged its idle entries by the wall clock.** A `close` for a user with no open connection took the count below zero, so a later pair of opens and one close made an entry with a connection still open look idle, to be expired and evicted while the user was connected. A close with nothing open is now ignored. The age of an idle entry was read from `Date.now()`, so a clock stepped forward (NTP, a manual change) expired every idle entry at once and one stepped back kept them for as long as the step; it is now read from `performance.now()`, which only moves forward.

- **A consumer's disconnect hook that never settles can no longer keep a client connected, or the application from closing.** On SSE the connection was cut only after `onDisconnect` returned, so a hook that never settled left the stream open, delayed every revocation through `disconnect()`, held back the admission of a user's next connection behind the eviction of the previous one, and, because shutdown closed the connections one after another and waited for each, made `app.close()` take as many hook latencies as there were connections, or never finish at all (the HTTP server does not close while a stream is open). The connection is now removed and its stream cut first, and `onDisconnect` runs after; every connection is closed at once on shutdown. On WebSocket `registerSocket` awaited `onConnect` before the connection was announced, so a hook that never settled left the client never told it was connected. The hooks the library awaits (`onDisconnect` on both transports, WebSocket `onConnect`) are given up on after the new `hookTimeoutMs` (default 5,000 ms): the failure is logged and the connection is left as it is, so closing the application takes about one `hookTimeoutMs` however many connections there are.

#### Apply to a derived backend

`BymaxRealtimeModuleOptions` gains an optional `hookTimeoutMs`, an integer from 1 to 2,147,483,647, checked at start-up (the same ceiling now applies to `reauthenticationPolicy.revalidateTimeoutMs`, `websocket.pingIntervalMs` and `websocket.pingTimeoutMs`, and `intervalSeconds` is at most 2,147,483: Node runs a longer timer as 1 ms). In the React hook the reconnect delay is capped at the same ceiling, and a `reconnectInitialMs` or `reconnectMaxMs` that is not a positive whole number (a `NaN` from a bad parse, an infinity, 0, a negative) is replaced by its default, so neither can become a reconnect every millisecond against the server. `onDisconnect` on SSE now runs after the connection's record has been removed and its stream closed (it already ran after the record was removed), and may be abandoned after the timeout, with the late result ignored. `SseTransport.disconnectLocal` and `beforeApplicationShutdown` no longer wait for a hook for longer than the timeout.

- **A consumer's lifecycle hook that fails can no longer take the process down or touch a connection.** On WebSocket, `onDisconnect` ran in a handler Nest does not wait for and was not guarded, so a hook that rejected or threw (a presence store that is down, for one) left an unhandled rejection, which ends the process on Node 15 and later, on the next disconnect of any client; and a failing `onConnect` disconnected the client it was announcing. Both are now logged and the connection is left as it is, as on SSE. A hook that throws before it returns (a plain function, which the interface allows) also escaped the SSE `onConnect` path and ended the stream with a 500. A hook is a notification; its failure is logged and nothing else changes.
- **An SSE client that does not read can no longer grow the server without bound.** The response writes one event at a time and waits for the client to read, and every event behind that wait was held in memory with no limit: 100 MB sent to one connection that never read raised the server's memory by 167 MB and the connection stayed registered. Each connection is now bounded by `sse.maxQueuedBytes` (default 2 MiB) and `sse.maxQueuedEvents` (default 1000), counted as the frames Nest writes, from what has been sent and its socket has not yet taken, and a connection from which no byte has left the process for `sse.stallHeartbeats` heartbeats (default 3) while the response holds bytes is closed too. It is closed with the new reason `REALTIME_SLOW_CONSUMER` and a warning, only that connection, and the client reconnects with `Last-Event-ID`. An event that is alone in the queue is always taken, however large. `0` switches a bound off. The same 100 MB now closes the connection after 22 events with no growth in the server's memory. A bound that was not there before can close a client that had stalled; set the three options to `0` to keep the old behaviour.

#### Apply to a derived backend

`SseOptions` gains `maxQueuedBytes`, `maxQueuedEvents` and `stallHeartbeats`, `RegisterSseConnectionParams` gains an optional `outbound`, `HeartbeatService.start` an optional fourth argument, `SseResponse` the optional `socket` and `writableLength`, and `REALTIME_ERROR_CODES` the `SLOW_CONSUMER` code. A derived transport that calls `registerConnection` without `outbound` keeps its connections unbounded.

- **The rooms joined at admission are the rooms that were validated.** `AuthenticationResult.rooms` is checked when the authenticator returns, and was joined later, after an await, from the same array. An authenticator that kept the array it returned and changed it in between could join names that were never checked, including a `user:` or `tenant:` room. The array is now copied once when it is validated, and only the copy, which is frozen, is joined and stored in `originalAuth`.

## [1.2.13] - 2026-11-13

No change to the published package: `dist/` is the same as in 1.2.12.

### Changed

- **An ESLint rule now enforces the auth-import rule.** A string literal under `src/` that names `@bymax-one/nest-auth`, `@nestjs/jwt`, `passport` or `passport-*` fails the lint step, so a literal specifier is refused in every form of `import` and `require`. It is covered by `src/eslint-auth-gate.spec.ts`.

### Documentation

- The README is audited and shortened. Shutdown has its own section, "What This Library Does NOT Do" replaces the deployment notes, and a compact Security Table and Tech Stack stay.

## [1.2.12] - 2026-11-12

### Added

- **`AuthenticationResult.rooms`: rooms joined at admission.** An authenticator can return extra
  rooms (a workspace, a project) that are joined before the connection is announced,
  on both transports. Joining from `onConnect` leaves a window: the connection is already live, so an
  event published to the room in between is missed, and room events have no replay. On SSE `onConnect`
  is not awaited and a hook that throws is only logged, so a connection scoped there can stay
  live without its room. A name must be a non-blank string of at most
  `ADMISSION_ROOM_LIMITS.MAX_ROOM_NAME_LENGTH` characters and must not start with `user:`,
  `tenant:` or `connection:`; at most `ADMISSION_ROOM_LIMITS.MAX_ROOMS` entries; duplicates
  join once. A result that breaks a rule is refused like a blank `userId`. The limits are bounds
  against abuse, not measurements, and apply to this field only; `joinRoom` is unchanged. The rooms
  are fixed at admission: `revalidate` receives them, and a different set returned later is not
  re-synchronized. `ADMISSION_ROOM_LIMITS` is exported from the root and `./shared` entries.

#### Apply to a derived backend

`ConnectionRecord.originalAuth` gains an optional `rooms`. A custom `IConnectionAuthenticator` is
unaffected; one that wants a scoped room returns it in `rooms` instead of joining it from
`onConnect`. A subclass of `SseTransport` or `WebSocketTransport` that overrides
`registerConnection` or `registerSocket` has to join `auth.rooms` itself.

### Fixed

- The JSDoc of `onModuleDestroy` on both transports now opens with its limit: a slow
  `onModuleDestroy` in a module nearer the root than the realtime module still runs first.

## [1.2.11] - 2026-11-09

### Fixed

- **Refusal during shutdown begins at `onModuleDestroy`, not at `beforeApplicationShutdown`.** Nest
  runs the hooks of a module nearer the root before those of a module it imports, so a host's slow
  `beforeApplicationShutdown` in the root module ran before the transport's own, and a WebSocket
  handshake or an SSE stream arriving in that window was accepted. Nest runs every module's
  `onModuleDestroy` before any `beforeApplicationShutdown`, so both transports now mark shutdown as
  begun there: from then on a handshake gets `REALTIME_TRANSPORT_UNAVAILABLE` and a stream gets a 503. A slow `onModuleDestroy` in a module nearer the root than the realtime module still runs
  first, and until it returns a connection is accepted: put slow shutdown work in
  `beforeApplicationShutdown`, or make the host stop accepting traffic before it calls `close()`.

#### Apply to a derived backend

`SseTransport` and `WebSocketTransport` gain a public `onModuleDestroy()` that marks shutdown as
begun. A subclass that overrides it has to call `super.onModuleDestroy()`.

## [1.2.10] - 2026-11-09

### Fixed

- **A WebSocket handshake that arrives while the application is closing is refused.** The handshake
  middleware authenticated every handshake and accepted it, however late it came, so a handshake
  that arrived once shutdown had begun reached an authenticator whose store the host may already
  have closed, and was accepted into a server that was about to close. From
  `beforeApplicationShutdown` on, the middleware refuses it with a `connect_error` whose
  `data.code` is `REALTIME_TRANSPORT_UNAVAILABLE`, before the authenticator runs and again if
  shutdown began while the authenticator was running; this is the refusal SSE gives with a 503.
  The code differs from `REALTIME_AUTH_FAILED`, which the same middleware uses for a refused
  credential, so a client can tell the two apart.

#### Apply to a derived backend

`WebSocketTransport` gains a public `beforeApplicationShutdown()` hook and a `shuttingDown` getter,
and `RealtimeGateway` gains a private `unavailable` method. A class that extends either and already
declares a member with one of those names has to rename it or override it on purpose. A subclass
of `WebSocketTransport` that overrides `beforeApplicationShutdown` has to call
`super.beforeApplicationShutdown()`, or the gateway keeps accepting handshakes while the
application closes. A gateway that replaces `RealtimeGateway`'s handshake middleware gets no
refusal from this change; it can read `transport.shuttingDown` itself.

## [1.2.9] - 2026-11-06

### Changed

- **With `transport: 'both'`, an emit that fails on both transports now rejects.** `emitToUser`,
  `emitToTenant`, `emitToRoom` and `broadcast` on the composite transport run on SSE and WebSocket
  and logged a failure of either without ever rethrowing, so an emit that failed on both still
  resolved. A failure of one transport is still logged and resolves; a failure of both now rejects
  with `REALTIME_TRANSPORT_UNAVAILABLE` (`error.code`), naming the operation and carrying both
  reasons in `cause`, the way `joinRoom`, `leaveRoom` and `disconnect` already do. A rejected emit
  is not proof that no client received it, so retry only where a duplicate is acceptable.

### Added

- **Errors carry their code as a `code` property.** The `Error`s this library builds with a
  `REALTIME_*` code in their message now also have that code as `error.code`, one of
  `RealtimeErrorCode`. The messages are unchanged. They are plain `Error`s, so match on
  `error.code`, not `instanceof`. The HTTP `UnauthorizedException` for a refused SSE connection and
  the Socket.IO refusal of a WebSocket connection keep their shape; the refusal carries its code as
  `data.code`.

### Fixed

- **A refusal of the subscription is logged once.** After a start-up that found Redis unreachable,
  the same refusal can answer two `SUBSCRIBE`s when the connection comes up: the one queued while
  Redis was unreachable, which ioredis sends when the connection first becomes ready, and the one
  the adapter sends on `ready`. The adapter logged `the server refused the subscription` once for
  each, so a refusing server produced two identical warnings. It now logs a refusal once until the
  instance next subscribes, and again if the reason changes. The wire may still carry two
  `SUBSCRIBE`s at that first `ready`; a repeat is harmless.
- **Closing the application no longer hangs while an SSE stream is open.** Nest awaits the HTTP
  server's close before it runs `onApplicationShutdown`, and the server does not finish closing
  while a response is open, but the streams were ended only in that hook. One open stream therefore
  kept `app.close()` pending, so a `SIGTERM` was ignored until the orchestrator's `SIGKILL` and
  every `onApplicationShutdown` hook was skipped, a tracing flush included. `SseTransport` now ends
  its streams and stops its heartbeats in `beforeApplicationShutdown`, which runs before the server
  closes, and its `onApplicationShutdown` stays and runs the same teardown, which finds nothing
  left. A stream requested once shutdown has begun is refused with a `503`, since nothing would end
  it, and one that was past the handshake when shutdown began is ended as soon as it is opened. `ITransport` gains the optional `beforeApplicationShutdown` hook. An open WebSocket
  connection, including one opened while shutdown is under way, did not hang the close.
- **A failed re-authentication now disconnects the connection without waiting for its
  notification.** With `reauthenticationPolicy.onFailure: 'event'` the service emitted
  `connection:reauthentication-failed` and waited for it before disconnecting, so an emit that
  rejected left the connection open until the next cycle, and one that never settled left it open
  for good. The emit is now started first and not awaited: a rejection is logged
  (`Reauthentication notification for <id> failed, disconnecting anyway`) and the connection is
  disconnected in the same cycle. A rejected disconnect is still a failed revocation and is retried
  on the next cycle.

- **A publish no longer waits behind a Redis client that is not ready, and readiness now says
  whether the instance can publish.** `RedisRealtimePubSub.publish` refused a client that was
  reconnecting or closed, but still handed the command to ioredis in `wait`, `connecting` and
  `connect`. A client whose server accepts the connection and does not answer the handshake kept
  the command pending. It now rejects with `REALTIME_PUBSUB_UNAVAILABLE` at once
  unless the client can publish, and never hands the command to ioredis otherwise. A client built
  with `lazyConnect` was left in `wait`, so `isPubSubReady()` reported true and the first emit was
  lost; the adapter now connects it when it subscribes, and a publish made before any subscribe
  connects it too (that publish is refused). `isPubSubReady()` is true
  only while the subscription is confirmed and the publishing client can publish. Subscribing waits
  up to 2 seconds for the publishing client to answer its first connection, so an emit from another
  provider's start-up hook is not refused for the client's first milliseconds; a client that
  answers nothing in that time is left unready and the application still starts.

#### Apply to a derived backend

Nothing needs to change for the shutdown fix: an application that closes with an SSE stream open
now finishes closing and runs its `onApplicationShutdown` hooks. A client that requests the SSE
route while the application is closing now gets a `503`. If you set `forceCloseConnections`
only to get past this hang, it is no longer needed for SSE streams.

If you set `reauthenticationPolicy.onFailure: 'event'`, nothing needs to change: a connection whose
credentials failed is now disconnected in the same cycle whether or not the notification can be
sent, where it used to stay open until the next cycle. The failure to send is logged as a warning.

If you use `transport: 'both'`, an emit that fails on both transports now rejects instead of
resolving. An emit you await inside a `try` is now caught; one you call without awaiting or without
a `.catch` becomes an unhandled rejection when both transports fail, so add the `.catch` or await
it. A failure of only one transport still resolves, as before.

Nothing needs to change for the `code` property: it is added to errors you already catch, and
their messages are the same. Where you match on the message text to tell a bus failure from a
transport failure, `error.code` is the stable way to do it.

If you pass `RedisRealtimePubSub` a client built with `lazyConnect: true`, the adapter now
connects it when it subscribes; connect it yourself only if you need it before then. An
emit made while the publishing client is `wait`, `connecting` or `connect` is now refused at once,
like one made while it reconnects, and a `disconnect()` of a connection held on another instance rejects with
`REALTIME_PUBSUB_UNAVAILABLE`. `isPubSubReady()` also turns false while the publishing
client cannot publish, so a readiness probe that took the instance out of rotation only on a lost
subscription now takes it out for a lost publisher as well. A client that reports no status, such
as the ioredis-mock double, is taken to be able to publish.

## [1.2.8] - 2026-11-06

### Changed

- **Built with tsup 9; the shipped bundles no longer carry comments.** The build now strips the
  comments from `dist/**/index.mjs` and `dist/**/index.cjs` after bundling, keeping legal comments,
  `__PURE__` annotations and region markers, and checks that the program is unchanged. The
  declarations keep their comments. The public surface is the same. The `internal` bundle is
  12,293 B brotli, inside its 13,500 B budget; the other budgets were reset to the stripped size
  plus about 11%.

### Fixed

- **A host Redis client built with `enableOfflineQueue: false` no longer fails the boot of `RedisRealtimePubSub`.**
  The subscriber connection is a copy of the host client and inherited that option, so its first
  `SUBSCRIBE`, issued before the connection exists, was refused by ioredis at once with
  `Stream isn't writeable and enableOfflineQueue options is false`. Since 1.2.7 that rejection was
  treated as the server refusing the subscription and failed the boot with
  `REALTIME_PUBSUB_UNAVAILABLE`, while Redis was healthy; before 1.2.7 the same combination logged a
  warning and left the instance without cross-instance delivery. The subscriber connection now keeps its own offline queue on, and only an error
  reply from the server counts as a refusal: any other rejection of the first `SUBSCRIBE` is the
  connection failing, so the boot completes unready and recovers like any outage.
- **`disconnect()` no longer hangs through a Redis outage.** `RedisRealtimePubSub.publish` handed
  the command to ioredis even while the client was reconnecting, and ioredis queued it until the
  connection returned (still pending after 30 s with its default options), so a revocation, and
  every emit, waited out the whole outage and was then sent late. It now rejects at once with
  `REALTIME_PUBSUB_UNAVAILABLE` (`cannot publish to "<channel>" (the Redis client is reconnecting)`)
  while the client is reconnecting, closed or ended, and never queues the command. `disconnect()`
  rejects with that code so the caller can retry, and an emit no longer waits for the outage.
- **An `sse.heartbeatMs` outside the allowed range now stops the application at start-up.** The
  boot check only rejected a value of zero or less, while the heartbeat service refuses anything
  outside 5,000 to 90,000 ms each time a connection opens. A value such as `1000` or `100000`
  therefore started the application and then answered every SSE connection with a 500.
  `NaN`, which comes from `Number(process.env.HEARTBEAT_MS)` when the variable is unset, passed
  both checks and made the keepalive timer fire about every millisecond on every connection.
  `validateOptions` now applies the same range, for `forRoot` and `forRootAsync`, and the error
  names it: `options.sse.heartbeatMs must be between 5000 and 90000 ms (got 1000)`.

#### Apply to a derived backend

A `disconnect()` made during a Redis outage now rejects immediately instead of waiting for the
reconnect, so the retry you already need for a rejected `disconnect()` happens sooner. An emit made
during an outage is no longer held and delivered late.

If your configuration sets `sse.heartbeatMs`, check it is between 5,000 and 90,000 ms. A value
outside it already failed every connection, except `NaN`, which flooded each connection with
keepalives; now every one of them fails when the application starts.

If you pass `RedisRealtimePubSub` a client created with `enableOfflineQueue: false`,
upgrade to this release. 1.2.7 fails the boot with `REALTIME_PUBSUB_UNAVAILABLE`
on such a client. Earlier versions did not fail: they logged `Failed to subscribe to pub/sub ...
Cross-instance fan-out disabled` once at start-up and then ran without cross-instance delivery, so
if you ran one of them with such a client, revocations and emits from your other instances may
never have reached it. Nothing needs to change in your configuration.

## [1.2.7] - 2026-11-01

### Fixed

- **A revocation that cannot reach its connection no longer answers success.** `disconnect()` on
  `RealtimeService` resolved even when the revocation was never delivered: a failed cross-instance
  publish was logged and swallowed, and in `transport: 'both'` a failure of either transport was
  swallowed with no log at all, so a revoked client could stay connected while the caller was told it
  was gone. It now rejects with `REALTIME_PUBSUB_UNAVAILABLE` when the bus refuses the revocation and
  with `REALTIME_TRANSPORT_UNAVAILABLE` when the transport that holds the connection fails or the
  WebSocket server is not attached. It resolves when the connection was closed on this instance or the
  revocation was handed to the bus. `joinRoom` and `leaveRoom` reject the same way when the
  transport that holds the connection fails, in place of reporting a join or a leave that did not
  happen, and they now change nothing for a connection the instance does not hold (they used to
  record a room membership with no connection behind it). An emit stays at-most-once and still
  resolves when its publish fails.
- **A revocation that fails during re-authentication is retried.** The cycle kept the failure to
  itself and stopped revalidating the remaining connections; it now logs it, goes on, and revalidates
  the connection again on the next cycle. A rejected cycle no longer leaves an unhandled rejection.
- **A failed publish or a failed offline-queue write is no longer silent.** An emit whose publish
  to the other instances was refused still resolves, as before, but the failure is now logged with
  `REALTIME_PUBSUB_UNAVAILABLE` and the operation and passed to the new `onDeliveryFailure` hook,
  which is where to count it. `emitToUser` now waits for the offline queue instead of firing and
  forgetting it, reports a failed write the same way, and rejects with
  `REALTIME_TRANSPORT_UNAVAILABLE` only when the event has no delivery path left: the user is
  offline here, the queue could not keep it, and the bus failed or cannot reach another instance
  (the default in-memory bus). With `transport: 'both'`, a rejection from either path, or from
  both, is logged as a warning and the call resolves; `onDeliveryFailure` is not called for that
  rejection. A failed offline-queue read on reconnect is reported too. A remote `disconnect` that
  fails no longer leaves an unhandled rejection, an unparsable bus payload is counted and reported
  at most once a minute instead of vanishing, and an emit made before the WebSocket gateway attaches
  its server says so once.
- **An instance that cannot hear the others no longer comes up silently deaf.** When the Redis
  pub/sub subscription at boot was refused (a wrong password, a missing permission) the library logged a warning and started anyway, so the instance missed every
  cross-instance revocation. A refusal now fails the boot with `REALTIME_PUBSUB_UNAVAILABLE`. When
  Redis is merely unreachable the boot used to hang, waiting for a subscribe that ioredis keeps
  queued (measured above 40 s on a closed port); it now completes, logs
  `REALTIME_PUBSUB_UNAVAILABLE` once, and the instance reports itself unready until a connection
  succeeds. The state follows the connection for the life of the process: a drop makes it unready
  again, logged once per outage rather than once per retry, and it is ready only once the SUBSCRIBE
  is confirmed, whether or not the client has `autoResubscribe` on.
  The subscriber client no longer relies on ioredis replaying its subscription after a reconnect:
  that replay had no handler for a refusal, so a re-subscribe the server refused (an ACL changed
  while the instance ran) surfaced as an unhandled rejection that can end the Node process. The
  library now sends its own `SUBSCRIBE` on every reconnect and reports a refusal in the log.

#### Apply to a derived backend

Await `disconnect()` and handle its rejection where you revoke a connection: a rejection means the
connection may still be connected, so retry or alert. A caller that ignored the returned promise now
risks an unhandled rejection. `joinRoom` and `leaveRoom` can reject the same way, and are local to the
instance that holds the connection. `REALTIME_ERROR_CODES` gains `TRANSPORT_UNAVAILABLE`.

With `transport: 'sse'`, `emitToUser` can now reject, with `REALTIME_TRANSPORT_UNAVAILABLE`, when an
offline queue is configured, the user is offline on this instance, the queue could not keep the event
and no other instance can have delivered it. Count `onDeliveryFailure` (new, optional, nothing to implement) to see
the publishes and queue writes that failed without failing the call.

A Redis that refuses the pub/sub subscription (a wrong password, a missing permission) now fails
the application's boot instead of logging and continuing, so a misconfigured credential or ACL
surfaces at startup. A Redis that is only unreachable no longer hangs the boot: the instance boots
unready and subscribes when a connection succeeds. Wire `isPubSubReady()` into the readiness probe
so an instance that is up but cannot hear the others (Redis unreachable, or the subscriber
connection dropped) is taken out of rotation; see the README. A custom `IRealtimePubSub` needs no
change: `isSubscribed` is optional, and a bus without it counts as subscribed.

### Added

- `IConnectionLifecycleHooks.onDeliveryFailure(failure)`, with the exported `DeliveryFailure` type
  (`code`, `op`, `error`), called when a delivery path fails but the call that used it still
  resolves.
- `RealtimeService.isPubSubReady()`, for a readiness probe: false while the instance does not hear
  the other instances. `RedisRealtimePubSub.isSubscribed()` is the state behind it, and
  `IRealtimePubSub.isSubscribed?()` lets a custom bus report its own.

### Internal

- The `internal` and `websocket` bundle budgets in `pnpm size` are raised to fit the revocation that
  rejects when it cannot reach its connection, the report of a delivery path that failed and the
  subscriber's lifecycle state, a boot that ends when the server closes the connection without an
  error, and per-connection retirement: the `internal` budget goes from 15,900 B to 18,250 B for a
  measured 18,232 B (15,868 B in 1.2.6) and the `websocket` budget from 7,000 B to 7,550 B for a
  measured 7,477 B.
- The workflow jobs that check out the repository and then run its scripts no longer keep the job's
  token in the git configuration: `persist-credentials: false` on the checkout wherever no later
  step pushes or tags.

## [1.2.6] - 2026-11-01

### Fixed

- **The SSE client address no longer comes from the leftmost `X-Forwarded-For` entry.** The
  connection context's `ip` and the `ip` the hooks receive were the first raw entry of that header,
  which the client writes, with no check that it was an address and no regard for the application's
  `trust proxy` setting: with `trust proxy` set to `'loopback'` and the header `6.6.6.6, 203.0.113.9`,
  Express reported `203.0.113.9` and the library reported `6.6.6.6`. On SSE `ip` is now the address `trust proxy` produced (`req.ip`, else an address from `req.ips`, else the socket
  peer), `''` when no channel carries an address, and a header text that is not an address is never
  returned. WebSocket is unchanged: it reads the handshake's peer address. `SseRequest` gains an
  optional `ips`.

#### Apply to a derived backend

A hook or an authenticator that reads `ip` on SSE may now see a different value, and the new one is
the correct one: the address your `trust proxy` setting vouches for. Behind a reverse proxy, set
`trust proxy` on the application (for example `app.set('trust proxy', 'loopback')`), or `ip` is the
proxy's address, as it already was on WebSocket. An application that never set it sees the socket
peer where it used to see whatever the client put in the header. `ip` is `''` where it used to be
`'unknown'` when nothing carries an address. Compare against `remoteAddress` to tell the proxy from
the client.

### Tests

- **The README Quick Start is executed, not only type-checked.** Specs take the Quick Start
  blocks from the README text, compile them and run them against a real Nest application over HTTP,
  a real Socket.IO handshake and jsdom. A wrong option shape, a route that is never mounted, a missing `eventNames` entry or a
  `main.ts` without the adapter now fails a test instead of reaching a reader. No source or
  published-surface change, so there is nothing to apply.

### Internal

- The Release workflow takes the GitHub Release notes from the tag's CHANGELOG section before the
  gates run, matching the heading literally, and fails the release when the section is missing or
  blank instead of falling back to a pointer. The notes reach `gh release create` through a file.
- `pnpm check:api` compares the built `.d.ts` and `.d.cts` files, comments ignored, with the previous
  published version, and the Release workflow runs it before the publish. It always prints what
  differs. A difference passes only when the CHANGELOG section of the version being released holds
  an "Apply to a derived backend" note (or the older "Apply to a consumer"). There is no override.
- A workflow runs the same check in a pull request that changes `package.json` and moves the version,
  so a release that changes the declarations without the note fails before the tag. A pull request
  that leaves the version alone skips it.
- The `internal` bundle budget in `pnpm size` is raised to fit the client-address validation.

## [1.2.5] - 2026-11-01

### Added

- **`ConnectionAuthContext.remoteAddress`, the TCP peer of the connection.** It is read from the
  socket (`req.socket.remoteAddress` on SSE, `handshake.address` on WebSocket), never from a header,
  so a client cannot forge it. It is distinct from `ip`, which on SSE comes from `X-Forwarded-For`.
  An authenticator behind a reverse proxy can check it against its trusted proxies before believing
  a forwarded header such as `X-Forwarded-Host`. It is `undefined` when the socket reports no
  address. `SseRequest` gains an optional `socket` for it. Nothing existing changes.

### Internal

- The `internal` bundle budget in `pnpm size` is raised to make room for the line that reads the
  peer address.

## [1.2.4] - 2026-11-01

### Fixed

- **A rejection that is not an `Error` no longer makes the handler reporting it fail.** Handlers
  that log a failure read `.message` from whatever was thrown, so a promise that rejected with
  `null` or `undefined`, or with an object that has no prototype, made the `catch` itself throw. In
  a fire-and-forget `.catch` that surfaced as an unhandled rejection. They now describe the reason
  through one function that never throws, and a test fails if a source file goes back to the old
  patterns. The text logged for an `Error` or a string reason is unchanged; a plain object with a
  string `message` now logs that message instead of `[object Object]`.

### Documentation

- A local benchmark (`pnpm benchmark`, in `scripts/benchmark/`, not a CI gate) measures connect
  latency, fan-out latency for 1, 100 and 1000 clients, cross-instance latency through Redis, memory
  per idle connection and Redis connections per instance, and writes its tables as Markdown. The
  first results, with the machine, versions and run-to-run noise, are in
  `docs/benchmark_results_2026-10-31.md`.

## [1.2.3] - 2026-10-31

**Apply before upgrading, if you set `websocket.redisAdapter`:** make sure `@socket.io/redis-adapter`
is installed and that `pubClient` is an ioredis client. 1.2.2 and earlier logged one error and served a single
instance when the adapter could not be installed, and every ESM consumer was in that state, so
WebSocket events did not cross instances. The boot now fails with `REALTIME_REDIS_ADAPTER_FAILED`
instead. A Redis that is merely unreachable does not fail the boot.

### Fixed

- **The WebSocket Redis adapter now installs in the ES module build.** The adapter loaded
  `@socket.io/redis-adapter` with a bare `require`, which an ES module does not have, so for every
  consumer importing the package as ESM the load threw, one error line was logged, and the server
  stayed single-instance: an emit on one instance never reached a client on another. Measured on the
  published bundle with two instances and a real Redis, 0 of 5000 messages crossed; with the adapter
  installed, 5000 of 5000 did. CommonJS consumers were not affected. The ESM bundle now declares a
  `require` that resolves from the package, and still loads when a consumer's bundler re-bundles it
  into CommonJS, where `import.meta.url` is undefined. `pnpm size` fails when an ESM bundle calls a
  `require` it does not declare, and `pnpm check:runtime` boots the packed tarball in ESM, in
  CommonJS and re-bundled into CommonJS, and asserts the adapter registers in each.

- **A WebSocket authenticator that rejects with a value that is not an `Error` no longer leaves the
  socket connected.** The catch in `handleConnection` read `.message` from whatever was thrown, so a
  rejection with `null` or `undefined` made the catch itself throw before `socket.disconnect(true)`
  ran. The reason is now logged as `String(reason)` when it is not an `Error`, and the socket is
  always closed. The handshake middleware already logged it this way; this is the path that runs when
  the gateway is used without it.

## [1.2.2] - 2026-10-31

### Fixed

- **A refused WebSocket handshake is now a `connect_error` with a code, not a connect followed by a
  silent disconnect.** The gateway authenticated in `handleConnection`, after Socket.IO had already
  accepted the socket, so a client saw `connect` and then a bare `disconnect` with no reason it could
  act on. Authentication now runs in a Socket.IO middleware on the handshake: a `null` result fails the
  connection with `connect_error` carrying `err.data.code === 'REALTIME_AUTH_FAILED'`, and an
  authenticator that throws fails it with a generic `Internal Server Error` that never carries the
  thrown message. `authenticate()` still runs once per connection. **Apply note:** a client that
  treated any `disconnect` as a refusal must now listen for `connect_error`
  (`socket.on('connect_error', (err) => err.data?.code)`); `socket.active` is `false` after a
  refusal, so Socket.IO does not reconnect on its own.

- **An SSE refusal that needs I/O is now a `401`, not a `200` followed by an error event.** The
  SSE route returned the handler's promise and authenticated inside it. In an application with an
  interceptor registered (a logging interceptor, for one), Nest commits `200 text/event-stream` from
  a timer on the next macrotask, without waiting for that promise, so an authenticator that awaited
  real I/O (a revocation or session lookup, a Redis read) before refusing lost the race. The client
  had already received a `200`, then got
  `event: error` with `REALTIME_AUTH_FAILED` and a closed stream, which a browser `EventSource`
  treats as reconnectable and retries in a loop, while access logs recorded a `200` for refused
  credentials. A refusal reached synchronously, or within microtasks (no cookie, a forged or expired
  token checked in memory), got its `401`, and so did a late one in an application with no
  interceptor. No connection was ever registered, so nothing was exposed.

  Authentication now runs in a guard on the SSE route, which Nest awaits before the route and before
  the stream starts, and the handler takes its result, so `authenticate()` still runs once per
  connection. A refusal answers `401` (`REALTIME_AUTH_FAILED`), a blank identity `500` and an
  authenticator that throws a `5xx`, whatever the authenticator awaited and whether or not an
  interceptor is registered. Fixes
  [#161](https://github.com/bymaxone/nest-realtime/issues/161).

  The library also no longer lets an error's message reach the stream. Nest 11.2.3 writes the
  message of an error raised after the stream has started into the `event: error` frame, so a
  rejected connection registration, or a failure of another dependency after authentication, could
  put text such as `connect ECONNREFUSED 10.20.30.40:6379` in front of the client. Any error that
  is not an HTTP exception is now logged server-side and sent as a generic 500; an HTTP exception
  an authenticator throws on purpose (a rate limit, say) is sent unchanged.

  **Apply to a consumer.** Nothing to change. If you worked around the old behaviour by treating
  an `error` event with `REALTIME_AUTH_FAILED` on a `200` stream as a refusal, that workaround can go:
  the refusal is now the HTTP status, and `EventSource` stops on a `401` instead of reconnecting.
  A test that asserted `200` for a refused connection should assert `401`.

### Changed

- **`RealtimeGateway` now logs an error at start-up when the WebSocket adapter in use is not
  `RealtimeIoAdapter`.** Under any other adapter the `websocket.*` options (`cors`, `namespace`,
  `pingIntervalMs`, `pingTimeoutMs`, `maxHttpBufferSize`, `redisAdapter`) are dropped, and the
  gateway's own CORS is `origin: false`, so a browser on another origin cannot connect. Nothing
  reported this before. The message names the options it found and the fix,
  `app.useWebSocketAdapter(new RealtimeIoAdapter(app))` in `main.ts`. It is a log line, not an
  exception: an application that works today (same-origin, or Socket.IO's own defaults) keeps booting.

### Internal

- `check:published` compiles every README snippet, not only the ones that import the package, through
  the TypeScript API, so a parse-level elision in one snippet no longer hides the semantic errors in
  the others. The names a snippet uses without declaring them are typed in
  `scripts/readme-prelude.d.ts`, so a wrong method, option or destructured field is an error instead
  of a call on `any`.
- `check:published` accepts a dot inside a relative module name (`./app.module`), which the path
  allowlist added with the relative-import resolution rejected; `..` segments are still refused.
- `check:published` resolves a relative import in a README snippet to the snippet that exports the
  imported names, and fails one that no snippet exports and no stub under `scripts/readme-modules/`
  types, instead of ignoring it as an unresolved module that makes the names `any`.
- `check:published` tolerates a parse error in a README snippet only where the syntax tree shows a
  bare `...` standing in for an argument, element or property, at that exact line and column, so a
  real syntax error elsewhere in a snippet is no longer ignored.

### Documentation

- **README:** a new step 7, "Add WebSocket", shows the complete working setup: the module from
  `/websocket`, `RealtimeIoAdapter` in `main.ts` and `redisAdapter`. The README never named
  `BymaxRealtimeWebSocketModule` or `RealtimeIoAdapter` before, and the sentence saying the Redis
  adapter "is registered for you" omitted that this only happens once the adapter is installed.
  Also documented: the error codes that are reserved and never raised today (`REALTIME_INVALID_TICKET`,
  `REALTIME_PUBSUB_UNAVAILABLE`, `REALTIME_PAYLOAD_TOO_LARGE`, `REALTIME_REPLAY_BUFFER_MISS`) in a
  status table; that presence is a contract and the server must emit `presence:*`; that the server
  ignores events a WebSocket client sends; the per-entry-point option types, `PRESENCE_EVENT_NAMES`
  and `UsePresenceReturn`; and that `RealtimeGateway`, `WebSocketTransport` and `CompositeTransport`
  are exported for the module's own wiring.
  A Troubleshooting entry quotes the start-up error verbatim, and a test fails if the README and the
  message differ.
- `ConnectionRegistry.register` and `unregister` are tagged `@internal`: they are the transports'
  own bookkeeping, and a record added by an application is counted by the lookups (an `sse` one also
  suppresses offline-queue appends for that user) while nothing can be delivered to it.
- **README:** the Testing section no longer states a test count and a mutant count, which had
  drifted from the suite (626 tests in 37 suites against 663 in 43; only the end-to-end count was
  still right). It keeps the claims a gate enforces: 100% coverage and a mutation break threshold
  of 100.

### Tests

- `RealtimeIoAdapter` marks the servers and namespaces it creates, and `RealtimeGateway` checks
  them in `afterInit`; both are covered, with the case of a server from another adapter.
- A spec parses the README and asserts it against the code: the `sse` and `reauthenticationPolicy`
  defaults in the Configuration table, the error codes, the DI tokens and the reserved event names.
  A default or a name that changes in code without the README now fails the suite.

## [1.2.1] - 2026-10-30

**This version carries two behavioural breaks, both under Security below.** An authenticator that
returns a blank identity is now refused, and `tenantResolver` now runs on WebSocket connections.
Neither is a compile error: both change what a running backend does, so read "⚠️ Apply to a consumer"
before upgrading. Each closes a defect in which connections shared one delivery bucket or
were routed to a tenant that differed by transport.

### Security

- **BREAKING (bootstrap-time): a blank identity is refused on both transports.** An authenticator
  that returns `''` or a whitespace-only `userId`, or a present-but-blank `tenantId`, now fails the
  connection. Such a value used to be indexed under an empty key and
  joined to the room `user:` or `tenant:`, so every such connection shared one bucket and received
  every emit addressed to it for the life of the subscription. An absent `tenantId` stays valid and
  means no tenant.
- **BREAKING (behavioural): `tenantResolver` now runs on WebSocket connections**, as it already
  did on SSE. It was read on the SSE path and ignored on the WebSocket path, so one user opening
  both transports could be routed to two different tenants by the same configuration. Resolution
  goes through one shared function, so a connection carries the same tenant on either transport,
  and `null` is treated as absent. An application that relied on the resolver not running on
  WebSocket was relying on that defect.
- Reauthentication now covers WebSocket connections, which previously kept delivering after their
  credentials were revoked. Its failure meta reports the real `conn.transport` instead of a fixed
  `'sse'`.

### Changed

- `tenantResolver` may return `string | undefined | null`. Not breaking: a resolver typed
  `() => string | undefined` still satisfies the wider signature.

### Fixed

- `RealtimeIoAdapter` renamed its private logger field from `logger` to `adapterLogger`, so it cannot
  collide with a member of the same name on the `IoAdapter` base class; behaviour is unchanged.

### ⚠️ Apply to a consumer

- **Blank identity.** Make `authenticate()` return a non-empty `userId`, or `null` to reject the
  connection. Omit `tenantId` for a connection that belongs to no tenant; do not return `''`. A
  blank identity answers HTTP 500 with a generic body on SSE, and is disconnected on WebSocket;
  both log the reason server-side, so a claim that can be blank (an unset `sub` or `tid`) shows up
  as a failed connection rather than a shared room.
- **`tenantResolver` is honoured on WebSocket.** It now also receives WebSocket connections, and
  it gets the `AuthenticationResult`, not the transport. A resolver that was only correct for SSE must be made
  correct for both; returning `undefined` or `null` keeps `auth.tenantId`.
- **Reauthentication disconnects WebSocket connections.** They are now checked as well. If
  `revalidate()` can return `false` for a credential that is still acceptable, those sockets are
  now disconnected on the next cycle.

### Documentation

- The README separates the authenticator path from the `tenantResolver` path for an absent tenant,
  and lists which reserved events the library emits and which it only reserves.
- `IPresenceStorage` is documented as a contract the application drives; the library does not
  emit `presence:*` events.
- `SECURITY.md` states that only the latest minor line (1.2.x) receives security fixes; its table listed
  `0.1.x`.
- The architecture notes, the auth patterns and the nest-auth bridge example match the code: `authorization`
  is dropped on SSE, `auth.token` and `auth.ticket` reach the authenticator through the header and
  `ctx.query.ticket`, `RealtimeIoAdapter` is imported from `/websocket`, and `cacheTtlMs` only matters when it
  exceeds `intervalSeconds`.

## [1.2.0] - 2026-08-29

**Shipped as a minor, and two entries below are strictly speaking breaking.** Both are called
out as such rather than hidden: removing the `service` option is a compile error for anyone who
passed it, and the new required key on `ConnectionEventMeta` is a compile error for anyone who
_constructs_ one. Neither changes runtime behaviour for any working configuration — `service`
was never read by anything, and reading the meta (what a hook does) is unaffected. The precedent
is 1.1.1, which added a required `roles` key to the same type and shipped as a patch. The third
item, the new bootstrap throw on a disagreeing SSE endpoint, replaces a silent misconfiguration
with a loud one: an application it stops was already serving a route other than the one it
configured.

### Changed

- **BREAKING: `forRootAsync` binds the SSE route from the registration, and no longer ignores
  the endpoint it was given.** `sse.endpoint` coming back from the factory could never move the
  route — controllers are registered at decoration time, long before a factory runs — so the
  async path bound a hardcoded `/events` and discarded the configured value in silence. The
  README said the endpoint was "configurable via `sse.endpoint`" with no caveat, so a consumer
  reading it would document, monitor and point a client at a path that did not exist. Found
  while answering a consumer's question about documenting the SSE endpoint in OpenAPI, not by a
  test: every gate was green, because nothing asserted the two agreed.

  The route is now declared as `sseEndpoint` on the `forRootAsync` options, next to `transport`
  and for the same reason. **The default is unchanged (`/events`)**, so an application that
  never set an endpoint keeps the route it has. Two behaviours change:

  - A factory that resolves an `sse.endpoint` disagreeing with the bound route now **throws at
    bootstrap** instead of serving a different path than the one configured. Comparison is on
    the normalized path, since `@Sse()` resolves `events` and `/events` identically.
  - `REALTIME_OPTIONS_TOKEN` now reports the endpoint that was actually bound. It previously
    carried the `forRoot` default (`/realtime/sse`) while the route was `/events`, so anything
    reading the configuration back — a health check, an OpenAPI document — was told the wrong
    path.

  `sseEndpoint` on a `transport: 'websocket'` registration is rejected outright: that mode
  registers no SSE controller, so the option could only be decorative, which is the failure
  this option exists to remove.

- **BREAKING: the `service` module option is removed.** It was accepted by the type and read
  nowhere — no reference in `src/` outside its own declaration, and none in the built bundle.
  The README claimed it "identifies the emitting service in event metadata", but `RealtimeEvent`
  carries `id`, `type` and `data` and nothing else, so passing it was inert. Removed rather than
  implemented: putting a service name on every event changes the wire shape for every client to
  serve a need nobody has stated. Consumers passing it should delete the key; nothing else
  changes, because nothing ever read it.

### Fixed

- **`AuthenticationResult.metadata` now reaches the lifecycle hooks.** The field was documented
  as "free-form extras for downstream code" and was dropped at the boundary: `ConnectionRecord`
  narrowed `originalAuth` to `userId`/`tenantId`/`roles`, and `ConnectionEventMeta` carried no
  bag at all. It is now threaded through all five meta construction sites — SSE and WebSocket
  `onConnect`/`onDisconnect` plus `onReauthenticationFailed` — and handed back to `revalidate`
  as part of the original result.

  This closes a real gap rather than a cosmetic one. `authenticate` sees the request headers but
  has no `connectionId` yet (the connection does not exist), and the hooks have the
  `connectionId` but never see the headers, so there was no way to correlate a connection with
  anything read off the handshake — a `traceparent`, an `x-request-id`. `metadata` is that
  channel, and it is the reason the field was declared in the first place.

  **This adds a required key** to `ConnectionEventMeta`, exactly as `roles` did in 1.1.1.
  Reading the meta is unaffected, which is what a hook does; code that _constructs_ one
  (typically a test fixture) must now supply `metadata`. `undefined` stays meaningful — an
  authenticator that returns no bag is not one that returns an empty object. Like `roles`, it is
  a connect-time snapshot that `revalidate` does not refresh, and the library never reads a key.

### Documentation

- The configuration table dropped the `service` row, and the `forRootAsync` endpoint rule is
  documented where the endpoint is configured rather than left to be discovered at runtime.
- The Contracts section gains a subsection on carrying handshake context into the hooks through
  `metadata`, with the tracing example that motivated it.

### Internal

- `normalizeEndpointPath` extracted from `createSseController`, which is now one of two callers:
  binding an endpoint and comparing two endpoints have to agree on what a path means.

## [1.1.2] - 2026-08-21

**Documentation-only.** `dist/` is byte-identical to `1.1.1` — verified by diffing the
build against the published tarball, not asserted. No runtime path, exported type or
public surface changed. The release exists because `README.md` ships inside the package
and renders on npm, so a documentation defect there reaches consumers exactly as a code
one does.

### Documentation

- **The role-scoped room snippet led a careful consumer into a wall.** It called
  `moduleRef.get()` inside the `onConnect` hook, which is correct and runs — and which
  means unit-testing that hook requires faking `ModuleRef`, in practice
  `as unknown as ModuleRef`. That is a suppression many codebases block outright, so the
  documented pattern was unusable for anyone whose policy forbids the cast. Found by a
  consumer adopting `1.1.1`, not by us; "it works" was true and was the reason it
  survived review.

  The README now also documents the testable shape: give the hook the two capabilities
  it uses, `RoomJoiner` and `ServiceResolver`. `ModuleRef` and `RealtimeService` satisfy
  them structurally, so production passes the real objects and a test passes plain ones,
  with no cast at either end. Both snippets are compiled and executed by
  `realtime.module.documented-patterns.spec.ts` rather than left as prose.

- **Role matching is exact membership.** `roles?.includes('admin')` on a
  `readonly string[]` compares whole elements. Reaching for
  `roles?.some((r) => r.includes('admin'))` — for case-insensitivity, say — admits
  `administrator`, `admin-readonly` and `superadmin`. That failure is an authorization
  leak, it fails open, and it appears only for role names nobody declared.

## [1.1.1] - 2026-08-21

### Added

- **`ConnectionEventMeta` now carries `roles`.** `IConnectionAuthenticator.authenticate` returns
  `roles` and `ConnectionRecord.originalAuth` stores them, but the meta the lifecycle hooks
  receive dropped them — so a host authenticating by role could not act on the role at
  `onConnect`, the one point that has a `connectionId` and knows the connection is new. With no
  role-scoped fan-out and a registry indexed by id, userId and tenantId, a room is the only
  mechanism for "these connections and not those", and a room could not be built on a value that
  never arrived. Threaded through all five meta construction sites — SSE and WebSocket
  `onConnect`/`onDisconnect` plus `onReauthenticationFailed` — because roles present at connect
  and absent at disconnect would be a field that lies by omission exactly when a host cleans up.

  **This adds a required key.** Reading the meta is unaffected, which is what a hook does; code
  that _constructs_ a `ConnectionEventMeta` (typically a test fixture) must now supply `roles`.
  `undefined` stays meaningful for an authenticator that returns none.

  Roles are carried, never interpreted: there is deliberately no `emitToRole`. Indexing a
  fan-out on a role would put the consumer's authorization vocabulary into the transport's API,
  and `meta.roles` is a connect-time snapshot — a role-indexed emit would look authoritative
  while reading state that can go stale. Room-plus-`onConnect` leaves that decision with the
  host. The pattern is documented in the README and covered by an executable test.

### Fixed

- **`forRootAsync` rejected typed factories and abstract `inject` tokens.** `useFactory` was an
  arrow-property signature, so `strictFunctionTypes` checked it contravariantly and rejected
  every factory whose parameters carried real provider types — including the
  `useFactory: (cfg: ConfigService) => ...` example in this module's own JSDoc, which had never
  typechecked for a consumer. Method shorthand is bivariant, which is what makes `inject` usable.
  Separately, `inject` accepted only `Type<unknown>`, a non-abstract constructor type, which
  excluded Nest's own abstract tokens — `ModuleRef` among them, and therefore the documented
  role-scoped room pattern. Widened with `Abstract<unknown>`.

### Documentation

- The README's Rooms section gains a **role-scoped delivery** subsection: how to build a
  role room in `onConnect`, why there is no `emitToRole`, and the snapshot semantics of
  `meta.roles` — a `revalidate` that keeps a connection alive does not refresh it.
- The `[Unreleased]` compare link pointed at `v1.0.5`, left behind when 1.1.0 shipped, so it
  showed the whole 1.1.0 release as unreleased.

### Tests

- The documented role-scoped room pattern is now an executable test rather than prose
  (`realtime.module.documented-patterns.spec.ts`): it boots the module exactly as the README
  shows and asserts both halves — the admin connection reaches `role:admin`, and a `viewer` and
  a roles-`undefined` connection reach nothing. `pnpm typecheck` covers it, so reverting either
  option-type change fails there.

## [1.1.0] - 2026-08-11

### Changed

- **Peer dependency `ioredis` moved to `^6.0.0`** (from `^5.0.0`). The ecosystem migrates to
  ioredis 6 in lockstep because `@bymax-one/nest-queue` now requires it and an app installs a
  single ioredis; ioredis 6 keeps `replyMapping: "legacy"` by default, so reply shapes are
  unchanged and this library — which only takes an injected client — needs no runtime change.
  `ioredis` remains an optional peer.

### Internal

- Stryker gate raised to 100: `thresholds.high`/`low`/`break` are now `100` (the score is already
  100% with 0 survivors), tightening the mutation floor from 95.

## [1.0.6] - 2026-08-06

**Published-artifact change, not a behavioural one.** `dist/` differs from `1.0.5` — this
bundler preserves comments and the source gained mutation-suppression notes — but no runtime
path changed. Measured by building both revisions and diffing the output.

### Documentation

- The mutation badge said **99.27%**; the measured score is **100.00%**.

### Tests

- The SSE stream teardown is pinned: unsubscribing the outer stream leaves the merged subject
  unobserved. RxJS reaches that through the subscriber linkage even without the explicit
  `inner.unsubscribe()`, which the report records — the behaviour is worth pinning whichever way
  it is achieved.

## [1.0.5] - 2026-08-04

### Security

- The Redis credentials are no longer disclosed when the adapters that hold a client are
  serialized. `RedisOfflineQueue` and `RedisRealtimePubSub` kept their ioredis instances
  in TypeScript `private` properties, which are erased at runtime and leave enumerable
  own properties, and an ioredis instance carries `options.password` as a plain field.
  `JSON.stringify`, object spread and `util.inspect` therefore reached the password —
  and, because both adapters are referenced from the module options, so did anything that
  serialized those. Both clients and the lazily created subscriber connection move to
  ECMAScript private fields.

Reading on purpose is unchanged and no public type or export moved.

## [1.0.4] - 2026-08-02

### Fixed

- **The published declarations required `@types/express`, which the package does
  not depend on.** `dist/internal/index.d.ts` imported `Request` and `Response`
  from `express`, so a consumer compiling with `skipLibCheck: false` failed with
  `TS2307: Cannot find module 'express'` on the root and `./websocket` subpaths.
  `express` is not a dependency, nor a peer, nor an optional peer, so there was no
  supported way to satisfy it.

  The SSE endpoint reads three fields from the request — `headers`, `ip`, `query` —
  and does two things to the response: sets the anti-buffering headers, and writes
  the keepalive comment. Those are now described by `SseRequest` and
  `SseResponse`, structural contracts an `express.Request` satisfies without being
  named by it. The same shape is what a Fastify request
  provides, so the endpoint no longer assumes a platform it never required.

  Runtime is unaffected: no bundle ever imported `express`, and the only change to
  the built JavaScript is two JSDoc lines.

### Changed

- **`pnpm check:surface` now also checks what the published declarations import.**
  Every module a `.d.ts` names has to be a declared peer, `./internal` included —
  the root's declarations re-export from it, so an undeclared import there reaches
  the consumer's compiler just the same. `tsc` could not see this (it only checks
  what this repository references) and neither could `attw` (it checks that
  declarations resolve, not what they contain).

## [1.0.3] - 2026-08-02

### Fixed

- **`transport: 'websocket'` and `'both'` could not resolve a single provider.**
  Registering `BymaxRealtimeWebSocketModule` and then injecting anything the
  package root exports — `RealtimeService`, `ConnectionRegistry`, or any of the
  eight injection tokens — failed with `UnknownElementException` at bootstrap.
  SSE through the root module was unaffected.

  Each entry point is a separate bundle, so the services and `Symbol` tokens both
  of them reached by a relative path were copied into each. A copied class is a
  different injection token, and the container held one set while the consumer
  imported the other. The shared runtime now lives in one bundle that both entry
  points import by package specifier, which gives it a single identity in
  CommonJS as well as ESM — code splitting could not, since esbuild splits ESM
  only.

### Added

- **`pnpm check:surface`** compares every name each subpath exports, read from the
  built `.d.ts`, against a checked-in snapshot, and fails on additions as well as
  removals. A type exported for consumers and referenced nowhere internally is
  invisible to `tsc`, to `attw` and to the README snippets, so it can vanish from
  a barrel with every other gate green.

- **`pnpm check:runtime`** packs the tarball, lays it out the way npm would, and
  boots NestJS against it in ESM and in CommonJS, resolving every exported token
  from every transport mode. It runs in `prepublishOnly` and in CI. Every other
  gate reads the source or the type declarations, so a defect in how the entry
  points are bundled was invisible to all of them.

- **`pnpm size` now checks bundle boundaries structurally**: the root and shared
  bundles must contain no static reference to the Socket.IO stack, and the root
  and WebSocket bundles must _import_ the shared runtime rather than inline it.

## [1.0.2] - 2026-08-02

### Fixed

- **The package could not be imported by an SSE application at all.** The root
  entry statically imported `@nestjs/websockets` and `@nestjs/platform-socket.io`,
  both declared **optional** peers. A consumer who installed only the required
  peers — which is what the manifest asks for, and what an application on SSE, the
  default transport, would do — got `ERR_MODULE_NOT_FOUND` on
  `import '@bymax-one/nest-realtime'`, in ESM and CommonJS alike.

  The library already carried an `assertWsPeerDeps()` guard written to produce a
  clear message for exactly this case. It was unreachable: the static import
  failed while the module file was still loading, before any function ran.

### Changed

- **WebSocket moved to its own entry point, `@bymax-one/nest-realtime/websocket`.**
  It exports `BymaxRealtimeWebSocketModule`, which serves `transport: 'websocket'`
  and `'both'`, together with `WebSocketTransport`, `RealtimeGateway`,
  `RealtimeIoAdapter` and `CompositeTransport` — all removed from the package root.

  `BymaxRealtimeModule` at the root now serves `'sse'` only, and nothing reachable
  from it imports the Socket.IO stack. That is what makes "opt-in" true of the
  install and not only of the configuration: an SSE application resolves 22
  packages where it previously needed 45.

  `transport` is narrowed per module rather than validated at runtime, so asking
  the root module for `'websocket'` does not compile. Asking anyway — through a
  cast, or from JavaScript — is refused with an error naming the entry point that
  serves it.

- **The single-instance warning no longer fires for `transport: 'websocket'`.**
  `IRealtimePubSub` is read by the SSE transport and its subscriber and by nothing
  else, so telling a WebSocket-only application to provide one named the wrong
  mechanism — it scales horizontally through `websocket.redisAdapter`. `'sse'` and
  `'both'` still warn.

- **`transport` is required on `forRootAsync`.** It was an optional hint, and
  omitting it took a path that registered every transport and resolved the active
  one at runtime, which booted Socket.IO regardless of the configured mode. That
  path is gone. Providers and controllers are fixed at decoration time, long
  before a factory runs, so the transport has to be declared for the module to
  register the right ones.

- The error raised when an async factory returns nothing now names the method it
  called (`createRealtimeOptions`) instead of describing it.

## [1.0.1] - 2026-08-02

### Fixed

- **The npm package page showed no documentation.** `1.0.0` reached the registry
  with an empty `readme` field, so the page rendered nothing — even though
  `README.md` was present in the tarball all along. Every package here published
  under pnpm 11 has an empty `readme`; every one published under pnpm 10, which
  delegated to the npm CLI, carries it. The same split appears in `_npmVersion`,
  present only on the publishes the npm CLI performed. The release workflow now
  calls `npm publish` directly, and this release is what carries the README to
  the registry.
- **`keywords` were missing from the manifest**, so the package was
  undiscoverable by search on npm. Fourteen added, covering the transports,
  the pub/sub and presence concepts, and the React subpath.

### Removed

- **The Roadmap section of the README.** It described work that is not shipping
  and dates the moment it is written; the issues board is where direction
  belongs. `README.md` ships in the package, so the section was on the npm page
  too.

## [1.0.0] - 2026-08-02

First published release.

### Added

- **Dual-transport architecture** — SSE (default) and WebSocket (opt-in) via the `ITransport` abstraction; `CompositeTransport` for `transport: 'both'` migration mode
- **`RealtimeService`** — unified server-side API: `emitToUser`, `emitToTenant`, `emitToRoom`, `broadcast`, `joinRoom`, `leaveRoom`, `disconnect`; cross-instance variants via `*Local` methods
- **`IConnectionAuthenticator`** — plug-and-play auth contract; the library never imports a concrete auth library (auth inversion); supports cookie HttpOnly, ticket, and bearer patterns
- **`EventReplayBuffer`** — per-user ring buffer for `Last-Event-ID` seamless SSE reconnect
- **`IRealtimePubSub`** — cross-instance pub/sub abstraction; `InMemoryPubSub` default; `RedisRealtimePubSub` reference implementation (requires `ioredis`)
- **`IOfflineQueueStorage`** — events delivered while a user is offline; `RedisOfflineQueue` reference implementation
- **`IPresenceStorage`** — optional online-user tracking
- **Lifecycle hooks** — `onConnect`, `onDisconnect`, `onError`, `onReauthenticationFailed` (fire-and-forget)
- **Re-authentication policy** — periodic credential revalidation with a positive cache
- **Heartbeat keepalive** — `: keepalive` SSE comment line tuned for real-world proxies (Nginx, Cloudflare, AWS ALB)
- **`@socket.io/redis-adapter` integration** — WebSocket horizontal scaling via the `websocket.redisAdapter` option
- **Multi-tenant room conventions** — `user:{id}`, `tenant:{id}`, `resource:{type}:{id}`; auto-join on connect
- **`forRoot` + `forRootAsync`** — synchronous and asynchronous dynamic-module configuration
- **Frontend React subpath (`./react`)** — `useRealtime` (auto-detects SSE vs WebSocket), `useRealtimeConnection`, `usePresence`, `RealtimeProvider`, `useRealtimeContext`
- **`socket.io-client` dynamic import** — kept out of the SSE-only static bundle (SSE-only bundle ≤ 4 KiB brotli)
- **Zero direct dependencies** — everything via peer deps (`rxjs` always required; WebSocket / Redis / React optional)
- **FIFO connection eviction** — exceeding `maxConnectionsPerUser` closes the oldest connection (`REALTIME_TOO_MANY_CONNECTIONS`); the new connection is always admitted

### Security

- **Auth inversion** — the library never imports `@bymax-one/nest-auth`, `@nestjs/jwt`, or any auth concrete; consumers own the auth implementation via `IConnectionAuthenticator`
- **Tenant isolation** — enforced server-side via the room registry; `emitToTenant` and `emitToRoom` scope delivery to the caller-specified room only

- **Peer floors declared above their published advisories.** Ranges drafted for
  this package admitted versions carrying published advisories, and were
  corrected before anything was published — so no released version ever carried
  a permissive range:

  | Peer             | Advisory                                                                                                                                    | Vulnerable                    | Floor      |
  | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------- |
  | `@nestjs/common` | [GHSA-cj7v-w2c7-cp7c](https://github.com/advisories/GHSA-cj7v-w2c7-cp7c) — remote code execution via the `Content-Type` header              | `>= 11.0.0-next.1, < 11.0.16` | `^11.0.16` |
  | `@nestjs/core`   | [GHSA-36xv-jgw5-4q75](https://github.com/advisories/GHSA-36xv-jgw5-4q75) — improper neutralization of special elements in downstream output | `<= 11.1.17`                  | `^11.1.18` |
  | `socket.io`      | [GHSA-25hc-qcg6-38wj](https://github.com/advisories/GHSA-25hc-qcg6-38wj) — an unhandled `error` event crashes the process                   | `>= 3.0.0, < 4.6.2`           | `^4.6.2`   |

  A peer range is a statement about which versions this library supports. A
  floor below a published advisory tells a consumer that a vulnerable install is
  a supported one, and nothing in their tooling contradicts it — the install
  resolves cleanly and silently.

  `@nestjs/platform-socket.io` and `@nestjs/websockets` keep `^11.0.0`: neither
  has a published advisory, and narrowing a range without a cause only costs
  compatibility.

  The `socket.io` floor was found by the scheduled `peer-advisory-drift` check
  rather than by the manual sweep that raised the NestJS floors — that sweep
  asked about NestJS and never put the same question to the other ten peers.

[Unreleased]: https://github.com/bymaxone/nest-realtime/compare/v1.2.35...HEAD
[1.2.35]: https://github.com/bymaxone/nest-realtime/compare/v1.2.34...v1.2.35
[1.2.34]: https://github.com/bymaxone/nest-realtime/compare/v1.2.33...v1.2.34
[1.2.33]: https://github.com/bymaxone/nest-realtime/compare/v1.2.32...v1.2.33
[1.2.32]: https://github.com/bymaxone/nest-realtime/compare/v1.2.31...v1.2.32
[1.2.31]: https://github.com/bymaxone/nest-realtime/compare/v1.2.30...v1.2.31
[1.2.30]: https://github.com/bymaxone/nest-realtime/compare/v1.2.29...v1.2.30
[1.2.29]: https://github.com/bymaxone/nest-realtime/compare/v1.2.28...v1.2.29
[1.2.28]: https://github.com/bymaxone/nest-realtime/compare/v1.2.27...v1.2.28
[1.2.27]: https://github.com/bymaxone/nest-realtime/compare/v1.2.26...v1.2.27
[1.2.26]: https://github.com/bymaxone/nest-realtime/compare/v1.2.25...v1.2.26
[1.2.25]: https://github.com/bymaxone/nest-realtime/compare/v1.2.24...v1.2.25
[1.2.24]: https://github.com/bymaxone/nest-realtime/compare/v1.2.23...v1.2.24
[1.2.23]: https://github.com/bymaxone/nest-realtime/compare/v1.2.22...v1.2.23
[1.2.22]: https://github.com/bymaxone/nest-realtime/compare/v1.2.21...v1.2.22
[1.2.21]: https://github.com/bymaxone/nest-realtime/compare/v1.2.20...v1.2.21
[1.2.20]: https://github.com/bymaxone/nest-realtime/compare/v1.2.19...v1.2.20
[1.2.19]: https://github.com/bymaxone/nest-realtime/compare/v1.2.18...v1.2.19
[1.2.18]: https://github.com/bymaxone/nest-realtime/compare/v1.2.17...v1.2.18
[1.2.17]: https://github.com/bymaxone/nest-realtime/compare/v1.2.16...v1.2.17
[1.2.16]: https://github.com/bymaxone/nest-realtime/compare/v1.2.15...v1.2.16
[1.2.15]: https://github.com/bymaxone/nest-realtime/compare/v1.2.14...v1.2.15
[1.2.14]: https://github.com/bymaxone/nest-realtime/compare/v1.2.13...v1.2.14
[1.2.13]: https://github.com/bymaxone/nest-realtime/compare/v1.2.12...v1.2.13
[1.2.12]: https://github.com/bymaxone/nest-realtime/compare/v1.2.11...v1.2.12
[1.2.11]: https://github.com/bymaxone/nest-realtime/compare/v1.2.10...v1.2.11
[1.2.10]: https://github.com/bymaxone/nest-realtime/compare/v1.2.9...v1.2.10
[1.2.9]: https://github.com/bymaxone/nest-realtime/compare/v1.2.8...v1.2.9
[1.2.8]: https://github.com/bymaxone/nest-realtime/compare/v1.2.7...v1.2.8
[1.2.7]: https://github.com/bymaxone/nest-realtime/compare/v1.2.6...v1.2.7
[1.2.6]: https://github.com/bymaxone/nest-realtime/compare/v1.2.5...v1.2.6
[1.2.5]: https://github.com/bymaxone/nest-realtime/compare/v1.2.4...v1.2.5
[1.2.4]: https://github.com/bymaxone/nest-realtime/compare/v1.2.3...v1.2.4
[1.2.3]: https://github.com/bymaxone/nest-realtime/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/bymaxone/nest-realtime/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/bymaxone/nest-realtime/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/bymaxone/nest-realtime/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/bymaxone/nest-realtime/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/bymaxone/nest-realtime/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/bymaxone/nest-realtime/compare/v1.0.6...v1.1.0
[1.0.6]: https://github.com/bymaxone/nest-realtime/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/bymaxone/nest-realtime/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/bymaxone/nest-realtime/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/bymaxone/nest-realtime/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/bymaxone/nest-realtime/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/bymaxone/nest-realtime/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/bymaxone/nest-realtime/releases/tag/v1.0.0
