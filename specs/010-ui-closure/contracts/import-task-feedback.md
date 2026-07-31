# Import And Task Feedback

Authenticated management responses for an import or task include:

```ts
interface JobSubject {
  kind: "book" | "import" | "system";
  label: string;
}
```

- `book` uses the current management title.
- `import` uses the cleaned original ZIP display name.
- `system` uses a fixed operation label and contains no imported content.
- Import status also includes `source_name`, using the same private import display name.
- Existing state, phase, progress, error, retry, and cancellation fields remain available.
- Responses remain administrator-only, `private, no-store`, and non-indexable.
- A progress percentage is a UI projection of `completed / total` only when `total > 0`; it is
  not persisted and is omitted for unknown totals.
