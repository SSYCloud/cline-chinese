export type SqliteStatement = {
    run: (...params: unknown[]) => {
        changes?: number;
    };
    get: (...params: unknown[]) => Record<string, unknown> | null;
    all: (...params: unknown[]) => Record<string, unknown>[];
};
export type SqliteDb = {
    prepare: (sql: string) => SqliteStatement;
    exec: (sql: string) => void;
    close?: () => void;
};
export declare function nowIso(): string;
export declare function toBoolInt(value: boolean): number;
export declare function asString(value: unknown): string;
export declare function asOptionalString(value: unknown): string | undefined;
export declare function asBool(value: unknown): boolean;
export declare function isSqliteBusyError(error: unknown): boolean;
export declare function withSqliteBusyRetry<T>(operation: () => T): T;
export declare function loadSqliteDb(filePath: string): SqliteDb;
export interface SessionSchemaOptions {
    includeLegacyMigrations?: boolean;
}
export declare function ensureSessionSchema(db: SqliteDb, options?: SessionSchemaOptions): void;
