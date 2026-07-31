## ADDED Requirements

### Requirement: Channel-independent conversation coordination
Claw SHALL own Kun thread binding, conversation selection, attachment authorization,
and reply lifecycle independently of channel-specific transport adapters.

#### Scenario: Existing conversation receives a reply
- **WHEN** a supported IM channel delivers a message for an existing conversation
- **THEN** Claw SHALL reuse the same Kun thread and produce the same reply lifecycle

### Requirement: Isolated channel adapters
Feishu, Telegram, and Weixin transport parsing and delivery SHALL be isolated so a
channel-specific change cannot alter another channel's behavior.

#### Scenario: Channel delivery failure
- **WHEN** one channel adapter fails to upload or deliver a reply
- **THEN** the failure SHALL be reported using that channel's existing fallback and
  SHALL not mutate another channel's conversation state
