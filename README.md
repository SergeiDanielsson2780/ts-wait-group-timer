# ts-wait-group-timer

Tracks multiple concurrent operation timeouts and reports which operations completed versus which exceeded their deadline.

```js
import { WaitGroupTimer } from 'ts-wait-group-timer';

const wgt = new WaitGroupTimer(); // uses Date.now() by default
wgt.track('fetch-users', 5000);
wgt.track('fetch-orders', 3000);

// ...later, when you want a status snapshot:
const report = wgt.report();
console.log(report.completed); // [{ id, started, timeout, ended, elapsed, timedOut: false }, ...]
console.log(report.timedOut);  // [{ id, started, timeout, ended, elapsed, timedOut: true }, ...]
console.log(report.total);     // number of tracked operations
```

For deterministic tests, inject a fake clock:

```js
let now = 1000;
const wgt = new WaitGroupTimer({ clock: () => now });
wgt.track('job', 50);
now += 60;
const report = wgt.report();
// report.timedOut[0].id === 'job'
```

## Why this exists

When you fan out N concurrent operations each with its own deadline, you need a single object that remembers when each operation started and how long it was given. Without one, you end up with ad-hoc `setTimeout` bookkeeping scattered across call sites, and no way to ask "which of these are past their deadline right now?"

This library is that object. It records start time and timeout per operation, and on demand produces a report splitting tracked operations into `completed` (elapsed <= timeout) and `timedOut` (elapsed > timeout).

The trade-off: this library does **not** schedule the operations, does **not** cancel them, and does **not** fire callbacks. It only tracks and reports. If you want automatic cancellation or alerting on timeout, layer that on top — the report gives you the ids and the numbers to act on.

## Edge case worth knowing

The deadline is **inclusive**: an operation whose elapsed time equals its timeout exactly is counted as `completed`, not `timedOut`. If your timeout is 100ms and `report()` is called at elapsed=100ms, the operation is on time. Only elapsed strictly greater than timeout counts as a timeout. This removes off-by-one ambiguity at the boundary.

Re-tracking the same id throws — double-tracking is almost always a bug, so it fails loudly. Call `untrack(id)` first if you genuinely want to re-add an id.
