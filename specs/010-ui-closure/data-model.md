# Data Model

`imports` adds one private display field:

```ts
{
  original_name: string; // cleaned basename, 1-255 characters
}
```

It identifies a queued upload before a book title exists. It is not a path, book title,
publication field, or public value. The current clean baseline is updated directly; no parallel
schema or runtime compatibility branch is retained.

The only new request-time value is:

```ts
{
  management_available: boolean;
}
```

It contains no account or library data and is never stored. Book details continue to use their
existing projections. Private import and task projections add a bounded source label derived
from the book title or import display name.
