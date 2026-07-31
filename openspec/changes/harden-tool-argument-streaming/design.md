## Context

Kun parses untrusted provider SSE into model chunks before the agent loop can execute a tool. The parser already caps response and argument bytes, but it also rejects a single tool argument after 1,024 non-empty deltas and retains every delta in an array until completion. Provider chunk granularity is not correlated with payload size, making the fragment ceiling both an unreliable security boundary and a source of false failures for Design operations.

Design tools compound the problem: `design_update_shapes` accepts an unbounded operation array, while `design_svg_edit` permits 200 operations and recursively nested element trees. These contracts encourage large atomic calls without communicating a preferred batch size or bounding structural complexity.

## Goals / Non-Goals

**Goals:**

- Accept tool arguments split into thousands of small deltas when all byte, call-count, timeout, and response limits remain satisfied.
- Keep parser memory and CPU bounded for malicious or pathological streams.
- Preserve protocol parity across Chat Completions, Responses, and Anthropic Messages.
- Give Design tools explicit schema guidance plus runtime enforcement for batch size, serialized size, node count, and nesting depth.
- Return diagnostics that identify the breached budget and safe stream/tool counters.
- Keep CPU, durable event volume, replay buffers, and debug memory independent of provider delta granularity.
- Enforce equivalent safety budgets across built-in HTTP clients, extension providers, and delegated Agent SDK turns.

**Non-Goals:**

- Raising the existing one-tool 1 MiB or all-pending-tools 4 MiB argument byte ceilings.
- Sending full provider payloads, tool arguments, or secrets to logs or UI errors.
- Replacing structured Design operations with raw SVG or file-content arguments.
- Changing renderer, IPC, HTTP, or persistence contracts.

## Decisions

### Treat bytes as the payload boundary and frames as the work boundary

Remove per-tool and total argument-fragment rejection. The existing argument byte limits remain authoritative for retained payload, while the response frame limit remains a defense against streams that consume excessive parser work with tiny events. Increase the default frame budget from 8,192 to 65,536 so legitimate token-granular reasoning plus tool JSON is supported without weakening the 32 MiB total-response ceiling.

Alternative considered: only raise the fragment ceiling. This would preserve two overlapping counters whose safe values depend on provider chunking and would still reject valid calls when providers change their delta size.

### Compact argument parts incrementally

Track the total fragment count for diagnostics, collect deltas into fixed-size blocks, and append completed blocks without rejoining prior blocks. Finalization joins blocks once, keeping array cardinality bounded without repeatedly copying all accumulated argument text.

Alternative considered: append directly to one string. Repeated concatenation can become quadratic for large token-sized streams.

### Coalesce durable assistant delta events

The model collector continues to reconstruct exact text/reasoning, but the native and delegated SDK runtimes batch consecutive deltas before recording them. Flush on a small byte target, a short timer, kind/order boundaries, abort, error, and stream completion. This preserves responsive live output while preventing token-sized provider events from becoming thousands of `appendFile + stat` operations and replay records.

### Parse SSE boundaries incrementally

Maintain a scan cursor over the buffered decoded text and resume delimiter detection near the previous tail. Do not rerun the frame-boundary search from offset zero for every network read. Buffer bytes, frame bytes, total bytes, frame count, idle timeout, and cancellation remain authoritative safety boundaries.

Durable text/reasoning deltas are split on UTF-8-safe 4 KiB boundaries even when a provider sends one multi-megabyte delta. Persisted replay keeps a finite 4 MiB per-record ceiling so the existing 1 MiB raw tool-argument contract, including a safely escaped invalid-JSON envelope, remains replayable.

### Apply provider-independent cumulative budgets

Extension model providers retain per-event and event-count protocol validation and add cumulative serialized-byte, output-byte, completed-tool, and tool-argument ceilings aligned with the native budgets. Delegated Agent SDK turns receive normalized `maxSteps` as SDK `maxTurns`, enforce output/event bytes and event count, enforce per-assistant tool-call limits, and release completed tool bookkeeping. Resource-limit failures interrupt the upstream stream and surface stable error codes without waiting indefinitely on provider cleanup.

### Bound replay and debug retention by bytes

Extension-agent subscriptions stream persisted replay rather than materializing the full event log, buffer live-during-replay events under explicit count and byte ceilings, and fail closed with a reconnectable overflow signal. LLM debug capture uses per-round and global retained-byte ceilings, bounded request snapshots, block-based output accumulation, and explicit truncation metadata.

### Attach safe budget context to resource-limit messages

Resource-limit errors will include response bytes, frame count, pending argument bytes/fragments, and the pending tool name when known. They will not include argument content, request headers, credentials, URLs, or user text.

### Bound Design batches at both schema and executor boundaries

- `design_update_shapes`: at most 100 operations, at most 512 KiB serialized arguments, at most 2,000 traversed object/array nodes, and maximum nesting depth 32.
- `design_svg_edit`: at most 50 operations, at most 1 MiB serialized arguments, at most 5,000 recursively nested element specs, and maximum element depth 32, preserving its existing SVG safety contract.
- Tool descriptions instruct models to prefer batches of 20-50 related operations and continue in subsequent calls.

Schema constraints improve model behavior, while executor validation remains authoritative for providers that ignore JSON Schema keywords or use the permissive direct-operation fallback.

## Risks / Trade-offs

- [Higher frame budget permits more tiny-frame CPU work] → Keep total response bytes, idle timeout, frame-size limits, and a finite 65,536-frame ceiling; cancel immediately on breach.
- [Additional batching delays one UI delta] → Use small byte/time thresholds and flush at every semantic boundary and terminal path.
- [Extension or SDK provider exceeds a shared budget] → Abort/cancel upstream and emit a stable, sanitized resource-limit error without partial tool execution.
- [Debug truncation omits troubleshooting content] → Preserve request/output prefixes plus byte counters and truncation markers within a global retained-byte budget.
- [Smaller Design batches require additional tool rounds] → Recommend 20-50 operations while allowing 100 canvas operations; Design tools are mutation-safe and intended for incremental use.
- [Generic shape structures vary by operation] → Enforce transport-neutral serialized-size/node/depth budgets without inventing renderer-specific field restrictions.

## Migration Plan

No persisted-data migration is needed. Deploy the parser and tool-contract changes together. Rollback is a source revert; existing threads and tool history remain valid because no stored schema changes.

## Open Questions

None. The selected limits are conservative relative to the existing 1 MiB model argument ceiling and can be tuned later from production counters without changing the contract.
