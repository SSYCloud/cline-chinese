# ADR-0003: Separate private workflow creation from Market SkillBot execution

## Status

Accepted for the Cline Chinese Batch worksheet.

## Context

The existing Batch Agent runs installed Market SkillBots through a public Listing and its public input schema. A user-created workflow is instead a private template with immutable versions. Publishing one version creates a separate Market Listing review request; it does not automatically become an installed or approved SkillBot. The supplied LoomLoom OpenAPI describes `template-spec/v2` with an opaque `canonicalSpecV2` object. A locally installed older CLI still documents V1, while the [official v0.3.0 release](https://github.com/cogfoundry-labs/loomloom/releases/tag/v0.3.0) documents V2 and server-authoritative validation.

## Decision

1. Keep Market buyer Batch state (`listingId`, input rows, quote, execute) separate from creator state (`templateId`, `versionId`, private run, `reviewRequestId`, Listing). The Creator mode is a view in the same task-pinned VS Code worksheet and reuses the same Cline conversation and ShengSuanYun credential.
2. Offer a one-step text workflow builder using only live authoring profiles and eligible models. Support full multi-step V2 as an advanced JSON draft. Pass both unchanged to `POST /templateSpecs:validate`; the service decides whether the definition is valid.
3. Require distinct human confirmations for private template/container creation, immutable version save, the prechecked paid private test run, and Market review submission. A successful run bound to the selected private version's definition hash is required before enabling publication in the UI. The server remains the final authority.
4. Persist unsaved creator work by original Cline task ID under extension-owned storage. Hidden editor Webviews also keep a small local draft through VS Code state. No credential enters draft or Webview data.
5. Give the same Cline Agent a local-only creator draft tool. It reads the task's draft and patches business design fields with an `updatedAt` conflict guard; the worksheet receives a lightweight live update. The Agent has no create, paid-run or publish tool. A conflicting unsaved local edit is never overwritten silently.

## Consequences

- A creator can design, validate, privately test, submit for review, check review state and inspect earnings without confusing a private version with a Market Listing.
- The user can ask Cline in the original Batch conversation to change the creator draft directly, while remote template, billing and publication decisions remain explicit UI confirmations.
- The simple builder currently covers a single text Step. More complex image/video or multi-step designs use the advanced V2 JSON editor and server validation.
- A failed or ambiguous paid submission is not retried automatically. The host stores a one-shot attempt before transport; the UI requires the user to inspect the run record before retrying.
- Published Listings remain subject to LoomLoom review, availability and settlement rules. There is no promise of immediate listing or earnings.

## Alternatives considered

- Reusing the Market buyer `listingId` to store private templates was rejected because it would mix authority, version and pricing boundaries.
- Hardcoding the older CLI's TemplateSpec V1 example into a V2 request was rejected because its top-level structure differs from the [official V2 example](https://github.com/cogfoundry-labs/loomloom/blob/main/docs/ir-spec/zh-CN/examples/valid/capability-profile.json).
- Auto-publishing immediately after template creation was rejected because the API has a private test/run stage and a separate Market review stage.

## Source of truth

- Supplied `LoomLoom-API-接口总览-openapi (1).json`, dated 2026-09-15.
- [Official TemplateSpec V2 overview](https://github.com/cogfoundry-labs/loomloom/blob/main/docs/ir-spec/zh-CN/get-started/understand-template-spec.md).
