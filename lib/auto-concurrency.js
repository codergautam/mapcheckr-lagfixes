// Adaptive concurrency controller (AIMD style).
//
// Starts at the user's `-c` baseline. Watches a rolling window of outcomes:
//   - Network/HTTP error rate above `errorThreshold` -> halve current target,
//     bounded below by `min` (the user's baseline; we never go lower).
//   - Clean run for `increaseEvery` outcomes with error rate under
//     `errorThreshold` -> bump current target by `increaseStep`, capped at
//     `max`.
//
// `record(ok)` is called once per HTTP attempt (a retried request records
// `false` per failed attempt and then `true` once it eventually succeeds).
// The current target is read by runPool on every scheduling decision so
// scale-up takes effect immediately and scale-down naturally drains in-flight
// work.

export class AutoConcurrency {
    constructor({
        initial,
        min            = initial,
        max            = Math.max(initial * 4, 200),
        sampleSize     = 500,
        increaseEvery  = 500,
        increaseStep   = 5,
        errorThreshold = 0.05,
        cooldownMs     = 1500,
    } = {}) {
        this.cur = initial;
        this.min = min;
        this.max = max;
        this.sampleSize = sampleSize;
        this.increaseEvery = increaseEvery;
        this.increaseStep = increaseStep;
        this.errorThreshold = errorThreshold;
        this.cooldownMs = cooldownMs;

        this.window = [];                  // recent outcomes (true=ok, false=err)
        this.sinceAdjust = 0;
        this.lastAdjustAt = 0;
        this.lastEvent = null;             // "up" | "down" | null
    }

    record(ok) {
        this.window.push(ok ? 1 : 0);
        if (this.window.length > this.sampleSize) this.window.shift();
        this.sinceAdjust++;

        if (this.window.length < Math.min(50, this.sampleSize)) return null;
        const now = Date.now();
        if (now - this.lastAdjustAt < this.cooldownMs) return null;

        const errors = this.window.length - this.window.reduce((a, b) => a + b, 0);
        const errorRate = errors / this.window.length;

        if (errorRate > this.errorThreshold && this.cur > this.min) {
            const newCur = Math.max(this.min, Math.floor(this.cur * 0.5));
            if (newCur !== this.cur) {
                this.cur = newCur;
                this._reset(now, "down");
                return this.lastEvent;
            }
        } else if (errorRate <= this.errorThreshold * 0.4
                && this.sinceAdjust >= this.increaseEvery
                && this.cur < this.max) {
            this.cur = Math.min(this.max, this.cur + this.increaseStep);
            this._reset(now, "up");
            return this.lastEvent;
        }
        return null;
    }

    _reset(now, event) {
        this.sinceAdjust = 0;
        this.lastAdjustAt = now;
        this.lastEvent = event;
        // Drop the oldest half of the window so the next decision is based
        // on outcomes after the adjustment, not before.
        this.window.splice(0, Math.floor(this.window.length / 2));
    }

    target() { return this.cur; }
    range()  { return [this.min, this.max]; }
}
