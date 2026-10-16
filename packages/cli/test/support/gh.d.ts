export interface FakePull {
    state: 'OPEN' | 'CLOSED' | 'MERGED';
    head: string;
}
export interface FakeState {
    /** Every call fails, as gh does when it is logged out or GitHub is unreachable. */
    fail?: boolean;
    pulls: Record<string, FakePull>;
    /** Branch protection by branch name, as the API returns it; absent means not protected. */
    protection?: Record<string, unknown>;
}
export interface FakeGitHub {
    /** Environment for a process that should find this fake as `gh`. */
    env: Record<string, string>;
    set(state: FakeState): void;
    /** Every call so far, as its argument list. */
    calls(): string[][];
}
/** A fake GitHub CLI on PATH, answering from a state file and logging its calls. */
export declare function fakeGitHub(initial?: FakeState): FakeGitHub;
