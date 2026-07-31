## Context

Kun resolves skills independently on every model step from the persisted turn prompt. An explicit `$ppt-master` prompt therefore exposes the three managed PPT tools, but a later follow-up such as “好的” does not. The always-advertised `load_skill` tool currently returns the requested instructions without changing the turn's active-skill set, so the next model step still cannot discover or execute skill-gated tools. When the model remembers a PPT tool from history and dispatch is rejected, generic guidance allows it to substitute `bash`, bypassing the managed Python environment and confirmation-token contract.

The native loop and Agent SDK bridge share one `SkillRuntime`, but build tool contexts separately. Both paths must observe the same manual activation and clear it at their terminal turn boundary.

## Goals / Non-Goals

**Goals:**

- Make `load_skill` an effective, turn-scoped activation operation as well as an instruction read.
- Re-resolve skill-gated tools on the next model step in both native and Agent SDK paths.
- Preserve blocked-skill policy, workspace visibility, activation budgets, and deterministic ordering.
- Prevent an active PPT Master workflow from advertising generic foreground or background shell execution.
- Give rejected PPT calls recovery guidance that activates the skill once and stops rather than bypassing the managed tool.
- Keep the native confirmation token mandatory for every PPT mutation.

**Non-Goals:**

- Persisting active skills across turns, threads, runtime restarts, or unrelated user messages.
- Treating prose such as “好的” or generic `request_user_input` answers as PPT authorization.
- Changing PPT Master scripts, their managed virtual environment, or HTTP/SSE contracts.
- Making all skills sticky or globally narrowing shell access.

## Decisions

### 1. Manual activation is stored by thread and turn inside `SkillRuntime`

`load_skill` will pass its execution context to `SkillRuntime`, which records the normalized skill id under a bounded `threadId + turnId` key after visibility and blocked-skill validation succeeds. `resolveTurn` will merge these explicit manual activations with prompt-triggered activations before applying the existing active-count and instruction-byte budgets.

This keeps the activation source close to skill discovery and lets both runtime paths consume one deterministic result. Storing it in renderer state or thread metadata would widen the protocol and create cross-process synchronization problems.

### 2. Activation becomes visible on the next model step, not during the current request

The current model request has an immutable tool schema. `load_skill` completes as a normal tool result; the loop then prepares the next model step, where `resolveTurn` includes the manual activation and rebuilds the tool list. This matches the existing append-only model/tool history and avoids mutating a request while it is streaming.

### 3. Both runtime paths provide turn identity and clear terminal state

The native `TurnContextResolver` and Agent SDK `loadTurnContext`/execution fallback will pass `threadId` and `turnId` into skill resolution. Native `AgentLoop` cleanup and Agent SDK `finishTurn` will call a shared clear method. The activation map will also be bounded as defense in depth for abnormal process termination.

### 4. PPT shell prohibition is enforced at the capability registry

When `ppt-master` is active, `bash` and `background_shell` will not be advertised or resolvable. This applies consistently to discovery and execution without relying on model compliance. File-oriented tools remain available for authoring design specifications and SVG slides, while all PPT package scripts continue through `ppt_master_run`.

This targeted policy is preferred over a global shell ban or changing legacy skill manifests on disk, which would require reinstall/migration behavior and could affect unrelated skills.

### 5. Rejected PPT calls receive managed recovery guidance

Dispatch rejection for a `ppt_master_*` tool will instruct the model to call `load_skill` for `ppt-master`, retry only after the next tool catalog refresh, and stop if the managed tools remain unavailable. It will explicitly prohibit `bash` and direct Python execution. The approval token remains unforgeable because only `ppt_master_confirm_design` records it.

## Risks / Trade-offs

- [Risk] Manual activation changes the tool prefix after `load_skill`. → Mitigation: the change occurs only at the next model-step boundary and adds deterministic schemas; telemetry already handles per-active-skill catalog identities.
- [Risk] Shared `SkillRuntime` state could leak between child and primary turns. → Mitigation: keys include both thread and turn ids, blocked-skill validation happens before recording, cleanup is terminal, and storage is bounded.
- [Risk] Blocking shell during PPT work may remove an escape hatch used by older prompts. → Mitigation: the managed skill contract already forbids shell substitution; retain read/write/edit and the fixed `ppt_master_run` action surface.
- [Risk] A runtime crash can leave process-local activations until restart. → Mitigation: bounded storage and full process reset make this non-persistent and non-authorizing; PPT mutations still require a same-turn approval token.

## Migration Plan

No persisted data migration is required. Deploy the runtime and renderer changes together, restart Kun so the new tool policy is active, and start a fresh PPT generation turn. Rollback is code-only; existing threads and installed PPT packages remain readable.

## Open Questions

None.
