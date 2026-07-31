## ADDED Requirements

### Requirement: Reasoning summaries hide HTML comments
The conversation UI SHALL omit complete and incomplete HTML comment nodes from rendered model reasoning summaries without modifying the persisted reasoning text.

#### Scenario: Completed comment marker
- **WHEN** a completed reasoning summary contains `<!-- -->` outside Markdown code
- **THEN** the thinking panel renders the surrounding reasoning Markdown without displaying the comment marker

#### Scenario: Streaming comment opener
- **WHEN** the current accumulated reasoning summary ends with an incomplete `<!--` received before its closing SSE chunk
- **THEN** the thinking panel does not display the incomplete comment opener

### Requirement: Reasoning code literals remain visible
The conversation UI MUST preserve HTML-comment syntax that is represented as Markdown inline code or fenced code in a reasoning summary.

#### Scenario: Inline code example
- **WHEN** a reasoning summary contains `` `<!-- -->` ``
- **THEN** the thinking panel renders `<!-- -->` as inline code

#### Scenario: Fenced code example
- **WHEN** a reasoning summary contains `<!-- -->` inside a fenced code block
- **THEN** the thinking panel renders the comment syntax as code content

### Requirement: Reasoning cleanup remains presentation-only
The system SHALL retain the original reasoning event and message text while applying comment cleanup only to the rendered view.

#### Scenario: Historical reasoning reload
- **WHEN** persisted reasoning containing an HTML comment is loaded from thread history
- **THEN** the stored text remains unchanged and the thinking panel omits the comment marker
