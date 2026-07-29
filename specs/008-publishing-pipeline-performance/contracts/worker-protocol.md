# Worker Protocol Contract

The protocol version advances with the clean switch. Parent-to-child run messages are a discriminated
union by job kind; `BuildCandidateCommand` has no fields for import analysis, draft preparation,
verification, reconciliation or reclamation.

## Build Candidate Messages

```json
{
  "type": "run",
  "protocolVersion": 3,
  "input": {
    "kind": "build_candidate",
    "jobId": "job_opaque",
    "candidateId": "candidate_opaque",
    "versionId": "ver_opaque",
    "bookId": 1,
    "sourceId": "src_opaque",
    "configRevision": 2,
    "capturedCurrentVersionId": null,
    "sourceRootRelativePath": "books/1/sources/src_opaque",
    "configRelativePath": "books/1/configs/2/book.yaml",
    "compilerIdentity": "compiler-v5",
    "rendererIdentity": "semantic-html-v5-katex-0.18.1",
    "previewIdentity": "draft-preview-v5",
    "readerIdentity": "mirawind-reader-v2-tailwind-4.3.3"
  }
}
```

Progress phases are the closed `build_candidate` subset and preserve the existing bounded progress
object. Child progress is emitted on phase change or at most once per 250 ms.

Successful result:

```json
{
  "type": "result",
  "protocolVersion": 3,
  "jobId": "job_opaque",
  "ok": true,
  "result": {
    "kind": "candidate_build_artifact",
    "candidateId": "candidate_opaque",
    "versionId": "ver_opaque",
    "artifactRootRelativePath": "books/1/versions/ver_opaque",
    "semanticDigest": "sha256-hex",
    "manifestSha256": "sha256-hex",
    "versionMarkerSha256": "sha256-hex",
    "compilerIdentity": "compiler-v5",
    "rendererIdentity": "semantic-html-v5-katex-0.18.1",
    "previewIdentity": "draft-preview-v5",
    "readerIdentity": "mirawind-reader-v2-tailwind-4.3.3",
    "pageCount": 500,
    "resourceCount": 120,
    "searchRowCount": 12000,
    "diagnosticCount": 4,
    "blockingDiagnosticCount": 0
  }
}
```

Unknown fields, old protocol versions, old job kinds and unsafe/unbounded values are rejected. Failure
messages retain only safe code/class and the last persisted phase/progress; they contain no content,
title, original filename or raw path.
