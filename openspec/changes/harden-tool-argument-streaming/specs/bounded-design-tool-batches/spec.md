## ADDED Requirements

### Requirement: Design canvas mutations have explicit batch limits
The `design_update_shapes` tool SHALL advertise and enforce a maximum operation count and MUST reject arguments that exceed its serialized-size, node-count, or nesting-depth budgets.

#### Scenario: Oversized canvas operation batch is rejected
- **WHEN** a model submits more than the supported number of shape operations in one call
- **THEN** the tool returns an actionable error instructing the model to split the work into smaller batches

#### Scenario: Reasonable canvas batch is accepted
- **WHEN** a model submits a valid batch within the operation, size, node, and depth budgets
- **THEN** the tool preserves the existing normalized operations and queues them atomically

### Requirement: Structured SVG edits have bounded complexity
The `design_svg_edit` tool SHALL advertise and enforce limits for operation count, serialized argument size, recursive element count, and element nesting depth.

#### Scenario: Deeply nested SVG element tree is rejected
- **WHEN** an SVG edit contains an element tree deeper than the supported nesting depth
- **THEN** the tool rejects the call before mutating the artifact and reports the structural limit

#### Scenario: Large SVG edit is split across calls
- **WHEN** an SVG edit exceeds the supported operation or element-count budget
- **THEN** the tool rejects the call with guidance to submit multiple revision-safe batches

### Requirement: Design tool guidance favors incremental mutations
Design mutation tool descriptions SHALL instruct the model to prefer batches of 20-50 related operations and continue large work through subsequent calls.

#### Scenario: Tool catalog is composed for a Design turn
- **WHEN** Kun advertises canvas or SVG mutation tools to the model
- **THEN** their descriptions communicate the preferred batch size and incremental continuation behavior
