# Angle: idiomatic python

Find places the diff hand-rolls something the standard library already has a type for, and name the replacement.

What to look for:

- A module-level tuple, list, or set of string literals serving as a closed vocabulary, with values validated against it by a membership test. `enum.StrEnum` keeps that runtime guard and adds a type checker that rejects a bad spelling at the call site.
