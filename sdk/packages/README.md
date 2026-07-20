# Packages Overview

This directory is the single documentation source for package-level responsibilities.

- High-level package roles: this file (`packages/README.md`)
- Package interaction and runtime flows: [`ARCHITECTURE.md`](./ARCHITECTURE.md)

## Package Responsibilities

| Package | Primary responsibility | Typical consumers | Internal deps |
| --- | --- | --- | --- |
| `@coohu/shared` | Cross-package shared primitives (path resolution, session common types, indexing helpers) | `@coohu/agents`, `@coohu/core`, apps | None |
| `@coohu/llms` | Model catalog + provider settings schema + handler creation SDK | `@coohu/agents`, `@coohu/core`, apps | None |
| `@coohu/agents` | Stateless agent runtime loop (tools, hooks, extensions, teams, streaming) | `@coohu/core`, apps | `@coohu/llms`, `@coohu/shared` |
| `@coohu/core` | Stateful runtime orchestration (runtime composition, session lifecycle/storage, local and hub runtime services, hub discovery and client helpers) | CLI/Desktop apps | `@coohu/agents`, `@coohu/llms`, `@coohu/shared` |

## How Packages Work Together

1. `@coohu/llms` defines model/provider capabilities and builds concrete handlers.
2. `@coohu/agents` runs the agent loop on top of those handlers and tool execution primitives.
3. `@coohu/core` composes runtime behavior with persistent sessions/storage and local or hub-backed runtime services.
4. `@coohu/core` hub services orchestrate scheduled runtime execution, execution history, and schedule command handling.
5. `@coohu/core/hub` exposes discovery, the detached hub daemon, and session-oriented client APIs (`HubSessionClient`, `HubUIClient`) when hosts need a shared daemon.
6. `@coohu/shared` provides the shared contracts and path/session primitives used across the stack.

## Practical Boundary Rules

- Put provider/model schema, cataloging, and handler wiring in `@coohu/llms`.
- Put loop/tool/hook/team execution behavior in `@coohu/agents`.
- Put persistence, session lifecycle, and runtime assembly in `@coohu/core`.
- Put scheduled execution and schedule persistence in `@coohu/core` hub services.
- Put hub discovery, attach flows, and session-oriented client adapters in `@coohu/core/hub`.
- Put cross-package utility types and path/session constants in `@coohu/shared`.
- Put remote-config schemas, materialization, telemetry normalization, and blob upload primitives in `@coohu/shared/remote-config`.

## Runtime Entry Points

- Node-oriented imports exist where packages expose a distinct Node alias.
- `@coohu/core` itself is now the Node/runtime-oriented entry point for host/session services.
- Browser entry points still exist in packages that intentionally publish a browser surface, but `@coohu/core` no longer does.

## Notes for Doc Consolidation

Nested package `README.md` and `ARCHITECTURE.md` files can be reduced or removed after references are updated to point here.
