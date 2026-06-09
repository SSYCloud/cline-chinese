export type Disposable = (() => void | Promise<void>) | {
    dispose: () => void | Promise<void>;
};
/**
 * Register a disposable to be cleaned up when `disposeAll()` is called.
 * Accepts either a function or an object with a `dispose` method.
 */
export declare function registerDisposable(disposable: Disposable): void;
/**
 * Dispose all registered disposables in registration order.
 * Errors from individual disposables are suppressed so all run.
 */
export declare function disposeAll(): Promise<void>;
