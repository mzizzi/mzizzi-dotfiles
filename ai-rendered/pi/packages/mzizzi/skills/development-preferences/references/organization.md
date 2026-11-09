# Organization

Each module has one responsibility, and a reader who does not know the code can find it by its name and its place.

Read the directory listing first, then each module you touch whole, then its callers. Write one sentence per module: what it is responsible for. If the sentence needs "and", or your change makes it longer, the layout is wrong.

Signals for the reader:

- The name does not match the contents. Applies to a directory, a file, a type, a function, or a field.
- A module has more than one responsibility, or one responsibility is spread over several modules.
- Code lives far from the code that uses it or knows the most about it.
- Every caller has to know the same thing about a callee. The callee should know it instead.
- A directory or package accumulates large numbers of files with no logical grouping or rationale.

Decide the destination yourself along with a 1-2 sentence rationale. Name one location or name and say why the proposed structure is more logical or correct.

Writing the proposal:

- List every caller before you write it, by reference lookup rather than a text search. State the count and where they sit; the parent rates effort from that.
- A move or rename touches lines the diff did not add, so the effort is almost always `invasive`. Mark it so and list every file that changes. Do not shrink the proposal to fit inside the diff.
- A move that separates two things with one consumer between them, or a rename from one synonym to another, is churn rather than organization.
