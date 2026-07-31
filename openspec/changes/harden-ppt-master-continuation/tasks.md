## 1. Turn-Scoped Skill Activation

- [x] 1.1 Add bounded thread/turn manual-activation state to `SkillRuntime`, merge it into deterministic turn resolution, and expose terminal cleanup.
- [x] 1.2 Make `load_skill` record a validated manual activation using its tool execution context.
- [x] 1.3 Pass thread/turn identity through native and Agent SDK skill resolution and clear activation on every terminal path.

## 2. Managed PPT Recovery Policy

- [x] 2.1 Prevent `bash` and `background_shell` discovery and execution while `ppt-master` is active.
- [x] 2.2 Return PPT-specific dispatch guidance that activates the skill once, retries after catalog refresh, and forbids direct script execution.
- [x] 2.3 Preserve the native approval-token and managed virtual-environment execution boundaries.

## 3. Regression Coverage

- [x] 3.1 Add SkillRuntime and `load_skill` tests for same-turn activation, blocked skills, turn isolation, and cleanup.
- [x] 3.2 Add capability/dispatch tests for PPT shell blocking and managed recovery guidance.
- [x] 3.3 Add runtime coverage showing a non-triggering follow-up turn can load PPT Master and execute a skill-gated tool on the next model step.

## 4. Verification

- [x] 4.1 Run focused Kun skill, capability, loop, Agent SDK, and PPT Master tests.
- [x] 4.2 Run `npm run build:kun`, root typecheck, and diff hygiene checks.
