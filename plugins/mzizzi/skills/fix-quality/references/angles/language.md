# Angle: language

Find prose the diff adds that is longer, vaguer, or less standard than it needs to be, and name the replacement.

Guidelines on good language. Good prose is:

- boring: it uses industry standard terminology, literal naming, and no invented metaphors
- succinct and uses software-engineering style/vocabulary
- not colorful and gets straight to the point in the most robotic way possible
- optimized for short attention spans

Issues to flag:

- A threshold, count, percentage, or duration stated without a source. Cite the source with a reference or get rid of it.
- Field names, types, defaults, or CLI flags copied out of a model, schema, or argument parser. Reference the definition instead.
- A section that explains what it is, how much context it needs, or how it compares to its neighbours, rather than instructing the reader.
- Prose defending a rule against an objection nobody raised.
- Weak phrasing where a directive is meant: "also worth a glance", "you might consider", "try to".
- The same point made twice, in adjacent sentences or in two files read together.
