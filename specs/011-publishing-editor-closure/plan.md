# Implementation Plan: Publishing Editor Closure

**Branch**: `main` | **Date**: 2026-07-31 | **Spec**: [spec.md](spec.md)

## Summary

Replace the v3 draft model with one active-document pipeline, rich heading presentation, immutable block
editing, corrected ReaderShell navigation/rendering, and separate metadata/publication/access management.

## Technical Context

**Stack**: TypeScript 6, Astro 7, React 19, SQLite WAL, local filesystem, worker process  
**Libraries**: unified/remark/rehype, KaTeX 0.18.1, Shiki 4.3.1, Mermaid 11.16.0  
**Transition**: new single database baseline; book v4, manifest/version v3, projection v2  
**Evidence**: focused Vitest/Playwright, fifteen reference-v2 books, representative performance and p95 read

## Constitution Check

- Markdown plus v4 `book.yaml` and bound assets remain authoritative; all outputs are rebuildable.
- Candidate construction remains off request paths; publication only atomically promotes a ready version.
- Existing archive, authorization, hidden-404, cache, cancellation and permanent deletion boundaries remain.
- No new service, database, queue, router or state store is introduced. **Result: PASS.**

## Implementation

1. Replace source/config/storage identities and introduce immutable edit revisions with reusable assets.
2. Refactor printed contents into typed stages and structure into immutable hierarchy/boundary/TOC/page passes.
3. Compile one rich heading label and repair prose, math, code, Mermaid, TOC, outline and focus behavior.
4. Add block editing, actionable diagnostics, metadata/cover page, separate access and management links.
5. Delete superseded runtime paths, run focused then final evidence, reset local data and converge.

## Architecture

Publishing remains `core -> application <- adapters`; Reader and Catalog are accessed through application
public surfaces. Entrypoints and composition perform adapter wiring. All internal imports use `@/`.
