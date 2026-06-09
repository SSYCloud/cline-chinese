/**
 * Model Information Types
 *
 * Zod schemas and inferred types for model capabilities, pricing,
 * and metadata. These live in shared so that agent types can reference
 * ModelInfo without depending on @coohu/llms.
 */
import { z } from "zod";
export declare const ApiFormatSchema: z.ZodEnum<{
    default: "default";
    "openai-responses": "openai-responses";
    r1: "r1";
}>;
export type ApiFormat = z.infer<typeof ApiFormatSchema>;
export declare const ApiFormat: {
    readonly DEFAULT: "default";
    readonly OPENAI_RESPONSES: "openai-responses";
    readonly R1: "r1";
};
export declare const ModelCapabilitySchema: z.ZodEnum<{
    images: "images";
    tools: "tools";
    streaming: "streaming";
    "prompt-cache": "prompt-cache";
    reasoning: "reasoning";
    "reasoning-effort": "reasoning-effort";
    "computer-use": "computer-use";
    "global-endpoint": "global-endpoint";
    structured_output: "structured_output";
    temperature: "temperature";
    files: "files";
}>;
export type ModelCapability = z.infer<typeof ModelCapabilitySchema>;
export declare const ModelStatusSchema: z.ZodEnum<{
    active: "active";
    preview: "preview";
    deprecated: "deprecated";
    legacy: "legacy";
}>;
export type ModelStatus = z.infer<typeof ModelStatusSchema>;
export declare const ModelPricingSchema: z.ZodObject<{
    input: z.ZodOptional<z.ZodNumber>;
    output: z.ZodOptional<z.ZodNumber>;
    cacheWrite: z.ZodOptional<z.ZodNumber>;
    cacheRead: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type ModelPricing = z.infer<typeof ModelPricingSchema>;
export declare const ThinkingConfigSchema: z.ZodObject<{
    maxBudget: z.ZodOptional<z.ZodNumber>;
    outputPrice: z.ZodOptional<z.ZodNumber>;
    thinkingLevel: z.ZodOptional<z.ZodEnum<{
        low: "low";
        high: "high";
    }>>;
}, z.core.$strip>;
export type ThinkingConfig = z.infer<typeof ThinkingConfigSchema>;
export declare const ModelMetadataSchema: z.ZodObject<{
    reasoningDefaultOn: z.ZodOptional<z.ZodBoolean>;
}, z.core.$catchall<z.ZodUnknown>>;
export type ModelMetadata = z.infer<typeof ModelMetadataSchema>;
export declare const ModelInfoSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    contextWindow: z.ZodOptional<z.ZodNumber>;
    maxInputTokens: z.ZodOptional<z.ZodNumber>;
    capabilities: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        images: "images";
        tools: "tools";
        streaming: "streaming";
        "prompt-cache": "prompt-cache";
        reasoning: "reasoning";
        "reasoning-effort": "reasoning-effort";
        "computer-use": "computer-use";
        "global-endpoint": "global-endpoint";
        structured_output: "structured_output";
        temperature: "temperature";
        files: "files";
    }>>>;
    apiFormat: z.ZodOptional<z.ZodEnum<{
        default: "default";
        "openai-responses": "openai-responses";
        r1: "r1";
    }>>;
    systemRole: z.ZodOptional<z.ZodEnum<{
        system: "system";
        developer: "developer";
    }>>;
    temperature: z.ZodOptional<z.ZodNumber>;
    pricing: z.ZodOptional<z.ZodObject<{
        input: z.ZodOptional<z.ZodNumber>;
        output: z.ZodOptional<z.ZodNumber>;
        cacheWrite: z.ZodOptional<z.ZodNumber>;
        cacheRead: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    thinkingConfig: z.ZodOptional<z.ZodObject<{
        maxBudget: z.ZodOptional<z.ZodNumber>;
        outputPrice: z.ZodOptional<z.ZodNumber>;
        thinkingLevel: z.ZodOptional<z.ZodEnum<{
            low: "low";
            high: "high";
        }>>;
    }, z.core.$strip>>;
    status: z.ZodOptional<z.ZodEnum<{
        active: "active";
        preview: "preview";
        deprecated: "deprecated";
        legacy: "legacy";
    }>>;
    deprecationNotice: z.ZodOptional<z.ZodString>;
    replacedBy: z.ZodOptional<z.ZodString>;
    releaseDate: z.ZodOptional<z.ZodString>;
    deprecationDate: z.ZodOptional<z.ZodString>;
    family: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodObject<{
        reasoningDefaultOn: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$catchall<z.ZodUnknown>>>;
}, z.core.$strip>;
export type ModelInfo = z.infer<typeof ModelInfoSchema>;
