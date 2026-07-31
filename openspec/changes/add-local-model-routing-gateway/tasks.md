## 1. Shared Settings And Runtime Contracts

- [x] 1.1 Add route-pool, target, strategy, failure-policy, health-policy, gateway, and structured failure types with safe defaults.
- [x] 1.2 Normalize and validate route pools against concrete provider/model profiles, including collisions, dangling targets, and bounded values.
- [x] 1.3 Extend settings IPC schemas, runtime config schemas, hot apply, and provider configuration projection for route pools and gateway options.
- [x] 1.4 Add enabled route pools to composer/workflow/schedule model groups with aggregated display capabilities.

## 2. Kun Routing Engine

- [x] 2.1 Extend compatibility HTTP errors and model stream errors with structured failure metadata and target attribution.
- [x] 2.2 Implement route target capability filtering and the five deterministic/health-aware selection strategies.
- [x] 2.3 Implement pre-content failover, aggregate exhaustion errors, target commit semantics, and provider-local retry interoperability.
- [x] 2.4 Implement circuit breaking, bounded route events, persisted rolling metrics, restart reset, and hot configuration replacement.
- [x] 2.5 Wire the route client around the existing multi-provider client for native turns and internal model roles.

## 3. Local OpenAI-Compatible Gateway

- [x] 3.1 Add loopback-only gateway validation and the OpenAI-compatible `/v1/models` catalog.
- [x] 3.2 Implement bounded non-streaming and streaming `/v1/chat/completions` request/response mapping.
- [x] 3.3 Implement bounded non-streaming and streaming `/v1/responses` request/response mapping, tools, images, cancellation, and compatible errors.
- [x] 3.4 Add route status, event history, and complete route-test control endpoints for the settings UI.

## 4. Provider Settings UI

- [x] 4.1 Add the Model Providers / Advanced Local Relay workspace switch and route-pool master-detail layout.
- [x] 4.2 Implement pool creation, editing, strategy selection, target add/remove/reorder, validation, and deletion.
- [x] 4.3 Implement health/failure controls, runtime status, route events, full-chain testing, hot-save feedback, and loopback security warning.

## 5. Verification And Delivery

- [x] 5.1 Add shared normalization and model-group tests covering legacy settings, collisions, invalid references, and heterogeneous pools.
- [x] 5.2 Add routing tests for all strategies, capabilities, classified errors, pre/post-content behavior, circuit state, persistence, and hot replacement.
- [x] 5.3 Add gateway route tests for model listing, both protocols, streaming, tools, images, cancellation, errors, and loopback enforcement.
- [x] 5.4 Add renderer interaction coverage for pool CRUD, reorder, validation, runtime status, and testing flows.
- [x] 5.5 Run typecheck, targeted tests, `build:kun`, top-level build, lint/diff checks, then create the requested local Angular-style commit.
- [x] 5.6 Correct the relay information architecture so one named local relay provider manages multiple independently routed models and appears as one provider group in model selectors.
- [x] 5.7 Fix route enablement, runtime hot apply, diagnostic IPC access, full-chain testing, and concrete-model alias disambiguation.
- [x] 5.8 Make complete route tests Runtime-owned asynchronous jobs with resumable page progress, bounded result history, and hot-configuration synchronization gating.
