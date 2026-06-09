/**
 * Zod Utilities
 *
 * Helper functions for working with Zod schemas.
 */
import { z } from "zod";
/**
 * Validate input using a Zod schema
 * Throws a formatted error if validation fails
 */
export declare function validateWithZod<T>(
	schema: z.ZodType<T>,
	input: unknown,
): T;
export declare function zodToJsonSchema(
	schema: z.ZodTypeAny,
): Record<string, unknown>;
