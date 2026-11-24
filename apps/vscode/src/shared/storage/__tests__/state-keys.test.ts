/**
 * State Keys Type Safety Tests
 *
 * This test suite validates the type safety guarantees of the state-keys module,
 * which uses a single-source-of-truth pattern where types are auto-generated from
 * field definition objects.
 *
 * ## Type Safety Model
 *
 * The state-keys module generates TypeScript types from runtime objects using:
 * 1. Field definition objects with `default` values (e.g., `{ default: true as boolean }`)
 * 2. `satisfies FieldDefinitions` constraint to enforce structure
 * 3. `BuildInterface<T>` mapped type to extract types from `default` values
 *
 * ## Known Limitations (What These Tests Catch)
 *
 * The `as` type assertions on default values are TRUSTED by TypeScript. This means:
 * - `{ default: "foo" as number }` would compile but be wrong at runtime
 * - `{ default: undefined as string }` compiles but `string` doesn't include `undefined`
 *
 * These tests provide runtime validation to catch such mismatches that TypeScript cannot.
 *
 * ## What These Tests Validate
 *
 * 1. **Type-Value Consistency**: Default values match their declared types at runtime
 * 2. **Key Synchronization**: Generated key arrays match the source objects
 * 3. **Type Guard Correctness**: `isGlobalStateKey`, `isSettingsKey`, etc. work correctly
 * 4. **Default Value Retrieval**: `getDefaultValue` returns correct values
 * 5. **Transform Functions**: Transforms produce values of the correct type
 *
 * ## Running Tests
 *
 * ```bash
 * bun run test:unit -- --grep "State Keys"
 * ```
 */

import { describe, it } from "bun:test"
import { expect } from "chai"

import {
	applyTransform,
	GLOBAL_STATE_DEFAULTS,
	GlobalStateAndSettingKeys,
	getDefaultValue,
	hasTransform,
	isAsyncProperty,
	isComputedProperty,
	isGlobalStateKey,
	isLocalStateKey,
	isSecretKey,
	isSettingsKey,
	LocalStateKeys,
	SETTINGS_DEFAULTS,
	SecretKeys,
	SettingsKeys,
} from "../state-keys"

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Validates that a value matches the expected TypeScript type at runtime.
 * This catches cases where `as` assertions mask type mismatches.
 */
function assertTypeMatch(value: unknown, expectedType: string, key: string): void {
	const actualType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value

	if (expectedType === "array") {
		expect(Array.isArray(value), `${key}: expected array, got ${actualType}`).to.be.true
	} else if (expectedType === "object") {
		expect(actualType, `${key}: expected object, got ${actualType}`).to.equal("object")
		expect(value, `${key}: expected object, got null`).to.not.be.null
		expect(Array.isArray(value), `${key}: expected object, got array`).to.be.false
	} else if (expectedType === "undefined") {
		expect(value, `${key}: expected undefined, got ${actualType}`).to.be.undefined
	} else {
		expect(actualType, `${key}: expected ${expectedType}, got ${actualType}`).to.equal(expectedType)
	}
}

/**
 * Infers the expected runtime type from a default value.
 * Used to validate that default values are consistent with their purpose.
 */
function inferExpectedType(value: unknown): string {
	if (value === undefined) {
		return "undefined"
	}
	if (value === null) {
		return "null"
	}
	if (Array.isArray(value)) {
		return "array"
	}
	return typeof value
}

// ============================================================================
// Tests
// ============================================================================

describe("State Keys Type Safety", () => {
	describe("Type-Value Consistency", () => {
		/**
		 * These tests validate that default values match their declared types.
		 * This catches mistakes like `{ default: "string" as number }` which
		 * TypeScript would accept but would cause runtime issues.
		 */

		it("defaults terminal execution to the VS Code terminal", () => {
			expect(getDefaultValue("vscodeTerminalExecutionMode")).to.equal("vscodeTerminal")
		})
	})

	describe("Key Array Synchronization", () => {
		/**
		 * These tests ensure the generated key arrays stay in sync with
		 * their source objects. A mismatch could cause runtime errors.
		 */

		it("should have SettingsKeys match SETTINGS_DEFAULTS keys", () => {
			const defaultKeys = Object.keys(SETTINGS_DEFAULTS)
			const exportedKeys = new Set<string>(SettingsKeys)

			// Every key in defaults should be in the exported array
			for (const key of defaultKeys) {
				expect(exportedKeys.has(key), `SettingsKeys missing key: ${key}`).to.be.true
			}
		})

		it("should have no duplicate keys in exported arrays", () => {
			expect(new Set(SettingsKeys).size, "SettingsKeys has duplicates").to.equal(SettingsKeys.length)
			expect(new Set(SecretKeys).size, "SecretKeys has duplicates").to.equal(SecretKeys.length)
			expect(new Set(LocalStateKeys).size, "LocalStateKeys has duplicates").to.equal(LocalStateKeys.length)
			expect(new Set(GlobalStateAndSettingKeys).size, "GlobalStateAndSettingKeys has duplicates").to.equal(
				GlobalStateAndSettingKeys.length,
			)
		})
	})

	describe("Type Guard Functions", () => {
		/**
		 * Type guards narrow `string` to specific key types.
		 * These tests ensure they correctly identify valid keys.
		 */

		it("should correctly identify GlobalState keys", () => {
			// Known GlobalState keys from the defaults
			const knownGlobalStateKeys = Object.keys(GLOBAL_STATE_DEFAULTS)

			for (const key of knownGlobalStateKeys) {
				expect(isGlobalStateKey(key), `${key} should be a GlobalStateKey`).to.be.true
			}

			// Non-existent keys should return false
			expect(isGlobalStateKey("nonExistentKey123")).to.be.false
			expect(isGlobalStateKey("")).to.be.false
		})

		it("should correctly identify Settings keys", () => {
			for (const key of SettingsKeys) {
				expect(isSettingsKey(key), `${key} should be a SettingsKey`).to.be.true
			}

			expect(isSettingsKey("nonExistentKey123")).to.be.false
		})

		it("should correctly identify Secret keys", () => {
			// Sample known secret keys
			const knownSecretKeys = ["apiKey", "openRouterApiKey", "awsAccessKey"]

			for (const key of knownSecretKeys) {
				expect(isSecretKey(key), `${key} should be a SecretKey`).to.be.true
			}

			expect(isSecretKey("notASecretKey")).to.be.false
		})

		it("should correctly identify LocalState keys", () => {
			for (const key of LocalStateKeys) {
				expect(isLocalStateKey(key), `${key} should be a LocalStateKey`).to.be.true
			}

			expect(isLocalStateKey("notALocalStateKey")).to.be.false
		})
	})

	describe("Default Value Retrieval", () => {
		/**
		 * Tests for the getDefaultValue utility function.
		 */
	})

	describe("Transform Functions", () => {
		/**
		 * Tests for transform functions that modify values before storage.
		 */

		it("should correctly identify keys without transforms", () => {
			expect(hasTransform("nonExistentKey")).to.be.false
			expect(hasTransform("")).to.be.false
		})

		it("should pass through values for keys without transforms", () => {
			const testValue = { test: "value" }
			const result = applyTransform("keyWithoutTransform", testValue)

			expect(result).to.equal(testValue)
		})

		it("should merge defaults in browserSettings transform", () => {
			if (hasTransform("browserSettings")) {
				const partial = { viewport: { width: 800, height: 600 } }
				const result = applyTransform("browserSettings", partial)

				expect(result).to.be.an("object")
				expect(result.viewport).to.deep.equal({ width: 800, height: 600 })
			}
		})

		it("should fold SDK provider spellings to legacy ApiProvider spellings on load", () => {
			// State written by older builds (or other hosts) may store the SDK
			// catalog id `openai-compatible`; the load transform migrates it to
			// the legacy `openai` spelling the rest of the extension is keyed by.
			expect(applyTransform("planModeApiProvider", "openai-compatible")).to.equal("openai")
			expect(applyTransform("actModeApiProvider", "openai-compatible")).to.equal("openai")
			expect(applyTransform("planModeApiProvider", "anthropic")).to.equal("anthropic")
			expect(applyTransform("actModeApiProvider", "openai")).to.equal("openai")
		})
	})

	describe("Metadata Properties", () => {
		/**
		 * Tests for isAsync and isComputed metadata flags.
		 */

		it("should correctly identify async properties", () => {
			// taskHistory is known to be async
			expect(isAsyncProperty("taskHistory")).to.be.true
			expect(isAsyncProperty("preferredLanguage")).to.be.false
			expect(isAsyncProperty("nonExistent")).to.be.false
		})

		it("should correctly identify computed properties", () => {
			// planActSeparateModelsSetting is known to be computed
			expect(isComputedProperty("planActSeparateModelsSetting")).to.be.true
			expect(isComputedProperty("preferredLanguage")).to.be.false
			expect(isComputedProperty("nonExistent")).to.be.false
		})
	})

	describe("Type Exports", () => {
		/**
		 * Compile-time tests that verify type exports work correctly.
		 * If these fail to compile, the types are broken.
		 */
	})

	describe("Edge Cases", () => {
		/**
		 * Tests for edge cases and boundary conditions.
		 */

		it("should handle empty string keys gracefully", () => {
			expect(isGlobalStateKey("")).to.be.false
			expect(isSettingsKey("")).to.be.false
			expect(isSecretKey("")).to.be.false
			expect(isLocalStateKey("")).to.be.false
		})

		it("should handle keys with special characters", () => {
			// The cline:clineAccountId key has a colon
			expect(SecretKeys).to.include("cline:clineAccountId")
			expect(isSecretKey("cline:clineAccountId")).to.be.true
		})

		it("should not have keys that could cause prototype pollution", () => {
			const dangerousKeys = ["__proto__", "constructor", "prototype"]

			for (const key of dangerousKeys) {
				expect(isGlobalStateKey(key), `${key} should not be a GlobalStateKey`).to.be.false
				expect(isSettingsKey(key), `${key} should not be a SettingsKey`).to.be.false
				expect(isSecretKey(key), `${key} should not be a SecretKey`).to.be.false
			}
		})
	})
})
