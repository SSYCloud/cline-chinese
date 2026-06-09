/**
 * Model Schema Definitions
 *
 * Re-exports model info types from @coohu/shared (canonical source)
 * and defines provider-level schemas local to @coohu/llms.
 */
import { z } from "zod";
export { ApiFormat, ApiFormatSchema, type ModelCapability, ModelCapabilitySchema, type ModelInfo, ModelInfoSchema, type ModelMetadata, ModelMetadataSchema, type ModelPricing, ModelPricingSchema, type ModelStatus, ModelStatusSchema, type ThinkingConfig, ThinkingConfigSchema, } from "@coohu/shared";
import { ProviderCapabilitySchema } from "@coohu/shared";
export declare const ModelEntrySchema: z.ZodObject<{
    id: z.ZodString;
    info: z.ZodObject<{
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
}, z.core.$strip>;
export type ModelEntry = z.infer<typeof ModelEntrySchema>;
export type ProviderCapability = z.infer<typeof ProviderCapabilitySchema>;
export declare const ProviderProtocolSchema: z.ZodEnum<{
    "openai-responses": "openai-responses";
    anthropic: "anthropic";
    gemini: "gemini";
    "openai-chat": "openai-chat";
    "openai-r1": "openai-r1";
    "ai-sdk": "ai-sdk";
}>;
declare const ProviderClientSchema: z.ZodEnum<{
    custom: "custom";
    anthropic: "anthropic";
    gemini: "gemini";
    "openai-r1": "openai-r1";
    "ai-sdk": "ai-sdk";
    "ai-sdk-community": "ai-sdk-community";
    openai: "openai";
    "openai-compatible": "openai-compatible";
    bedrock: "bedrock";
    fetch: "fetch";
    vertex: "vertex";
}>;
/**
 * ProviderSource indicates how a provider was added to the system,
 * which can be useful for determining trust level and whether to prompt the user for confirmation before using it.
 * For example, providers with source "system" are built-in and can be trusted,
 * while providers with source "file" were added by the user using a local JSON file,
 * and providers with source "discovery" were found through network discovery.
 */
declare const ProviderSourceSchema: z.ZodEnum<{
    file: "file";
    system: "system";
    discovery: "discovery";
}>;
export type ProviderClient = z.infer<typeof ProviderClientSchema>;
export type ProviderProtocol = z.infer<typeof ProviderProtocolSchema>;
export type ProviderSource = z.infer<typeof ProviderSourceSchema>;
export declare const ProviderInfoSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    protocol: z.ZodOptional<z.ZodEnum<{
        "openai-responses": "openai-responses";
        anthropic: "anthropic";
        gemini: "gemini";
        "openai-chat": "openai-chat";
        "openai-r1": "openai-r1";
        "ai-sdk": "ai-sdk";
    }>>;
    baseUrl: z.ZodOptional<z.ZodString>;
    modelsSourceUrl: z.ZodOptional<z.ZodString>;
    defaultModelId: z.ZodString;
    capabilities: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        tools: "tools";
        streaming: "streaming";
        "prompt-cache": "prompt-cache";
        reasoning: "reasoning";
        "computer-use": "computer-use";
        temperature: "temperature";
        files: "files";
        "provider-tools": "provider-tools";
        oauth: "oauth";
        vision: "vision";
        "local-auth": "local-auth";
        popular: "popular";
    }>>>;
    env: z.ZodOptional<z.ZodArray<z.ZodString>>;
    client: z.ZodEnum<{
        custom: "custom";
        anthropic: "anthropic";
        gemini: "gemini";
        "openai-r1": "openai-r1";
        "ai-sdk": "ai-sdk";
        "ai-sdk-community": "ai-sdk-community";
        openai: "openai";
        "openai-compatible": "openai-compatible";
        bedrock: "bedrock";
        fetch: "fetch";
        vertex: "vertex";
    }>;
    source: z.ZodDefault<z.ZodEnum<{
        file: "file";
        system: "system";
        discovery: "discovery";
    }>>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type ProviderInfo = z.infer<typeof ProviderInfoSchema>;
export declare const ModelCollectionSchema: z.ZodObject<{
    provider: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        protocol: z.ZodOptional<z.ZodEnum<{
            "openai-responses": "openai-responses";
            anthropic: "anthropic";
            gemini: "gemini";
            "openai-chat": "openai-chat";
            "openai-r1": "openai-r1";
            "ai-sdk": "ai-sdk";
        }>>;
        baseUrl: z.ZodOptional<z.ZodString>;
        modelsSourceUrl: z.ZodOptional<z.ZodString>;
        defaultModelId: z.ZodString;
        capabilities: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            tools: "tools";
            streaming: "streaming";
            "prompt-cache": "prompt-cache";
            reasoning: "reasoning";
            "computer-use": "computer-use";
            temperature: "temperature";
            files: "files";
            "provider-tools": "provider-tools";
            oauth: "oauth";
            vision: "vision";
            "local-auth": "local-auth";
            popular: "popular";
        }>>>;
        env: z.ZodOptional<z.ZodArray<z.ZodString>>;
        client: z.ZodEnum<{
            custom: "custom";
            anthropic: "anthropic";
            gemini: "gemini";
            "openai-r1": "openai-r1";
            "ai-sdk": "ai-sdk";
            "ai-sdk-community": "ai-sdk-community";
            openai: "openai";
            "openai-compatible": "openai-compatible";
            bedrock: "bedrock";
            fetch: "fetch";
            vertex: "vertex";
        }>;
        source: z.ZodDefault<z.ZodEnum<{
            file: "file";
            system: "system";
            discovery: "discovery";
        }>>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>;
    models: z.ZodRecord<z.ZodString, z.ZodObject<{
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
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ModelCollection = z.infer<typeof ModelCollectionSchema>;
