## Why

Codex reasoning summaries can contain empty HTML comment markers such as `<!-- -->`. Kun currently escapes those markers as visible text inside the thinking panel, exposing transport-format artifacts instead of presenting clean reasoning Markdown.

## What Changes

- Hide HTML comment nodes from reasoning-summary Markdown while retaining the original persisted runtime event text.
- Suppress an incomplete trailing HTML comment opener during streaming so split SSE chunks do not flash `<!--` before the closing chunk arrives.
- Preserve Markdown code spans and fenced code blocks that intentionally contain HTML-comment syntax.
- Add focused coverage for completed, streaming, and code-literal rendering behavior.

## Capabilities

### New Capabilities

- `reasoning-summary-rendering`: Defines safe, stream-aware presentation of model reasoning summaries in the Kun conversation UI.

### Modified Capabilities

None.

## Impact

- Renderer-only changes under `src/renderer/src/components/chat`.
- No changes to Codex authentication, provider routing, request bodies, SSE contracts, or persisted Kun thread data.
- No new runtime dependency is expected.
