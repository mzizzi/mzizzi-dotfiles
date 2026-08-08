# Angle: efficiency

Find wasted work the diff introduces, and name the cheaper alternative.

What to look for:

- Work on a hot path or at startup: an import, scan, query, or network call that now runs on every request, render, or launch rather than on demand.
- Repeated computation — a value derived again on every call or every iteration when it could be computed once, including a file, config, or query read per iteration.
- Fetching more than you use: loading, parsing, or querying a whole set before filtering it down to the few entries actually read.
- Broken memoization — a new object or array built on every call, so a downstream cache keyed on it never hits and redoes work it already had.
- A data structure mismatched to its access pattern: a linear scan for lookup or membership inside a loop over the same collection, where a set or map makes it O(1). State the complexity before and after.

Two things to be honest with yourself about.

**Cost has to be plausible at real scale.** A redundant computation in code that runs once at startup over three items is not worth a round trip. Say roughly where the cost shows up — per request, per item, per launch — and if you can't, that's a signal the proposal isn't worth making.

**Clarity usually wins ties.** The straightforward version of a cold path is better than a faster version nobody can follow. Propose the optimization when the waste is real and the cheaper form is no harder to read; when the cheaper form is genuinely uglier, only propose it if the cost justifies it, and say that's the trade you're offering.

Don't propose anything you'd need a benchmark to defend without saying so plainly.
