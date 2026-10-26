import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WaitGroupTimer, defaultClock } from '../src/index.js';

/**
 * Deterministic fake clock. Returns `now` and lets the test advance it.
 */
class FakeClock {
  constructor(start = 0) {
    this.now = start;
  }
  tick(ms) {
    this.now += ms;
  }
}

test('tracks a single operation that finishes within timeout', () => {
  const clock = new FakeClock(1000);
  const wgt = new WaitGroupTimer({ clock: () => clock.now });
  wgt.track('read-db', 50);
  clock.tick(40);
  const report = wgt.report();
  assert.equal(report.total, 1);
  assert.equal(report.completed.length, 1);
  assert.equal(report.timedOut.length, 0);
  assert.equal(report.completed[0].id, 'read-db');
  assert.equal(report.completed[0].started, 1000);
  assert.equal(report.completed[0].timeout, 50);
  assert.equal(report.completed[0].ended, 1040);
  assert.equal(report.completed[0].elapsed, 40);
  assert.equal(report.completed[0].timedOut, false);
});

test('tracks a single operation that exceeds timeout', () => {
  const clock = new FakeClock(2000);
  const wgt = new WaitGroupTimer({ clock: () => clock.now });
  wgt.track('call-api', 100);
  clock.tick(150);
  const report = wgt.report();
  assert.equal(report.timedOut.length, 1);
  assert.equal(report.completed.length, 0);
  const r = report.timedOut[0];
  assert.equal(r.id, 'call-api');
  assert.equal(r.started, 2000);
  assert.equal(r.timeout, 100);
  assert.equal(r.ended, 2150);
  assert.equal(r.elapsed, 150);
  assert.equal(r.timedOut, true);
});

test('operation finishing exactly at deadline is not timed out', () => {
  const clock = new FakeClock(500);
  const wgt = new WaitGroupTimer({ clock: () => clock.now });
  wgt.track('exact', 100);
  clock.tick(100);
  const report = wgt.report();
  assert.equal(report.completed.length, 1);
  assert.equal(report.timedOut.length, 0);
  assert.equal(report.completed[0].elapsed, 100);
  assert.equal(report.completed[0].timedOut, false);
});

test('mixed operations split correctly between completed and timedOut', () => {
  const clock = new FakeClock(0);
  const wgt = new WaitGroupTimer({ clock: () => clock.now });
  wgt.track('fast', 10);   // 0..10
  clock.tick(5);            // 5
  wgt.track('med', 10);     // 5..15
  clock.tick(5);            // 10
  wgt.track('slow', 5);    // 10..15
  clock.tick(5);            // 15
  const report = wgt.report();
  // At t=15: fast elapsed=15 (timeout 10) -> timedOut
  //         med  elapsed=10 (timeout 10) -> completed
  //         slow elapsed=5  (timeout 5)  -> completed
  assert.equal(report.total, 3);
  assert.equal(report.completed.length, 2);
  assert.equal(report.timedOut.length, 1);
  assert.deepEqual(report.completed.map((r) => r.id), ['med', 'slow']);
  assert.equal(report.timedOut[0].id, 'fast');
});

test('untrack removes an operation so it does not appear in report', () => {
  const clock = new FakeClock(0);
  const wgt = new WaitGroupTimer({ clock: () => clock.now });
  wgt.track('a', 50);
  wgt.track('b', 50);
  wgt.untrack('a');
  assert.equal(wgt.size, 1);
  const report = wgt.report();
  assert.equal(report.total, 1);
  assert.equal(report.completed[0].id, 'b');
});

test('untrack on unknown id throws', () => {
  const wgt = new WaitGroupTimer({ clock: () => 0 });
  assert.throws(() => wgt.untrack('nope'), /id not tracked: nope/);
});

test('clear empties all tracked operations', () => {
  const wgt = new WaitGroupTimer({ clock: () => 0 });
  wgt.track('a', 1);
  wgt.track('b', 2);
  wgt.clear();
  assert.equal(wgt.size, 0);
  const report = wgt.report();
  assert.equal(report.total, 0);
  assert.equal(report.completed.length, 0);
  assert.equal(report.timedOut.length, 0);
});

test('track rejects duplicate id', () => {
  const wgt = new WaitGroupTimer({ clock: () => 0 });
  wgt.track('dup', 10);
  assert.throws(() => wgt.track('dup', 20), /id already tracked: dup/);
});

test('track rejects empty-string id', () => {
  const wgt = new WaitGroupTimer({ clock: () => 0 });
  assert.throws(() => wgt.track('', 10), /id must be a non-empty string/);
});

test('track rejects non-positive timeout', () => {
  const wgt = new WaitGroupTimer({ clock: () => 0 });
  assert.throws(() => wgt.track('a', 0), /timeout must be a positive finite number/);
  assert.throws(() => wgt.track('a', -5), /timeout must be a positive finite number/);
});

test('track rejects NaN and Infinity timeout', () => {
  const wgt = new WaitGroupTimer({ clock: () => 0 });
  assert.throws(() => wgt.track('a', NaN), /timeout must be a positive finite number/);
  assert.throws(() => wgt.track('a', Infinity), /timeout must be a positive finite number/);
});

test('track rejects non-string id', () => {
  const wgt = new WaitGroupTimer({ clock: () => 0 });
  assert.throws(() => wgt.track(42, 10), /id must be a non-empty string/);
  assert.throws(() => wgt.track(null, 10), /id must be a non-empty string/);
});

test('constructor rejects non-function clock', () => {
  assert.throws(() => new WaitGroupTimer({ clock: 'not-a-fn' }), /clock must be a function/);
});

test('defaultClock returns a finite number', () => {
  const v = defaultClock();
  assert.equal(typeof v, 'number');
  assert.ok(Number.isFinite(v));
});

test('report with no operations returns empty arrays', () => {
  const wgt = new WaitGroupTimer({ clock: () => 100 });
  const report = wgt.report();
  assert.equal(report.total, 0);
  assert.deepEqual(report.completed, []);
  assert.deepEqual(report.timedOut, []);
});

test('report snapshot uses clock at call time for all entries', () => {
  const clock = new FakeClock(100);
  const wgt = new WaitGroupTimer({ clock: () => clock.now });
  wgt.track('a', 10);
  clock.tick(5);
  wgt.track('b', 10);
  clock.tick(20); // now 125
  const report = wgt.report();
  // Both entries see ended=125 (single snapshot), not their own "now".
  // At t=125: a elapsed=25 (timeout 10) -> timedOut
  //           b elapsed=20 (timeout 10) -> timedOut
  assert.equal(report.timedOut.length, 2);
  assert.equal(report.completed.length, 0);
  assert.equal(report.timedOut[0].ended, 125);
  assert.equal(report.timedOut[1].ended, 125);
  assert.equal(report.timedOut[0].id, 'a');
  assert.equal(report.timedOut[0].elapsed, 25);
  assert.equal(report.timedOut[1].id, 'b');
  assert.equal(report.timedOut[1].elapsed, 20);
});
