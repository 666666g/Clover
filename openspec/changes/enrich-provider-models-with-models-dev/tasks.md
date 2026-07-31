## 1. Shared Catalog Contract

- [x] 1.1 Define sanitized models.dev catalog request, result, source, modality, and model metadata types in the shared GUI API
- [x] 1.2 Add IPC validation and expose the catalog operation through the main handler and preload bridge

## 2. Main-Process Catalog Service

- [x] 2.1 Implement deterministic Kun profile/base-URL to models.dev provider mapping, including supported regions and subscription enrichment-only mode
- [x] 2.2 Implement bounded models.dev fetching, parsing, six-hour memory caching, ETag refresh, in-flight deduplication, proxy use, and stale fallback
- [x] 2.3 Add unit tests for mapping, sanitization, caching, credential isolation, limits, failures, and stale fallback

## 3. Dual-Source Import

- [x] 3.1 Add source-aware case-insensitive model merging and default-selection helpers
- [x] 3.2 Update provider settings import flow to run both sources, preserve connection-test behavior, and handle independent partial failures
- [x] 3.3 Update the model import dialog with source filters, counts, warnings, metadata badges, and catalog-aware classification

## 4. Profile Enrichment

- [x] 4.1 Map supported catalog metadata into `ModelProviderModelProfileV1` for new imported chat models
- [x] 4.2 Safely fill missing limits on existing profiles while preserving explicit modality, tool, endpoint, alias, response-mode, and reasoning behavior

## 5. Localization and Validation

- [x] 5.1 Add complete import/catalog labels and messages for every shipped locale
- [x] 5.2 Add renderer tests for merge, source filters, partial failures, selection defaults, capability display, and safe profile writes
- [x] 5.3 Run targeted tests, typecheck, lint, full tests/build as appropriate, inspect the final diff, and record validation results
