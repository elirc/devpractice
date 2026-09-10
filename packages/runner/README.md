# @devpractice/runner

Bounded execution of learner-written JavaScript and TypeScript for browser
exercises (spec section 7).

## The boundary

Learner source is evaluated **only** by a QuickJS interpreter compiled to
WebAssembly. It never reaches `eval`, `new Function`, a generated module,
dynamic `import()`, or the host realm.

The dedicated Web Worker is an isolation *convenience*. The actual boundary is:

1. the interpreter, and
2. the fact that nothing capable is exposed to it.

The interpreter is given no DOM, no Node APIs, no filesystem, no sockets, no
`fetch`, no storage, no timers and no platform services. The only host
capability installed is bounded `console` capture, plus one adapter that calls
the named entrypoint with copied JSON values.

`apps/web/src/workers/runner.worker.ts` imports the runner and nothing else, so
the worker's module graph contains no API client, session token or CSRF token —
there is no authenticated capability for learner code to reach even in the event
of an interpreter escape.

### What this is not

Per spec 7.1 this is **personal practice, not proctoring**. Browser results are
client-reported: a technically skilled owner can alter what the page sends. The
server records such attempts with `gradingOrigin: 'browser_automated'` and never
treats them as certification.

What the design *does* guarantee is that expected values and the comparison
logic live in trusted host code (`compare.ts`), outside the interpreter, so
learner code cannot overwrite a result object to fake a pass by accident.

## Grading contract

- One self-contained file, one named entrypoint, JSON-serialisable arguments and
  results. No imports in V1.
- Structural JSON equality: array order matters, object key order does not.
  Numbers are exact unless the case declares a `tolerance`.
- `assertInputUnchanged` copies inputs per case and compares them afterwards, so
  a mutating solution fails even when its return value matches.
- Each case gets an independent copy of its inputs.

## TypeScript

`ts-compile.ts` builds a virtual single-file program and runs **syntactic and
semantic** diagnostics before any emit. A type error returns `compile_error` and
never reaches the case runner, so transpiling types away does not satisfy
TypeScript grading (acceptance A08).

The lib chain is ES5 + ES2015–ES2020 + decorators. DOM libs are deliberately
excluded — the interpreter has no DOM, so exercises must not type-check against
one.

Browser builds need the generated bundle:

```
pnpm --filter @devpractice/runner libs:generate
```

This writes `src/generated/lib-bundle.js` (~430 KB of declarations) plus a small
`.d.ts`. It is imported lazily so it never lands in the initial bundle, and the
`.d.ts` split keeps `tsc` fast.

## Limits

Defaults come from `DEFAULT_RUNNER_LIMITS` in `@devpractice/contracts`: 2 s
execution budget, a separate 10 s initialisation budget, 64 KiB source, ≤25
cases, 64 KiB input/output, ≤100 console lines / 16 KiB, 32 MiB interpreter
memory, 512 KiB stack.

Three layers stop a runaway program:

1. the QuickJS interrupt handler (deadline + cooperative cancellation),
2. interpreter memory and stack ceilings, and
3. an outer watchdog in `client.ts` that terminates the worker outright.

The execution deadline starts **after** the trusted prelude, so a slow WASM cold
start does not consume the learner's budget.

## Known limitation

After a stack overflow, QuickJS can abort inside `JS_FreeRuntime`
(`Assertion failed: list_empty(&rt->gc_obj_list)`), which poisons the cached
WASM module for that worker. `RunnerClient` therefore drops the worker after any
`runtime_error` or `timed_out` result, so the next run gets a genuinely clean
interpreter. Tests show the abort is contained and the host stays usable.

## Hosts

- `client.ts` — main thread; owns worker lifecycle, runId matching, watchdog.
  Responses are accepted only from the active worker and a matching `runId`.
- `worker.ts` — the dedicated worker entry.
- `node-runner.ts` — same engine and comparison logic for the content CLI and
  tests, so an authored solution is verified through the contract the learner
  meets.

## Tests

```
pnpm --filter @devpractice/runner test
```

`tests/isolation.test.ts` is the A07/A08 release gate against the real
interpreter. `tests/client.test.ts` covers message discipline (stale responses,
supersession, cancellation) with a fake worker.
