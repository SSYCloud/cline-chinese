# ADR-0002: Keep Batch responsive inside VS Code

## Status

Accepted for the VSIX implementation. Wall-clock latency still needs measurement in an installed VS Code window.

## Context

Batch adds a task-pinned editor Webview to Cline's existing sidebar. In the 4.1.25 build, each editor loaded the same 9,781,800-byte `index.js` as the entire chat app. A long chat also configured Virtuoso's lower overscan as `Number.MAX_SAFE_INTEGER`, causing the transcript to render far beyond the viewport. Worksheet selection triggered a full Cline state publication and a cloned/serialized Batch snapshot containing results and history. Mode changes could rebuild an already-Act SDK session. These costs share VS Code's extension host and Webview resources.

## Decision

1. Build a dedicated `batch.js`/`batch.css` entry for the native editor. The optimized production build produces a 199,392-byte Batch script and 14,049-byte stylesheet. The sidebar keeps its original entry and providers.
2. Render only the visible worksheet rows plus overscan and use indexed row/result lookups. Keep native editor sizing responsive at narrower widths.
3. Bound chat message overscan, avoid recomputing the Batch card for each streamed token, and bound sticky-header scroll work to visible messages.
4. Send worksheet selection/format changes as task-scoped lightweight view events; coalesce pending stream updates. Full Batch snapshots remain for input, run and permission changes.
5. Avoid redundant SDK rebuilds/state publications during Batch mode transitions. Preserve the existing Act session and its history.
6. Persist only unsaved Webview draft state when a worksheet is hidden; the host remains the authority for submitted inputs and runs.

## Consequences

- A worksheet no longer parses the whole chat UI. Loading the dedicated script is about 98% fewer JS bytes than the former shared entry; this byte comparison is **not** a measured startup-time improvement.
- Opening and switching Batch tabs performs less React work and sends less data across the VS Code Webview boundary.
- There is an additional small Webview build entry to maintain. The build must package both entries, and task-pinned editor reloads must recover unsaved drafts without replacing newer host state.
- Quote validation, paid execute idempotency and the single Cline SDK session stay in the host. This optimization does not alter the billing boundary.

## Verification targets

- Measure mode-switch latency in the installed VSIX using **Developer: Show Running Extensions** and the Webview developer tools. Compare first entry, returning to Act, and returning to Batch with an existing task.
- Scroll a long conversation and a 100-row worksheet while recording Webview main-thread activity. Confirm DOM row counts remain near viewport size.
- Open several task-pinned worksheets, switch tabs, then check memory and restore of an unsaved edit. Confirm the original task and paid confirmation remain correct.

## Alternatives considered

- Sharing one Webview build for both surfaces keeps build scripts simpler but makes every worksheet load the whole chat application.
- Keeping all hidden editor contexts alive preserves local form state but increases memory for each task-pinned tab; a small persisted draft supports restoring the editor instead.
- Moving the Batch state machine into the Webview could reduce IPC but would split authority from the existing Cline session and weaken quote/run safeguards.

## References

- [VS Code Webview lifecycle and persistence](https://code.visualstudio.com/api/extension-guides/webview)
- [VS Code extension host stability and performance](https://code.visualstudio.com/api/advanced-topics/extension-host)
- [VS Code bundling guidance](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)
