/**
 * Core implementation for tracking concurrent operation deadlines.
 *
 * The timer does not schedule real work. It only records when each operation
 * started and how long it was given, then reports which operations beat their
 * deadline and which exceeded it. This makes the timer trivially testable:
 * inject a fake clock, advance time explicitly, never touch the wall clock.
 */

/**
 * Default clock: returns the number of milliseconds since the Unix epoch.
 *
 * Used only when the caller does not inject one. Production code uses this;
 * tests inject a controllable clock so assertions stay deterministic.
 *
 * @returns {number} Milliseconds since epoch.
 */
export function defaultClock() {
  return Date.now();
}

/**
 * Result for a single tracked operation.
 *
 * @typedef {Object} OperationResult
 * @property {string} id       The id passed to {@link WaitGroupTimer#track}.
 * @property {number}  started Clock value (ms) when the operation was tracked.
 * @property {number}  timeout The timeout (ms) assigned at track time.
 * @property {number}  ended   Clock value (ms) at report time.
 * @property {number}  elapsed ended - started, in ms.
 * @property {boolean} timedOut true if elapsed > timeout.
 */

/**
 * Overall report for all tracked operations.
 *
 * @typedef {Object} WaitGroupReport
 * @property {OperationResult[]} completed Operations that finished within timeout.
 * @property {OperationResult[]} timedOut  Operations that exceeded their timeout.
 * @property {number} total                   completed.length + timedOut.length.
 */

export class WaitGroupTimer {
  /**
   * @param {object}   [opts]
   * @param {function} [opts.clock] Function returning current time in ms.
   */
  constructor({ clock = defaultClock } = {}) {
    if (typeof clock !== 'function') {
      throw new TypeError('clock must be a function');
    }
    this._clock = clock;
    /** @type {Map<string, {started: number, timeout: number}>} */
    this._entries = new Map();
  }

  /**
   * Track a new operation.
   *
   * @param {string} id      Stable identifier for the operation.
   * @param {number} timeout Timeout in ms (positive). Deadline is started + timeout.
   * @throws {TypeError}  If id is not a non-empty string or timeout is not a positive number.
   * @throws {Error}      If id is already tracked (double-track is almost always a bug).
   */
  track(id, timeout) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('id must be a non-empty string');
    }
    if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) {
      throw new TypeError('timeout must be a positive finite number');
    }
    if (this._entries.has(id)) {
      throw new Error(`id already tracked: ${id}`);
    }
    this._entries.set(id, { started: this._clock(), timeout });
  }

  /**
   * Remove an operation early (e.g. it succeeded).
   *
   * @param {string} id
   * @throws {Error} If id is not currently tracked.
   */
  untrack(id) {
    if (!this._entries.has(id)) {
      throw new Error(`id not tracked: ${id}`);
    }
    this._entries.delete(id);
  }

  /**
   * Clear all tracked operations.
   */
  clear() {
    this._entries.clear();
  }

  /**
   * Number of currently tracked operations.
   *
   * @returns {number}
   */
  get size() {
    return this._entries.size;
  }

  /**
   * Build a report for all currently tracked operations.
   *
   * The deadline is inclusive: an operation that finishes exactly at
   * started + timeout is NOT timed out. Only strictly-greater elapsed time
   * counts as a timeout. This avoids off-by-one arguments about "exactly on
   * time" — exactly on time is on time.
   *
   * Operations are returned in insertion order (Map preserves it), so the
   * report is deterministic for a given sequence of track calls.
   *
   * @returns {WaitGroupReport}
   */
  report() {
    const ended = this._clock();
    const completed = [];
    const timedOut = [];
    for (const [id, entry] of this._entries) {
      const elapsed = ended - entry.started;
      const result = {
        id,
        started: entry.started,
        timeout: entry.timeout,
        ended,
        elapsed,
        timedOut: elapsed > entry.timeout,
      };
      if (result.timedOut) {
        timedOut.push(result);
      } else {
        completed.push(result);
      }
    }
    return { completed, timedOut, total: this._entries.size };
  }
}
