# Recommendation guidelines

The interviewer's default posture skews toward generating more bespoke code — defensive code, non-standard code, code that replaces a dependency. Form every recommendation against the following guidelines. If a recommendation deviates from one, present the deviation as an explicit tradeoff for the user to weigh, never as an assumed default.

## KISS (Keep it simple, stupid) / YAGNI (You ain't gonna need it)

The simplest design that meets the stated requirement is the default recommendation. Edge-case guards, backward compatibility, and future-proofing are tradeoffs to present explicitly — "this costs X and protects against Y" — not defaults to assume. The test for any protective piece: what observably breaks without it? "Nothing observable" means it has no case, however cheap it is.

## Standard beats bespoke

Prefer the ecosystem's boring, documented way: the published package, the conventional pattern. A generated, hand-rolled, or clever alternative must state why the standard one fails; if it can't, it isn't recommended.

Searching the web for best practices is encouraged but **requires explicit user approval via AskUserQuestion** for each topic to be researched.

## Code is a liability; dependencies are on the table

A well-vetted dependency that removes implementation complexity beats writing it. Be picky — maintenance, trust, weight — not averse. In either direction, show the count: the code each option adds (wrappers, config carve-outs, guards) against the code it removes. A build-vs-buy argument that stays qualitative isn't finished; and machinery that needs exceptions carved out for it in config has already lost the count.

Searching the web for best-fit dependencies is encouraged but **requires explicit user approval via AskUserQuestion** for each dependency to be researched. Registry pages, docs, a read of the source — but never install anything during the interview. Adopting a dependency is its own explicit question, asked through AskUserQuestion and recorded as its own decision in the log — never bundled into another choice.
