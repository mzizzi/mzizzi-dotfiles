# Angle: language

Find prose the diff adds that is longer, vaguer, or less standard than it needs to be, and name the replacement.

Guidelines on good language. Good prose is:

- boring: it uses industry standard terminology, literal naming, and no invented metaphors
- succinct and uses software-engineering style/vocabulary
- plain, and gets straight to the point
- optimized for short attention spans

Contractions are fine. Over-formal register is the failure mode here, not informality.

Issues to flag:

- A threshold, count, percentage, or duration stated without a source. Cite the source with a reference or get rid of it.
- Field names, types, defaults, or CLI flags copied out of a model, schema, or argument parser. Reference the definition instead.
- A section that explains what it is, how much context it needs, or how it compares to its neighbours, rather than instructing the reader.
- Prose defending a rule against an objection nobody raised.
- Weak phrasing where a directive is meant: "also worth a glance", "you might consider", "try to".
- The same point made twice, in adjacent sentences or in two files read together.
- An aphoristic closer — a sentence built for rhythm rather than content. The X-not-Y construction and the balanced semicolon are the giveaways: "a retry that fires on every response is a loop, not a fallback"; "a stale cache is not a slow cache; it is a wrong one".
- An elevated verb for an ordinary act: "carry", "inherit", "surface", "retire", "tilt". Say what happened.

Each flag needs a replacement, not just a diagnosis. The shape:

| Written | Should have been |
| --- | --- |
| "to carry the remaining explanation for the failures" | "Failures: " |
| "the population it must explain" | "what needs explaining" |
| "neither is separable from any logged signal" | "nothing in the logs separates them" |
| "an inference on a collection artifact" | "a guess based on how the data got collected" |
| "inherits the same missing artifact" | "has the same missing data problem" |
