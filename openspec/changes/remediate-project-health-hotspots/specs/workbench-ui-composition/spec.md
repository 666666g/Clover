## ADDED Requirements

### Requirement: Focused Composer interaction owners
Focused hooks and components SHALL own Composer draft, attachment, file mention,
model/reasoning controls, keyboard, menu, and context-capacity behavior while
retaining the public Composer props contract.

#### Scenario: Send rich Composer input
- **WHEN** a user selects a model, attaches files, inserts a mention, and sends
- **THEN** the same validated turn request and draft reset behavior SHALL occur

### Requirement: Focused Sidebar project owners
Deterministic selectors and focused components SHALL own Sidebar workspace grouping,
worktree resolution, thread actions, draft history, drag/drop, preview, and menus.

#### Scenario: Move and reopen project thread
- **WHEN** a user drags a thread between supported project contexts and reopens it
- **THEN** the same worktree resolution, selection, preview, and persisted action
  SHALL occur

### Requirement: Accessibility and keyboard compatibility
UI decomposition SHALL preserve focus restoration, keyboard navigation, ARIA state,
and menu dismissal behavior.

#### Scenario: Keyboard-only Composer menu
- **WHEN** a user opens and navigates a Composer menu using only the keyboard
- **THEN** focus, selection, commit, escape, and scroll behavior SHALL remain stable
