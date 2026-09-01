# Angle: organization

Check that a reader who does not know this code can find what the diff adds by its name and its place. Altitude asks how deep a fix sits on the call path; this angle asks whether each module has one clear responsibility and whether the code is laid out the way a reader would look for it.

Read the directory listing first, then each changed file whole, then its callers. Write one sentence for each module the diff touches: what it is responsible for. If the sentence needs "and", or the diff made the sentence longer, that is the finding.

Signals for the reader:

- The name does not match the contents. Applies to a directory, a file, a type, a function, or a field.
- A module has more than one responsibility, or one responsibility is spread over several modules.
- Code lives far from the code that uses it or knows the most about it.
- Every caller has to know the same thing about a callee. The callee should know it instead.
- Something important has no name. Readers and callers handle it as a bare value.

Decide the destination yourself. How the repo already groups, names, and places things beside the changed code decides the shape more than any general rule. Name one location or name and say why a reader would look there.

Writing the proposal:

- List every caller before you write it, by reference lookup rather than a text search. State the count and where they sit; the parent rates effort from that.
- A move or rename touches lines the diff did not add, so the effort is almost always `invasive`. Mark it so and list every file that changes. Do not shrink the proposal to fit inside the diff.
- A move that separates two things with one consumer between them, or a rename from one synonym to another, is churn rather than organization.
