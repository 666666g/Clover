## ADDED Requirements

### Requirement: Loaded skills activate within the current turn
The runtime SHALL treat a successful `load_skill` call as a manual activation for the same thread and turn, and SHALL expose that skill's instructions and skill-gated tools when preparing the next model step.

#### Scenario: Follow-up turn loads PPT Master
- **WHEN** a turn whose prompt does not trigger PPT Master successfully calls `load_skill` with `ppt-master`
- **THEN** the next model step advertises `ppt_master_confirm_design`, `ppt_master_read_guide`, and `ppt_master_run`

#### Scenario: Blocked skill cannot be manually activated
- **WHEN** a turn calls `load_skill` for a skill blocked by its execution profile
- **THEN** loading fails and subsequent model steps do not advertise that skill's tools

### Requirement: Manual activation is turn-scoped
The runtime MUST isolate manual skill activations by thread and turn and MUST clear them when that turn reaches a terminal state.

#### Scenario: Unrelated turn remains inactive
- **WHEN** one turn manually activates PPT Master and a different turn does not mention or load it
- **THEN** the different turn does not advertise PPT Master tools

#### Scenario: Terminal cleanup
- **WHEN** a manually activated turn completes, fails, or is aborted
- **THEN** its process-local manual activation state is removed

### Requirement: Managed PPT execution cannot fall back to shell
The runtime SHALL withhold generic foreground and background shell tools while PPT Master is active, and SHALL direct rejected PPT tool calls through bounded skill activation recovery rather than direct script execution.

#### Scenario: Active PPT workflow tool catalog
- **WHEN** `ppt-master` is active for a model step
- **THEN** `bash` and `background_shell` are neither advertised nor executable while the managed PPT tools remain available

#### Scenario: Rejected PPT tool call
- **WHEN** a model calls a `ppt_master_*` tool before activating PPT Master
- **THEN** the tool result instructs it to call `load_skill` once, retry after the next model step, and never invoke PPT scripts through shell or direct Python

### Requirement: Native PPT confirmation remains authoritative
The runtime MUST require an approval token issued by `ppt_master_confirm_design` in the same turn before executing any `ppt_master_run` action.

#### Scenario: Generic confirmation is insufficient
- **WHEN** the user answers a generic `request_user_input` prompt or sends approval prose without a native PPT approval token
- **THEN** `ppt_master_run` refuses to create or modify presentation files

#### Scenario: Managed execution uses the installed environment
- **WHEN** a validly approved `ppt_master_run` action executes
- **THEN** it invokes the managed PPT Master virtual-environment Python rather than the system `python3`
