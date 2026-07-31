## ADDED Requirements

### Requirement: Endpoint-family codecs
The compatible model client SHALL delegate request construction and streaming
decode to endpoint-family-specific components for chat completions, Responses, and
Anthropic Messages while retaining one public client contract.

#### Scenario: Equivalent protocol request
- **WHEN** the same configured provider/model request is sent after extraction
- **THEN** its URL, headers, JSON body, tool order, image representation, reasoning
  fields, and cache controls SHALL match the characterized request

### Requirement: Shared stream invariants
All endpoint-family decoders SHALL use common resource budgets, cancellation,
tool-call aggregation, usage normalization, retry classification, and diagnostics.

#### Scenario: Fragmented tool call
- **WHEN** a provider streams a tool call id, name, and arguments across frames
- **THEN** the public stream SHALL emit the same single completed tool call in the
  same order without exceeding configured limits
