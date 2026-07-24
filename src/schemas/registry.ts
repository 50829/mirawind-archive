import bookSchema from "../../docs/schemas/book.schema.json" with { type: "json" };
import documentManifestSchema from "../../docs/schemas/document-manifest.schema.json" with { type: "json" };

export const schemaRegistry = Object.freeze({
  book: bookSchema,
  documentManifest: documentManifestSchema,
});

export type SchemaName = keyof typeof schemaRegistry;

export function getCanonicalSchema(name: SchemaName): object {
  return schemaRegistry[name];
}
