## Why

The provider settings page currently presents connection credentials, model management, retry controls, media capabilities, proxy configuration, and destructive actions in one long form. Users lose their place, cannot easily distinguish provider-scoped settings from global settings, and receive inconsistent feedback between auto-saved providers and unsaved provider drafts.

## What Changes

- Replace the long provider form with a responsive provider workspace: grouped provider navigation on the left and task-oriented tabs on the right.
- Add searchable preset selection for new providers and keep new providers as explicit drafts until confirmed.
- Separate provider connection, models, media capabilities, and advanced controls while preserving every existing setting.
- Move global proxy controls outside the active provider detail and collapse them by default.
- Give save state, configuration readiness, and connection probe results distinct visual feedback.
- Move model add/edit forms into a focused dialog with progressive disclosure for advanced model options.

## Capabilities

### New Capabilities

- `provider-settings-workspace`: Defines the provider navigation, task tabs, add-provider flow, status feedback, model dialog, responsive behavior, and global proxy placement.

### Modified Capabilities

None.

## Impact

- Renderer settings components, settings layout, provider/model interaction tests, and localized settings strings.
- No persisted settings schema, preload/main IPC, provider probe contract, model request behavior, or Kun runtime behavior changes.
