export declare const CLINE_BUILD_ENV_ENV = "CLINE_BUILD_ENV";
export declare const CLINE_DEBUG_HOST_ENV = "CLINE_DEBUG_HOST";
export declare const CLINE_DEBUG_PORT_BASE_ENV = "CLINE_DEBUG_PORT_BASE";
export type ClineBuildEnv = "development" | "production";
export type ClineDebugRole = "rpc" | "hook" | "plugin-sandbox" | "connector" | "sandbox";
export interface ResolveClineBuildEnvOptions {
    env?: NodeJS.ProcessEnv;
    execArgv?: string[];
    debugRole?: ClineDebugRole;
}
export declare function resolveClineBuildEnv(options?: ResolveClineBuildEnvOptions): ClineBuildEnv;
export declare function withResolvedClineBuildEnv(env?: NodeJS.ProcessEnv, options?: Omit<ResolveClineBuildEnvOptions, "env">): NodeJS.ProcessEnv;
export declare function augmentNodeCommandForDebug(command: string[], options?: ResolveClineBuildEnvOptions): string[];
