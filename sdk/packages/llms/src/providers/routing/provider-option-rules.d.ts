import type {
	MatchedProviderOptionRule,
	ProviderOptionBuildInput,
	ProviderOptionMatchInput,
	ProviderOptionRule,
	ProviderOptionSuppression,
} from "./provider-options-types";
import { type ProviderOptionsPatch } from "./utils";
/**
 * The table is the provider/family behavior matrix. Adding a new exception
 * should mean adding a named rule here, not adding a branch in the composer.
 * Keep model/provider fact detection in `providers/model-facts.ts`; see
 * `sdk/packages/llms/AGENTS.md` for the sources-of-truth boundary.
 */
export declare const PROVIDER_OPTION_RULES: ReadonlyArray<ProviderOptionRule>;
export declare function matchProviderOptionRules(
	rules: ReadonlyArray<ProviderOptionRule>,
	input: ProviderOptionMatchInput,
): Array<MatchedProviderOptionRule>;
export declare function resolveProviderOptionSuppressions(
	matchedRules: ReadonlyArray<MatchedProviderOptionRule>,
): ProviderOptionSuppression;
export declare function buildProviderOptionRulePatches(
	matchedRules: ReadonlyArray<MatchedProviderOptionRule>,
	input: ProviderOptionBuildInput,
): Array<ProviderOptionsPatch | undefined>;
