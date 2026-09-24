# LoomLoom Batch Agent

Batch combines the current Cline Act session with LoomLoom SkillBot execution. The normal composer, task history and Agent messages stay visible. Batch controls render inside the chat scroll container; they do not replace the conversation with a catalog/execution/results application.

## User flow

1. Select **Batch** in `Plan / Act / Batch` while the current Agent turn is idle.
2. Select an installed SkillBot (five per page), or visit the **SkillBot** channel in the existing marketplace. Installing pins the listing locally; it does not download or execute an Agent Skill package. Legacy installed listing IDs seed the registry once it is first saved.
3. Selecting a SkillBot creates one blank input row. Add or remove rows at any time, up to 100 per batch; there is no upfront quantity lock. Reducing a batch requires selecting the exact rows to delete, with a warning for filled rows or attached files.
4. Continue in the existing Cline chat, with its file/reference tools, or fill individual rows. Both edit the same extension-owned draft; the Agent can expand rows on request but cannot silently delete filled rows.
5. Open the dark Excel-style **Batch 工作表** in a separate VS Code editor tab. Review input cells there, or ask the same Cline Agent to edit cells/ranges. Attachments retain their row/field association and filenames in cell details, but there is no generic “参考文件” column. Native `asset_ref` fields use the extension's file picker and upload endpoint; reference files remain local inputs for the Agent.
6. In either the chat card or worksheet, check the inputs, confirm the input table to obtain the server's estimate, then explicitly confirm again to create the run. Both surfaces operate the same draft and quote. Returning to edit invalidates the estimate.
7. Chat shows a compact run summary and workflow events. The worksheet shows full inputs/outputs, per-task status, errors, run timestamps and historical sheets. Both belong to the same conversation. Closing the editor tab, mode changes and Webview reloads do not stop extension-owned polling. “开始下一批” keeps the current SkillBot and archives the previous run; “改用其他 SkillBot” explicitly returns to selection without deleting the history.

The recommended model default is represented by an omitted override. Model selectors load the live `/models?stepType=...` catalog. Explicit public `model_override` restrictions take precedence; otherwise unambiguous public fields such as `text_model` / 文本模型 identify the documented text-generation catalog. This does not infer any private workflow step or model ID. Ambiguous generic model fields keep the default with an explanation. Catalog entries are validated, deduplicated, filtered by public enums and modality, and shared by the UI and Agent. Loading, empty and failure/retry states are visible.

## Ownership and integration

| Component | Responsibility |
|---|---|
| `shared/loomloom.ts` | Typed public schema, drafts, snapshots, canonical rows and validation |
| `services/loomloom/batch-service.ts` | Serialized draft transitions, revisions, estimates, paid-attempt identity, persistence and polling |
| `services/loomloom/client.ts` | Fixed-host HTTPS requests through the existing proxy-aware transport; current ShengSuanYun API key read per request |
| `services/loomloom/agent-tools.ts` | Three non-paid Agent tools scoped to the current enabled Batch session |
| `core/controller/loomLoom/*` | Validated RPC requests and trusted native file selection |
| `SdkController` | Product-mode transition, original task/session association, state snapshots and lifecycle cleanup |
| `BatchConversation` | Chat controls, guided inputs, quote/approval, compact progress and worksheet entry |
| `BatchWorksheet` / `BatchTablePanel` | Task-pinned native editor Webview; dense Excel-style grid without a second Controller or chat provider |
| `shared/loomloom-sheet.ts` | Shared A1 mapping, schema-derived columns, TSV parsing, cell reads and range patches |
| `services/loomloom/table-operations.ts` | One operation dispatcher for both worksheet RPC and the Agent's `loomloom_table` tool |
| `services/loomloom/batch-presentation.ts` | Shared post-transition presentation and task activation; opens the existing task-bound worksheet without stealing chat focus |
| `services/loomloom/creator-service.ts` | Task-scoped TemplateSpec v2 validation, private versioning, prechecked test runs, market review and durable local creator drafts |
| `SkillBotMarket` | Dedicated SkillBot marketplace and installed selection with pagination |
| `CreatorWorkbench` | Creator mode inside the task-pinned worksheet, using the same ShengSuanYun identity and Cline conversation |

The SDK's internal mode remains Plan/Act. Entering Batch projects to Act without auto-continuing a previous plan. The existing mode coordinator preserves session history; Batch entry additionally preserves the selected provider/model. When no task exists, entry creates an idle task without sending an LLM turn. Completing a run never creates a replacement SDK session.

The BatchAgentBridge is installed at the host's existing session preparation boundary. It supplies a mode policy, live `beforeModel` context projection, and non-paid tools together. Tool registration by itself is not the integration: before every inference, including subsequent tool iterations, the SDK reads the same task-scoped state the UI renders. Outside Batch, the projection is absent and the model does not see the Batch tool definitions. Missing runtime capabilities or an SDK mode mismatch stop the turn explicitly.

There are no model-callable quote/execute tools. The supported discovery and preparation tools are:

- `loomloom_get_context`
- `loomloom_update_draft`
- `loomloom_validate_draft`
- `loomloom_list_skillbots`
- `loomloom_inspect_skillbot`
- `loomloom_prepare_batch`
- `loomloom_table`

The Agent uses existing chat context and file tools, asks for missing inputs, and patches the draft with a revision and stable row IDs. Conversational selection, row expansion and review use the same commands as UI RPCs, with a distinct Agent authority that cannot quote or execute. Both UI and Agent query a shared SkillBotDirectory over the same installation registry and API. Field names are restricted to the public listing schema. Files and schema descriptions are data, not privileged instructions. Paid operations remain explicit UI actions.

UI state changes and Agent changes produce the same persisted Batch events, interleaved by timestamp with the existing Cline transcript. Live controls are an interaction surface in that conversation, not a second assistant. The model receives current stage, schema, row IDs/values, attachment associations, quote validity and run results as an ephemeral request projection. These snapshots never become fake user messages in the persisted transcript or accumulate stale copies after mode switches.

### Integration verification added after the first preview

The first preview incorrectly treated shared drafts and extra-tools registration as sufficient integration. It had no inference-time projection and no conversational discovery/selection/quantity path. Its component tests could not detect this. The extension's default test setup also stubs `@cline/core`.

`bun run test:batch-runtime` deliberately loads the real built SDK. It tests the same Agent instance through greeting → Batch → UI edits → Agent draft tool → results → ordinary Act; checks successive provider requests; and runs real ClineCore session/message preparation through the OpenAI-compatible adapter with a local in-memory transport. This verifies the outbound request contract without spending API credits or pretending a mock reply is a live model result. Separate host tests verify policy, hooks and tools are wired together. Actual user-provider behavior and paid cloud execution remain manual acceptance steps.

## Execution guarantees

- The extension, not React state, owns the draft and run. Atomic JSON snapshots live under extension global storage, keyed by a hash of the Cline task ID. Credentials are never serialized there.
- Draft writes require the current revision. Any text, row addition/deletion, attachment or model change invalidates the old quote.
- Execute checks the confirmation ID, revision, canonical input hash, quote age, and listing version/fee before submitting the frozen quote input.
- A random confirmation ID is persisted with each quote and reused as that confirmation's client request ID. The attempt is persisted before HTTP submission. Duplicate approvals cannot mint another ID, including two windows loading the same quote.
- Any ambiguous execution response enters `execution-unknown`; no automatic execute retry is performed. The user may associate a run ID after checking LoomLoom's call records. The extension verifies the listing and task count; it does not claim a server-side lookup by request ID exists.
- Run detail provides the authoritative overall status. Result rows are paginated independently. A completed first page does not imply a completed run. Row errors are preserved.
- Network failures retain the run ID and allow status refresh. No remote cancellation is claimed.
- Legacy direct-execute and result-to-new-session RPCs are explicitly disabled. Existing legacy history remains readable.

## Development preview

From the repository root:

```sh
bun install --frozen-lockfile
bun run build:sdk
cd apps/vscode
bun run protos
cd webview-ui
bun run dev --host 127.0.0.1 --port 5201
```

Open `http://127.0.0.1:5201/batch-preview.html`. This development-only page imports the production Batch UI components and replaces RPC/Agent behavior with clearly labelled in-memory fixtures. It sends no LoomLoom requests and creates no paid runs. It is not imported by the extension production entry point. It demonstrates interaction, not live model quality or backend execution.

The proto generator uses relative protoc paths and an ASCII Windows plugin launcher so checkouts in Chinese-named directories can generate the added service reliably.

## Verification and remaining integration checks

Automated checks cover draft revision conflicts, reviewing before quoting, quote invalidation, duplicate approvals, lost responses and restart, persist-before-send, filenames, numeric value preservation, default model omission, result pagination, partial failure, credential rotation, and Agent session boundaries. Existing SDK mode/session regressions are run alongside them.

Before production rollout, run a small, explicitly confirmed live SkillBot through the VS Code extension to validate current service version/quote behavior, native asset handling and actual model tool usage. This change does not include paid cloud execution as part of automated tests. API schema/version changes remain fail-closed; unavailable metadata does not trigger guessed models or fields.

Manual acceptance: use an existing Cline conversation; collect three rows, attach a file, edit the first row, quote, return to edit, re-quote, confirm once, switch to Act and back, reload, inspect a failed row, and then continue discussing the result in the original conversation.

## Worksheet integration (4.1.22)

The worksheet is a second **view**, never a second Agent/session. `VscodeWebviewProvider` passes its existing Controller to `BatchTablePanel`. The panel pins every RPC to the originating `taskId` and allows only its scoped methods. Explicit human review, quote and run-confirmation buttons call the same `batchCommand` RPC as the chat card; the current-task, enabled-mode, revision, quote validity and deduplication checks remain in the host. Agent tools still cannot quote, approve or execute. The native editor loads a dedicated small `batch.js`/`batch.css` Webview entry and mounts `BatchWorksheet` without normal chat Providers. Disposing an editor only cancels that editor's stream, including close-before-registration races; it never disposes the Controller or BatchService.

`worksheetOperation` (UI) and `loomloom_table` (Agent) call the same `BatchTableService.execute`. Supported operations:

| Operation | Shared behavior |
|---|---|
| `layout`, `models` | Schema-driven columns, sheet IDs, current revision, read-only state, recommended defaults and supported model IDs |
| `read`, `write` | A1 cell/range reads and rectangular updates; current draft revision required for writes |
| `view`, `find` | Active sheet/selection, wrap, frozen columns, column widths, font/zoom, bold selection, search |
| `copy`, `cite` | Native clipboard or reference in the original Cline composer; citation never starts a model turn automatically |
| `attach`, `remove_attachment` | Trusted native file picker/upload or removal, retaining the row/field association |
| `refresh`, `open_output`, `open` | Actual current/historical run status, text editor or HTTPS artifact, same editor panel |

Model and public-field validation also run in BatchService, so ordinary Agent draft patches cannot bypass spreadsheet validation. Selecting or formatting cells changes the shared view without changing the input revision or invalidating a quote. View state is memory-resident and included with the next persisted data snapshot; it is not a separately persisted workbook. Content edits remain persisted and revision-checked.

The grid has A/B/C headers, row numbers, A1 address and formula-style edit bars, keyboard navigation, Shift selection, quoted multiline TSV paste, column resizing and bottom current/progress/history tabs. This is spreadsheet-style interaction over typed Batch data, **not an Excel formula engine or `.xlsx` import/export subsystem**. Read-only output cells open an escaped text detail dialog. HTML outputs are opened as text in a VS Code editor, never executed inside the extension Webview.

Overall progress is `(completed + failed + cancelled) / total` and explicitly labelled “已结束”; it is not a success rate. Per-task running percentages or hidden workflow steps are not invented. The service currently exposes task status/error/association and run-level timestamps; missing fields stay unknown. Long outputs and history are omitted from the ordinary chat state DTO, while the table and scoped Agent tools can read them.

Automated additions exercise both directions through the real SDK runtime, shared range writes, stale revisions, estimate invalidation, schema/model validation, filenames, historical read-only rows, native panel reuse/disposal, cross-task RPC rejection, inert HTML output, and the production React worksheet. Live VS Code window behavior and actual paid cloud execution remain manual acceptance, not claims made by these tests.

## Source-only flow hardening after user acceptance feedback (pending 4.1.23)

- Conversation UI uses a `Cline Chinese` reply header inside a subtle blue Batch frame. Internal task IDs, revisions and connection diagnostics are not shown as a separate control panel. Display-only decimal formatting removes insignificant trailing zeroes without changing quoted amounts.
- Quantity, review, revise and successful run/recovery transitions emit post-persist presentation intents. UI actions and Agent tools therefore open the same worksheet. Polling and ordinary cell writes do not repeatedly reopen a manually closed panel. All automatic opens preserve chat focus and recheck the current task before revealing a tab.
- A central Controller task-assignment boundary immediately updates old/new worksheet permissions. Old tabs remain pinned to their original task and become read-only, rather than silently displaying another conversation's inputs. Returning to a Batch task restores its valid current/progress/history selection. The read-only notice offers an explicit return to the original conversation, without inference.
- Unsaved formula-bar edits retain their original cell address and revision. Local navigation asks the user to save/cancel; remote selection changes cannot redirect that draft to another cell. Delayed focus snapshots cannot overwrite a newer task-switch notification.
- Stage-specific guidance distinguishes empty allocated rows, partially filled inputs, valid inputs, review, quote, run and recovery. Expired quotes lose the execute button in place. Restarting an unsubmitted draft requires explicit confirmation, warns of input clearing, and checks the confirmed revision.
- Pre-send persistence failures and typed local missing-credential errors are known to have sent no paid request. They restore a retryable state and preserve the confirmation/request ID; another explicit user confirmation is still required. Transport errors remain execution-unknown. A fresh successful quote updates the listing fee baseline so a same-version price change cannot trap the user in a re-quote loop.

These notes describe the earlier source-hardening round; subsequent VSIX builds incorporate them.

## Dynamic rows and Creator mode

Selecting a SkillBot now creates one empty input row; users and the Agent can add more later. A user can explicitly delete selected rows, including populated rows after seeing a confirmation. Agent row deletion is limited to empty rows. The worksheet omits the generic “参考文件” column; schema-declared asset fields and file names in cell details remain. Starting another batch keeps the selected SkillBot by default and archives the previous run; changing SkillBots is a separate action. Quotes are invalidated by row changes, and execution remains a separate human confirmation.

Creator mode is a task-pinned view inside the same native Batch editor. It is distinct from the Market buyer state machine. A private template/container is created separately from an immutable TemplateSpec v2 version; publishing that version submits a Market review request, not an instantly executable Listing. The simple editor uses live `templateAuthoringContext` profiles/models to compose one text-generating V2 Step; the advanced editor accepts a complete V2 JSON definition. Both call the server-authoritative `templateSpecs:validate` endpoint before a user can explicitly create a private template or save a version. The older locally installed CLI still documents V1, so its V1 examples are not submitted as V2.

The creator test path uploads one example as JSONL to obtain an `inputFileId`, obtains a private precheck with the service's amount/currency and pricing revision, and requires a second explicit user confirmation for the paid run. A durable one-shot attempt is recorded before submission. Market publication stays disabled until a read-only run lookup verifies the saved version's definition hash and an all-successful completed private run. Publication sends an explicit per-task fee and yields a review ID; the creator can query review status and earnings. No test or build step in this repository creates a paid cloud run or a remote template.

Unsaved creator text and returned IDs survive a hidden Webview through VS Code state and a closed/reopened task-pinned tab through an atomic, size-bounded task-scoped local draft. The API key stays in the extension host. Creator mode can place the business draft into the original Cline composer; the same Batch Agent can also read and patch local business design fields directly through a non-paid tool. Draft updates appear in the worksheet, while conflicting unsaved local edits require a human choice. The Agent cannot create, run or publish remotely.

The authoring contract follows the attached LoomLoom OpenAPI and the [official TemplateSpec v2 documentation](https://github.com/cogfoundry-labs/loomloom/releases/tag/v0.3.0). The server remains authoritative for supported profiles, models, bindings and publication eligibility.
