## ADDED Requirements

### Requirement: Provider chunking does not reject valid tool arguments
Kun SHALL accept a streamed tool argument regardless of its non-empty fragment count while the argument bytes, total response bytes, frame count, pending-call count, and timeout budgets remain within their configured limits.

#### Scenario: Highly fragmented argument remains valid
- **WHEN** a provider streams a valid tool argument in more than 1,024 non-empty deltas below every byte and frame budget
- **THEN** Kun emits one completed tool call with the reconstructed arguments and does not emit `stream_resource_limit`

#### Scenario: Argument byte ceiling remains enforced
- **WHEN** accumulated bytes for one streamed tool argument exceed the configured per-argument byte ceiling
- **THEN** Kun cancels the provider stream and emits `stream_resource_limit`

### Requirement: Pending argument storage remains bounded
Kun MUST group retained argument fragments into bounded blocks without repeatedly copying all previously accumulated argument text.

#### Scenario: Thousands of tiny deltas are compacted
- **WHEN** a pending tool call receives thousands of small argument deltas
- **THEN** Kun reconstructs the exact argument while retaining bounded fixed-size blocks and joins the complete value only at completion

### Requirement: Stream limit diagnostics are actionable and safe
Kun SHALL report safe counters and pending tool identity when a model stream resource budget is exceeded, and MUST NOT include argument content or credentials.

#### Scenario: Oversized tool argument is rejected
- **WHEN** a named pending tool call exceeds its argument byte budget
- **THEN** the error identifies the budget, tool name, argument bytes, fragment count, response bytes, and frame count without including argument content

### Requirement: Parser work remains bounded
Kun MUST retain a finite response-frame ceiling in addition to byte and timeout limits.

#### Scenario: Pathological tiny-frame stream exceeds work budget
- **WHEN** a provider sends more frames than the configured response-frame ceiling without exceeding the byte ceiling
- **THEN** Kun cancels the stream and emits `stream_resource_limit`

#### Scenario: Unterminated small network chunks
- **WHEN** a provider sends an unterminated SSE frame across many small network chunks below the buffer byte ceiling
- **THEN** Kun scans each newly received region incrementally rather than rescanning the full buffered prefix

### Requirement: Provider fragmentation does not amplify durable events
Kun SHALL coalesce consecutive assistant text and reasoning deltas before durable event recording while preserving exact content, semantic order, and bounded live-update latency.

#### Scenario: Token-sized reasoning stream
- **WHEN** a provider emits thousands of consecutive reasoning deltas
- **THEN** Kun records a bounded number of larger reasoning delta events and the finalized reasoning item exactly matches the provider content

#### Scenario: Delta batch reaches a semantic boundary
- **WHEN** text/reasoning kind changes, a tool event arrives, the stream terminates, errors, or is aborted
- **THEN** Kun flushes the pending delta before recording or returning from that boundary

### Requirement: Every model provider has a cumulative stream budget
Kun MUST enforce cumulative byte, event, output, and tool-call ceilings for built-in HTTP providers, extension model providers, and delegated Agent SDK turns.

#### Scenario: Extension provider exceeds cumulative bytes
- **WHEN** individually valid extension-provider events cumulatively exceed the response budget
- **THEN** Kun cancels the provider request and emits a sanitized provider protocol resource error

#### Scenario: Delegated SDK exceeds native-equivalent limits
- **WHEN** a Claude Agent SDK turn exceeds max turns, output/event bytes, event count, or per-assistant tool calls
- **THEN** Kun interrupts the SDK stream and fails the turn with a stable resource-limit code

### Requirement: Replay and debug retention are byte bounded
Kun MUST bound extension-agent replay/live buffers and in-memory LLM debug capture by cumulative bytes as well as record count.

#### Scenario: Live events overflow during extension replay
- **WHEN** live events produced during persisted replay exceed their count or byte ceiling
- **THEN** Kun closes the subscription with an actionable overflow error instead of retaining an unbounded array

#### Scenario: Debug capture exceeds retention budget
- **WHEN** a debug request or streamed output exceeds per-round or global retained-byte limits
- **THEN** Kun retains a bounded prefix and truncation metadata while keeping newer rounds within the global budget
