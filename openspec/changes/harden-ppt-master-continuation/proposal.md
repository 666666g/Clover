## Why

PPT Master can become unusable when its native confirmation is cancelled or answered through a later chat turn: the later turn no longer activates the `ppt-master` skill, `load_skill` does not refresh the executable tool catalog, and the model may bypass the managed runner with generic shell commands. This breaks the confirmation-token boundary, produces misleading tool failures, and runs the package with an unsupported system Python instead of its managed virtual environment.

## What Changes

- Make an explicit `load_skill` call activate that skill for the remainder of the same turn, including subsequent model-step tool discovery and execution.
- Keep manual activation turn-scoped and clear it when the turn finishes; do not make skills sticky across unrelated turns.
- Treat unavailable managed PPT Master tools as a bounded recovery path: direct the model to activate PPT Master once and forbid shell-based substitution.
- Preserve the native confirmation token as the only authorization for `ppt_master_run`; generic user input or prose approval remains insufficient.
- Cover the complete Write PPT flow and the follow-up-turn recovery path with regression tests.

## Capabilities

### New Capabilities

- `managed-skill-turn-continuation`: Defines turn-scoped manual skill activation, refreshed skill-gated tool availability, and safe recovery behavior for managed PPT Master workflows.

### Modified Capabilities

None.

## Impact

- Kun skill runtime and `load_skill` tool provider.
- Native agent-loop turn context resolution and turn lifecycle cleanup.
- PPT Master tool dispatch guidance and managed-workflow policy.
- Kun runtime and PPT Master integration tests.
- No HTTP/SSE schema, persisted thread format, or PPT Master package format changes.
