/**
 * Resolve a possibly-mangled file path to an actual on-disk entry.
 *
 * Returns the literal path when it already exists; otherwise tries a small
 * set of macOS-specific variants (narrow no-break space before AM/PM, NFD
 * normalization, curly apostrophe) before falling back to a parent-directory
 * scan that compares filenames after collapsing exotic Unicode whitespace.
 *
 * Returns `undefined` when no matching file can be located.
 */
export declare function resolveExistingFilePath(filePath: string): string | undefined;
