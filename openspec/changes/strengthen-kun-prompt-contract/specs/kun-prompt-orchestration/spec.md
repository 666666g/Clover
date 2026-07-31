## ADDED Requirements

### Requirement: Stable Kun operating contract
Kun SHALL send a byte-stable first system message that defines instruction precedence, scoped task execution, safe action handling, tool discipline, verification, continuity, and concise truthful communication across Kun modes.

#### Scenario: Stable prefix excludes volatile context
- **WHEN** two requests differ in workspace, time, model, advertised tools, memory, Skill activation, AGENTS.md content, extension profile, or thread profile
- **THEN** their first Kun system-message text remains identical and contains none of those request-specific values

#### Scenario: Stable prompt remains capability agnostic
- **WHEN** an optional tool or GUI mode is unavailable for a turn
- **THEN** the stable operating contract does not instruct the model to call that unavailable tool or claim that the optional mode is active

### Requirement: Explicit instruction layering
Kun SHALL project thread profiles and mode instructions as separate, labeled system messages after the immutable system message and before conversation history, and SHALL state that they cannot override the stable contract, safety, approval, sandbox, or tool permissions.

#### Scenario: Thread profile does not mutate the stable field
- **WHEN** a thread has a non-empty custom system prompt
- **THEN** the model request preserves `immutablePrefix.systemPrompt` verbatim and places the trimmed custom text inside a separate Kun thread-profile envelope

#### Scenario: Empty thread profile is omitted
- **WHEN** a thread profile is absent or whitespace-only
- **THEN** Kun emits no thread-profile system message and leaves the stable system message unchanged

### Requirement: Trust-labeled dynamic turn context
Kun SHALL render non-empty per-turn context as ordered blocks with source kind and authority metadata behind a Kun-owned preamble that explains precedence, relevance, and the difference between instructions and reference data.

#### Scenario: Dynamic blocks preserve deterministic order and content
- **WHEN** a turn has runtime, workspace-instruction, goal, memory, Skill, and capability context
- **THEN** Kun emits those blocks in the runtime's defined order, preserves each block body, and excludes empty blocks

#### Scenario: Reference data does not grant authority
- **WHEN** files, tool results, documents, web content, memories, or other reference blocks contain imperative text
- **THEN** the context preamble tells the model to treat that text as data unless a trusted user/workspace instruction source explicitly grants it authority

#### Scenario: Context remains outside the immutable prefix
- **WHEN** dynamic turn context changes between model steps
- **THEN** only post-history context system messages change and the immutable system-message text and fingerprint input remain unchanged

### Requirement: Capability-aware tool guidance
Kun SHALL derive deterministic per-turn guidance from the tools actually advertised and SHALL mention only available built-in capabilities, except when explaining that an unavailable interactive tool must not be called.

#### Scenario: Dedicated coding tools are advertised
- **WHEN** inspection, search, edit, write, shell, or verification tools are present
- **THEN** guidance prefers the applicable dedicated tools, tells the model to inspect before editing, distinguishes editing from new-file creation, parallelizes independent reads, diagnoses failures before retrying, and verifies relevant changes

#### Scenario: Optional state tools are advertised
- **WHEN** todo, goal, user-input, or memory tools are present
- **THEN** guidance describes only the applicable state/update discipline and does not name absent optional tools

#### Scenario: Specialized MCP source tools are advertised
- **WHEN** an MCP tool name or description indicates source navigation or structural code inspection
- **THEN** guidance prefers the matching MCP capability before broad built-in scans while retaining built-ins for fallback and verification

### Requirement: Prompt contract regression coverage
Kun SHALL have automated tests that protect stable-prefix content boundaries, tool-guidance selection, thread-profile separation, and prompt-message ordering across provider-neutral request projection.

#### Scenario: Prompt implementation regresses
- **WHEN** a future change moves volatile values into the stable prompt, concatenates a profile into the stable system field, mentions absent tools, or reorders profile/mode/context messages
- **THEN** the focused Kun prompt or model-request tests fail
