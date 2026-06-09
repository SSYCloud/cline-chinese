/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️  CRITICAL WARNING ⚠️
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE API SERVER MUST BE RE-DEPLOYED WHENEVER THIS SCHEMA IS UPDATED!
 *
 * This schema is used by both the extension and the API server for validation.
 * Any changes here require a coordinated deployment to avoid validation errors.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
export declare const OpenAiCompatibleModelSchema: z.ZodObject<{
    id: z.ZodString;
    temperature: z.ZodOptional<z.ZodNumber>;
    isR1FormatRequired: z.ZodOptional<z.ZodBoolean>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    contextWindow: z.ZodOptional<z.ZodNumber>;
    inputPrice: z.ZodOptional<z.ZodNumber>;
    outputPrice: z.ZodOptional<z.ZodNumber>;
    supportsImages: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const OpenAiCompatibleSchema: z.ZodObject<{
    models: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        temperature: z.ZodOptional<z.ZodNumber>;
        isR1FormatRequired: z.ZodOptional<z.ZodBoolean>;
        maxTokens: z.ZodOptional<z.ZodNumber>;
        contextWindow: z.ZodOptional<z.ZodNumber>;
        inputPrice: z.ZodOptional<z.ZodNumber>;
        outputPrice: z.ZodOptional<z.ZodNumber>;
        supportsImages: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>>;
    openAiBaseUrl: z.ZodOptional<z.ZodString>;
    openAiHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    azureApiVersion: z.ZodOptional<z.ZodString>;
    azureIdentity: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const AwsBedrockModelSchema: z.ZodObject<{
    id: z.ZodString;
    thinkingBudgetTokens: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const AwsBedrockCustomModelSchema: z.ZodObject<{
    name: z.ZodString;
    baseModelId: z.ZodString;
    thinkingBudgetTokens: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const AwsBedrockSettingsSchema: z.ZodObject<{
    models: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        thinkingBudgetTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>>;
    customModels: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        baseModelId: z.ZodString;
        thinkingBudgetTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>>;
    awsRegion: z.ZodOptional<z.ZodString>;
    awsUseCrossRegionInference: z.ZodOptional<z.ZodBoolean>;
    awsUseGlobalInference: z.ZodOptional<z.ZodBoolean>;
    awsBedrockUsePromptCache: z.ZodOptional<z.ZodBoolean>;
    awsBedrockEndpoint: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const ClineModelSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strip>;
export declare const ClineSettingsSchema: z.ZodObject<{
    models: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export declare const VertexModelSchema: z.ZodObject<{
    id: z.ZodString;
    thinkingBudgetTokens: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const VertexSettingsSchema: z.ZodObject<{
    models: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        thinkingBudgetTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>>;
    vertexProjectId: z.ZodOptional<z.ZodString>;
    vertexRegion: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const LiteLLMModelSchema: z.ZodObject<{
    id: z.ZodString;
    thinkingBudgetTokens: z.ZodOptional<z.ZodNumber>;
    promptCachingEnabled: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const LiteLLMSchema: z.ZodObject<{
    models: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        thinkingBudgetTokens: z.ZodOptional<z.ZodNumber>;
        promptCachingEnabled: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>>;
    baseUrl: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const AnthropicModelSchema: z.ZodObject<{
    id: z.ZodString;
    thinkingBudgetTokens: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const AnthropicSchema: z.ZodObject<{
    models: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        thinkingBudgetTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>>;
    baseUrl: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
declare const ProviderSettingsSchema: z.ZodObject<{
    OpenAiCompatible: z.ZodOptional<z.ZodObject<{
        models: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            temperature: z.ZodOptional<z.ZodNumber>;
            isR1FormatRequired: z.ZodOptional<z.ZodBoolean>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            contextWindow: z.ZodOptional<z.ZodNumber>;
            inputPrice: z.ZodOptional<z.ZodNumber>;
            outputPrice: z.ZodOptional<z.ZodNumber>;
            supportsImages: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>>;
        openAiBaseUrl: z.ZodOptional<z.ZodString>;
        openAiHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        azureApiVersion: z.ZodOptional<z.ZodString>;
        azureIdentity: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    AwsBedrock: z.ZodOptional<z.ZodObject<{
        models: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            thinkingBudgetTokens: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>>;
        customModels: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            baseModelId: z.ZodString;
            thinkingBudgetTokens: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>>;
        awsRegion: z.ZodOptional<z.ZodString>;
        awsUseCrossRegionInference: z.ZodOptional<z.ZodBoolean>;
        awsUseGlobalInference: z.ZodOptional<z.ZodBoolean>;
        awsBedrockUsePromptCache: z.ZodOptional<z.ZodBoolean>;
        awsBedrockEndpoint: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    Cline: z.ZodOptional<z.ZodObject<{
        models: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
    Vertex: z.ZodOptional<z.ZodObject<{
        models: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            thinkingBudgetTokens: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>>;
        vertexProjectId: z.ZodOptional<z.ZodString>;
        vertexRegion: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    LiteLLM: z.ZodOptional<z.ZodObject<{
        models: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            thinkingBudgetTokens: z.ZodOptional<z.ZodNumber>;
            promptCachingEnabled: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>>;
        baseUrl: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    Anthropic: z.ZodOptional<z.ZodObject<{
        models: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            thinkingBudgetTokens: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>>;
        baseUrl: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const AllowedMCPServerSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strip>;
export declare const RemoteMCPServerSchema: z.ZodObject<{
    name: z.ZodString;
    url: z.ZodString;
    alwaysEnabled: z.ZodOptional<z.ZodBoolean>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strip>;
export declare const GlobalInstructionsFileSchema: z.ZodObject<{
    alwaysEnabled: z.ZodBoolean;
    name: z.ZodString;
    contents: z.ZodString;
}, z.core.$strip>;
export declare const S3AccessKeySettingsSchema: z.ZodObject<{
    bucket: z.ZodString;
    accessKeyId: z.ZodString;
    secretAccessKey: z.ZodString;
    region: z.ZodOptional<z.ZodString>;
    endpoint: z.ZodOptional<z.ZodString>;
    accountId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const PromptUploadingSchema: z.ZodObject<{
    enabled: z.ZodOptional<z.ZodBoolean>;
    type: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"s3_access_keys">, z.ZodLiteral<"r2_access_keys">, z.ZodLiteral<"azure_access_keys">]>>;
    s3AccessSettings: z.ZodOptional<z.ZodObject<{
        bucket: z.ZodString;
        accessKeyId: z.ZodString;
        secretAccessKey: z.ZodString;
        region: z.ZodOptional<z.ZodString>;
        endpoint: z.ZodOptional<z.ZodString>;
        accountId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    r2AccessSettings: z.ZodOptional<z.ZodObject<{
        bucket: z.ZodString;
        accessKeyId: z.ZodString;
        secretAccessKey: z.ZodString;
        region: z.ZodOptional<z.ZodString>;
        endpoint: z.ZodOptional<z.ZodString>;
        accountId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    azureAccessSettings: z.ZodOptional<z.ZodObject<{
        bucket: z.ZodString;
        accessKeyId: z.ZodString;
        secretAccessKey: z.ZodString;
        region: z.ZodOptional<z.ZodString>;
        endpoint: z.ZodOptional<z.ZodString>;
        accountId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const EnterpriseTelemetrySchema: z.ZodObject<{
    promptUploading: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodOptional<z.ZodBoolean>;
        type: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"s3_access_keys">, z.ZodLiteral<"r2_access_keys">, z.ZodLiteral<"azure_access_keys">]>>;
        s3AccessSettings: z.ZodOptional<z.ZodObject<{
            bucket: z.ZodString;
            accessKeyId: z.ZodString;
            secretAccessKey: z.ZodString;
            region: z.ZodOptional<z.ZodString>;
            endpoint: z.ZodOptional<z.ZodString>;
            accountId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        r2AccessSettings: z.ZodOptional<z.ZodObject<{
            bucket: z.ZodString;
            accessKeyId: z.ZodString;
            secretAccessKey: z.ZodString;
            region: z.ZodOptional<z.ZodString>;
            endpoint: z.ZodOptional<z.ZodString>;
            accountId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        azureAccessSettings: z.ZodOptional<z.ZodObject<{
            bucket: z.ZodString;
            accessKeyId: z.ZodString;
            secretAccessKey: z.ZodString;
            region: z.ZodOptional<z.ZodString>;
            endpoint: z.ZodOptional<z.ZodString>;
            accountId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const RemoteConfigSchema: z.ZodObject<{
    version: z.ZodString;
    providerSettings: z.ZodOptional<z.ZodObject<{
        OpenAiCompatible: z.ZodOptional<z.ZodObject<{
            models: z.ZodOptional<z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                temperature: z.ZodOptional<z.ZodNumber>;
                isR1FormatRequired: z.ZodOptional<z.ZodBoolean>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                contextWindow: z.ZodOptional<z.ZodNumber>;
                inputPrice: z.ZodOptional<z.ZodNumber>;
                outputPrice: z.ZodOptional<z.ZodNumber>;
                supportsImages: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>>>;
            openAiBaseUrl: z.ZodOptional<z.ZodString>;
            openAiHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            azureApiVersion: z.ZodOptional<z.ZodString>;
            azureIdentity: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>;
        AwsBedrock: z.ZodOptional<z.ZodObject<{
            models: z.ZodOptional<z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                thinkingBudgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>>;
            customModels: z.ZodOptional<z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                baseModelId: z.ZodString;
                thinkingBudgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>>;
            awsRegion: z.ZodOptional<z.ZodString>;
            awsUseCrossRegionInference: z.ZodOptional<z.ZodBoolean>;
            awsUseGlobalInference: z.ZodOptional<z.ZodBoolean>;
            awsBedrockUsePromptCache: z.ZodOptional<z.ZodBoolean>;
            awsBedrockEndpoint: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        Cline: z.ZodOptional<z.ZodObject<{
            models: z.ZodOptional<z.ZodArray<z.ZodObject<{
                id: z.ZodString;
            }, z.core.$strip>>>;
        }, z.core.$strip>>;
        Vertex: z.ZodOptional<z.ZodObject<{
            models: z.ZodOptional<z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                thinkingBudgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>>;
            vertexProjectId: z.ZodOptional<z.ZodString>;
            vertexRegion: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        LiteLLM: z.ZodOptional<z.ZodObject<{
            models: z.ZodOptional<z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                thinkingBudgetTokens: z.ZodOptional<z.ZodNumber>;
                promptCachingEnabled: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>>>;
            baseUrl: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        Anthropic: z.ZodOptional<z.ZodObject<{
            models: z.ZodOptional<z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                thinkingBudgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>>;
            baseUrl: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    telemetryEnabled: z.ZodOptional<z.ZodBoolean>;
    kanbanEnabled: z.ZodOptional<z.ZodBoolean>;
    mcpMarketplaceEnabled: z.ZodOptional<z.ZodBoolean>;
    allowedMCPServers: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
    }, z.core.$strip>>>;
    remoteMCPServers: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        url: z.ZodString;
        alwaysEnabled: z.ZodOptional<z.ZodBoolean>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>>>;
    blockPersonalRemoteMCPServers: z.ZodOptional<z.ZodBoolean>;
    yoloModeAllowed: z.ZodOptional<z.ZodBoolean>;
    openTelemetryEnabled: z.ZodOptional<z.ZodBoolean>;
    openTelemetryMetricsExporter: z.ZodOptional<z.ZodString>;
    openTelemetryLogsExporter: z.ZodOptional<z.ZodString>;
    openTelemetryOtlpProtocol: z.ZodOptional<z.ZodString>;
    openTelemetryOtlpEndpoint: z.ZodOptional<z.ZodString>;
    openTelemetryOtlpHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    openTelemetryOtlpMetricsProtocol: z.ZodOptional<z.ZodString>;
    openTelemetryOtlpMetricsEndpoint: z.ZodOptional<z.ZodString>;
    openTelemetryOtlpMetricsHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    openTelemetryOtlpLogsProtocol: z.ZodOptional<z.ZodString>;
    openTelemetryOtlpLogsEndpoint: z.ZodOptional<z.ZodString>;
    openTelemetryOtlpLogsHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    openTelemetryMetricExportInterval: z.ZodOptional<z.ZodNumber>;
    openTelemetryOtlpInsecure: z.ZodOptional<z.ZodBoolean>;
    openTelemetryLogBatchSize: z.ZodOptional<z.ZodNumber>;
    openTelemetryLogBatchTimeout: z.ZodOptional<z.ZodNumber>;
    openTelemetryLogMaxQueueSize: z.ZodOptional<z.ZodNumber>;
    enterpriseTelemetry: z.ZodOptional<z.ZodObject<{
        promptUploading: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodOptional<z.ZodBoolean>;
            type: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"s3_access_keys">, z.ZodLiteral<"r2_access_keys">, z.ZodLiteral<"azure_access_keys">]>>;
            s3AccessSettings: z.ZodOptional<z.ZodObject<{
                bucket: z.ZodString;
                accessKeyId: z.ZodString;
                secretAccessKey: z.ZodString;
                region: z.ZodOptional<z.ZodString>;
                endpoint: z.ZodOptional<z.ZodString>;
                accountId: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            r2AccessSettings: z.ZodOptional<z.ZodObject<{
                bucket: z.ZodString;
                accessKeyId: z.ZodString;
                secretAccessKey: z.ZodString;
                region: z.ZodOptional<z.ZodString>;
                endpoint: z.ZodOptional<z.ZodString>;
                accountId: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            azureAccessSettings: z.ZodOptional<z.ZodObject<{
                bucket: z.ZodString;
                accessKeyId: z.ZodString;
                secretAccessKey: z.ZodString;
                region: z.ZodOptional<z.ZodString>;
                endpoint: z.ZodOptional<z.ZodString>;
                accountId: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    globalRules: z.ZodOptional<z.ZodArray<z.ZodObject<{
        alwaysEnabled: z.ZodBoolean;
        name: z.ZodString;
        contents: z.ZodString;
    }, z.core.$strip>>>;
    globalWorkflows: z.ZodOptional<z.ZodArray<z.ZodObject<{
        alwaysEnabled: z.ZodBoolean;
        name: z.ZodString;
        contents: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export declare const APIKeySchema: z.ZodRecord<z.ZodString, z.ZodString>;
export type RemoteConfig = z.infer<typeof RemoteConfigSchema>;
export type MCPServer = z.infer<typeof AllowedMCPServerSchema>;
export type RemoteMCPServer = z.infer<typeof RemoteMCPServerSchema>;
export type GlobalInstructionsFile = z.infer<typeof GlobalInstructionsFileSchema>;
export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;
export type OpenAiCompatible = z.infer<typeof OpenAiCompatibleSchema>;
export type OpenAiCompatibleModel = z.infer<typeof OpenAiCompatibleModelSchema>;
export type AwsBedrockSettings = z.infer<typeof AwsBedrockSettingsSchema>;
export type AwsBedrockModel = z.infer<typeof AwsBedrockModelSchema>;
export type AwsBedrockCustomModel = z.infer<typeof AwsBedrockCustomModelSchema>;
export type VertexSettings = z.infer<typeof VertexSettingsSchema>;
export type VertexModel = z.infer<typeof VertexModelSchema>;
export type LiteLLMSettings = z.infer<typeof LiteLLMSchema>;
export type LiteLLMModel = z.infer<typeof LiteLLMModelSchema>;
export type AnthropicSettings = z.infer<typeof AnthropicSchema>;
export type AnthropicModel = z.infer<typeof AnthropicModelSchema>;
export type APIKeySettings = z.infer<typeof APIKeySchema>;
export type EnterpriseTelemetry = z.infer<typeof EnterpriseTelemetrySchema>;
export type PromptUploading = z.infer<typeof PromptUploadingSchema>;
export type S3AccessKeySettings = z.infer<typeof S3AccessKeySettingsSchema>;
export {};
