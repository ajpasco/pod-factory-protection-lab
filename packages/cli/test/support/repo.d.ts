export declare function tempDir(): string;
export declare function sh(cwd: string, args: string[], input?: string): string;
export declare const BRANCH = "pod-factory/records";
export declare const RUNNER_NAME = "github-actions[bot]";
export declare const RUNNER_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";
export interface Fixture {
    root: string;
    /** The bare repository every clone pushes to. */
    remote: string;
    /** A clone with main checked out, as a project working copy would be. */
    work: string;
    /** Another clone of the same remote. */
    clone(name: string): string;
    /**
     * Commits raw file changes to the records branch, bypassing pod-factory (null deletes). With
     * `by: 'runner'` the commit is made as the Actions bot, as CI's record-writing job makes it.
     */
    plant(files: Record<string, string | null>, message?: string, options?: {
        by?: 'runner';
    }): string;
    /** Every file on the remote records branch. */
    filesOnBranch(): string[];
    /** Number of commits on the remote records branch. */
    commitCount(): number;
    /** Commits file changes to main on the remote (null deletes) and returns the commit. */
    commitToMain(files: Record<string, string | null>, message?: string): string;
    /** Publishes main plus `files` as refs/pull/<n>/head, as GitHub does, and returns the commit. */
    pullRequest(n: number, files: Record<string, string | null>): string;
}
/** A bare remote with a main branch and, unless told otherwise, an empty records branch. */
export declare function fixture(options?: {
    recordsBranch?: boolean;
}): Fixture;
/** Installs a pre-push hook in `clone` that runs `script` once, on the first push only. */
export declare function prePushOnce(clone: string, script: string): void;
