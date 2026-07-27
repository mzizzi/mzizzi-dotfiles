# Angle: efficiency

Find wasted work the diff introduces, and name the cheaper alternative.

What to look for:

- **Redundant computation** — the same value derived repeatedly inside a loop, or recomputed on every call when it could be built once.
- **Repeated I/O** — a file, config, or query read per iteration or per call rather than once. Watch for the innocuous-looking helper that opens something every time it's invoked.
- **Sequential independent operations** — awaited one at a time when nothing forces the order.
- **Work added to startup or a hot path** — an import, a scan, or a network call that now runs on every request or every launch rather than on demand.
- **Captured environments on long-lived objects** — an object built from a closure keeps its entire enclosing scope alive for as long as the object lives. When that scope holds a large buffer, a response body, or a whole config tree, this is a leak that profilers rarely attribute correctly. Prefer a struct or class that copies only the fields it needs.
- **Accidental quadratic behavior** — a lookup inside a loop over the same collection, where a set or map built once would do.

Two things to be honest with yourself about.

**Cost has to be plausible at real scale.** A redundant computation in code that runs once at startup over three items is not worth a round trip. Say roughly where the cost shows up — per request, per item, per launch — and if you can't, that's a signal the proposal isn't worth making.

**Clarity usually wins ties.** The straightforward version of a cold path is better than a faster version nobody can follow. Propose the optimization when the waste is real and the cheaper form is no harder to read; when the cheaper form is genuinely uglier, only propose it if the cost justifies it, and say that's the trade you're offering.

Don't propose anything you'd need a benchmark to defend without saying so plainly.
