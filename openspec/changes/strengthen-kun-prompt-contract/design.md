## Context

Kun currently sends one byte-stable `KUN_SYSTEM_PROMPT`, then mode instructions, history, and a list of per-turn system messages. The cache boundary is already guarded by `ImmutablePrefix`, but the stable text mixes durable agent behavior with Kun implementation details, `thread.systemPrompt` is concatenated into the stable system-message string, and most tool guidance is limited to MCP preference. Dynamic sources are assembled in a deterministic order but do not share one explicit source/authority envelope.

The restored Claude Code implementation demonstrates four useful patterns: a cacheable behavior prefix, capability-dependent session guidance after that prefix, explicit environment/memory/reminder blocks, and tool-specific descriptions rather than one monolithic prompt. Kun should adopt those patterns without copying Claude-specific product text or changing its provider/runtime architecture.

## Goals / Non-Goals

**Goals:**

- Make the stable prompt a concise cross-mode operating contract that improves task interpretation, scope control, action safety, tool discipline, verification, and truthful communication.
- Keep the first system message exactly byte-stable while allowing thread profiles, modes, tools, memories, Skills, AGENTS.md, and runtime state to vary later.
- Make dynamic context self-describing so the model can distinguish runtime policy, user/workspace instructions, and reference data.
- Generate useful tool guidance from the advertised catalog without reordering or mutating tool schemas.
- Guard the architecture with focused deterministic tests.

**Non-Goals:**

- Copy Claude Code wording verbatim or reproduce its feature-flag/analytics system.
- Add a prompt editor, provider switcher, second runtime, new HTTP endpoint, model-side evaluator, or telemetry dashboard.
- Change approval, sandbox, tool execution, compaction, provider codecs, or renderer behavior beyond the internal request shape needed to preserve prompt ordering.
- Put project files, current time, model names, tool lists, or retrieved content in the immutable prefix.

## Decisions

### 1. Use a capability-agnostic stable behavior contract

`KUN_SYSTEM_PROMPT` will use named sections for instruction hierarchy, working method, software-task scope, action safety, tool use, verification/continuity, and communication. It will describe behaviors that remain true across Code, Design, Write, and Connect turns. Kun HTTP/SSE implementation details, cache telemetry rules, specific optional tool names, and mutable environment facts will be removed from model-facing stable text.

This keeps the prefix high-signal and prevents optional capabilities from being promised when absent. Keeping the current product-internal prompt was rejected because it consumes stable tokens without materially helping the model complete user work.

### 2. Project the thread profile as its own system message

Add an optional internal `threadProfileInstruction` to `ModelRequest`. `composeModelRequest` will always copy `immutablePrefix.systemPrompt` verbatim and render `thread.systemPrompt` through a Kun-owned profile envelope. The provider-neutral projector will emit messages in this order: stable system prompt, thread profile, mode instruction, prefix/history, turn context.

Appending the profile to `systemPrompt` was rejected because it makes the supposedly immutable request field vary by thread and weakens cache diagnostics. Moving it after history was rejected because a thread persona should frame the conversation before historical messages.

### 3. Represent turn context as labeled blocks behind one runtime preamble

Introduce a small prompt helper that accepts ordered `{ kind, authority, content }` blocks and emits system instructions after history. The first emitted instruction explains that blocks are Kun-assembled, lower than the stable contract, relevant only when applicable, and do not turn reference/tool/file/web content into authorization. Each non-empty block is wrapped with escaped metadata while its body remains byte-for-byte unchanged.

The native `ModelStepService` will label existing runtime, extension, AGENTS.md, goal/todo, recovery, attachment, memory, Skill, capability, verification, and catalog-drift content. It will not alter the source-specific inner envelopes already used by AGENTS.md, goals, and extensions. A richer persisted prompt AST was rejected because the labels are request-local and do not justify a new storage contract.

### 4. Derive tool guidance from advertised capabilities

Expand the existing tool-preference helper instead of reordering tool schemas. It will create only applicable bullets for:

- dedicated inspection/search versus shell fallbacks;
- editing existing files versus creating new files;
- independent parallel reads and dependent sequential work;
- verification after changes;
- todo/goal and interactive-input discipline;
- memory writes only when memory tools exist;
- source-specialized MCP tools or MCP discovery.

Exact tool-name checks are used for Kun built-ins; MCP source specialization may continue using name/description classification. The output is deterministic for a canonical catalog. Encoding all guidance in each tool description was rejected because cross-tool choices and sequencing need one shared view.

### 5. Test invariants rather than snapshot every word

Tests will assert required sections, forbidden volatile/product-internal content, capability selection, stable first-message identity, profile/mode/context ordering, empty-block removal, metadata escaping, and preservation of context bodies. This allows editorial improvement without rewriting a large golden snapshot while still protecting cache and precedence invariants.

## Risks / Trade-offs

- [The one-time prefix rewrite causes a cold cache miss after upgrade] → Accept the intentional version boundary; tests ensure the new prefix stays stable afterward.
- [A stronger prompt increases input tokens] → Remove low-value runtime implementation prose and keep dynamic guidance capability-specific so total stable text remains bounded.
- [XML-like envelopes can appear inside user-authored content] → Escape envelope attributes, preserve bodies as opaque content, and rely on explicit precedence language rather than treating delimiters as a security boundary.
- [Too much dynamic guidance can distract from the current task] → Emit only non-empty capability blocks, keep bullets concise, and tell the model to apply blocks only when relevant.
- [Provider message semantics differ] → Make the change in the provider-neutral `ModelRequest` projector; existing codecs already normalize multiple system messages for Chat Completions, Responses, and Anthropic Messages.

## Migration Plan

1. Ship the prompt/helper/request-shape changes and their unit tests together.
2. Existing threads need no stored-data migration; `thread.systemPrompt` is rendered into the new profile field at send time.
3. The immutable prefix fingerprint changes naturally on process restart. No historical events or cache telemetry are rewritten.
4. Rollback is a code revert; persisted thread, turn, and session schemas remain compatible.

## Open Questions

None. Semantic prompt evaluation against a larger task corpus can be added later, but deterministic correctness and cache invariants are sufficient for this scoped change.
