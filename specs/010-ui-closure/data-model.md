# Data Model

No persistent data model changes.

The only new request-time value is:

```ts
{
  management_available: boolean;
}
```

It contains no account or library data and is never stored. Book details and management pages
continue to use their existing projections.
