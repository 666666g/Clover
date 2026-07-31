## 1. Model Stream Budget

- [x] 1.1 Replace fragment-count rejection with periodic bounded argument-part compaction while preserving exact reconstruction and byte accounting.
- [x] 1.2 Raise the finite default frame work budget and add safe resource-limit context for response, frame, pending argument, and tool counters.
- [x] 1.3 Add Chat Completions, Responses, and budget-unit regressions for more than 1,024 fragments, compaction, byte rejection, and diagnostics.

## 2. Design Tool Contracts

- [x] 2.1 Add shared structural-budget validation for Design mutation arguments with serialized-size, node-count, and nesting-depth enforcement.
- [x] 2.2 Add schema/runtime operation limits and incremental batch guidance to `design_update_shapes`.
- [x] 2.3 Tighten `design_svg_edit` operation limits, enforce recursive element complexity, and add incremental revision-safe batch guidance.
- [x] 2.4 Add Design canvas and SVG tests for accepted reasonable batches and rejected oversized, over-deep, and over-complex calls.

## 3. Verification

- [x] 3.1 Run focused model-stream and Design tool test suites.
- [x] 3.2 Run Kun build, repository typecheck, and diff hygiene checks; distinguish any unrelated baseline failures.

## 4. Native Stream Processing

- [x] 4.1 Coalesce consecutive assistant text/reasoning deltas before durable recording and flush at byte/time, ordering, abort, error, and terminal boundaries.
- [x] 4.2 Replace full-buffer SSE delimiter rescanning with incremental boundary detection while preserving LF/CRLF behavior and resource limits.
- [x] 4.3 Add native stream regressions for exact coalesced content/order and bounded work on many unterminated small reads.

## 5. Cross-Provider Budgets

- [x] 5.1 Add cumulative event, byte, output, and tool-call budgets plus upstream cancellation to extension model-provider streams.
- [x] 5.2 Apply native max-turn, output/event, and tool-call ceilings to delegated Claude Agent SDK turns and clean completed tool bookkeeping.
- [x] 5.3 Stream and bound extension-agent persisted replay plus live-during-replay buffering by count and bytes.
- [x] 5.4 Add extension-provider, Agent SDK, and extension replay overflow regression tests.

## 6. Bounded Diagnostics And Accumulators

- [x] 6.1 Bound LLM debug request/output capture per round and globally, use block accumulators, and expose truncation metadata.
- [x] 6.2 Replace repeated whole-argument compaction with fixed blocks joined once at completion.
- [x] 6.3 Add debug retention/truncation and argument-block reconstruction tests.

## 7. Final Verification And Commit

- [x] 7.1 Run all focused native, extension, SDK, debug, and design regression suites.
- [x] 7.2 Run full Kun tests, Kun build, repository typecheck, OpenSpec validation, and diff hygiene; classify unrelated baseline failures.
- [x] 7.3 Audit every requirement, stage only owned files, and create one Angular-style local commit.
