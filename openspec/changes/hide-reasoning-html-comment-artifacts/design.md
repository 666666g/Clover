## Context

Kun persists Codex reasoning-summary deltas as `assistant_reasoning` text and renders them through the shared `AssistantMarkdown`/Streamdown path. Streamdown intentionally converts raw HTML Markdown nodes into visible text when the renderer supplies its hardened custom plugin list, so an upstream HTML comment such as `<!-- -->` becomes visible. The comment may arrive incomplete during streaming, while code spans and fenced code blocks can legitimately contain the same characters.

## Goals / Non-Goals

**Goals:**

- Hide complete and incomplete HTML comment nodes in reasoning-summary presentation.
- Preserve raw persisted events and all provider/runtime protocol behavior.
- Preserve comment syntax when it is Markdown code rather than an HTML node.
- Cover settled and streaming-shaped inputs with focused renderer tests.

**Non-Goals:**

- Render arbitrary model-supplied raw HTML.
- Rewrite existing thread JSONL data.
- Change reasoning effort, summary generation, or Codex Responses requests.

## Decisions

### 1. Remove comment nodes at the Markdown AST boundary

Add a small remark transform that removes only `html` nodes whose value begins with `<!--`. Apply it through an explicit reasoning-only option on the shared Markdown component. Remark already classifies both a completed `<!-- -->` and an incomplete trailing `<!--` as HTML nodes, while inline code and fenced code remain `inlineCode`/`code` nodes and are preserved.

A text-level regular expression was rejected because it would also remove examples inside code spans or fenced blocks. Enabling `rehype-raw` was rejected because it would broaden raw HTML rendering for model output when the requirement is only to hide comments.

### 2. Keep cleanup presentation-only

The runtime mapper, event recorder, and persisted message remain unchanged. This retains exact upstream evidence for diagnostics and prevents display policy from mutating conversation history.

### 3. Opt in only for reasoning summaries

`AssistantMarkdown` and `StreamdownAssistant` receive a boolean option used by the reasoning rows. Normal assistant answers keep their current behavior, minimizing the scope of the rendering change.

## Risks / Trade-offs

- [A malformed comment is hidden while streaming] -> This matches browser/Markdown comment semantics and prevents partial transport artifacts from flashing.
- [The lazy Markdown fallback cannot apply an AST transform] -> Suppress comment-shaped fragments in the reasoning fallback while the renderer chunk loads; the full renderer remains the source of final presentation.
- [Future reasoning HTML uses non-comment tags] -> Leave it visible as escaped text until a separate product requirement defines safe handling.

## Migration Plan

Ship as a renderer-only change with no data migration. Rollback removes the reasoning-only plugin option; persisted reasoning remains intact throughout.

## Open Questions

None.
