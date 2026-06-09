export declare const REASONING_EFFORT_RATIOS: {
    readonly xhigh: 0.95;
    readonly high: 0.8;
    readonly medium: 0.5;
    readonly low: 0.2;
    readonly minimal: 0.1;
    readonly none: 0;
};
export type ReasoningEffortValue = keyof typeof REASONING_EFFORT_RATIOS;
export declare const DEFAULT_REASONING_EFFORT: ReasoningEffortValue | undefined;
export declare function resolveEffectiveReasoningEffort(reasoningEffort?: string, thinking?: boolean): ReasoningEffortValue | undefined;
export declare function resolveReasoningEffortRatio(effort?: string, options?: {
    fallbackEffort?: ReasoningEffortValue;
}): number | undefined;
export declare function resolveReasoningBudgetFromRatio(options: {
    effort?: string;
    maxBudget: number;
    scaleTokens?: number;
    minimumBudget?: number;
    fallbackEffort?: ReasoningEffortValue;
}): number | undefined;
