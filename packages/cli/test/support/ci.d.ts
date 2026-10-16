import { type ApprovalRecord, type BundleManifest, type CheckResultRecord, type LockRecord } from '../../src/index.js';
import { type Fixture } from './repo.js';
/** The locked test command in CI fixtures: quick, and it writes a JSON report as vitest does. */
export declare const TEST_COMMAND = "node run-tests.mjs --locked";
/** A fixture project: one locked test, a lockfile, a runner script and application code. */
export declare const CI_FILES: Record<string, string>;
/** Story one's file in CI fixtures: its locked test, its scope, and one input. */
export declare const STORY_TEXT: string;
export declare const STORY_FILES: Record<string, string>;
export interface CiFixture extends Fixture {
    main: string;
}
/** The CI fixture project; with `story`, main also holds a build plan and story one. */
export declare function ciProject(options?: {
    recordsBranch?: boolean;
    story?: boolean;
}): CiFixture;
/** Plants a gate-3 approval binding the build plan and story files as main holds them now. */
export declare function plantGate3(f: CiFixture, files?: Record<string, string>): ApprovalRecord;
export declare function treeAt(f: Fixture, commit: string): string;
/** Plants a lock over the fixture's locked files on main, as `lock` writes it. */
export declare function plantLock(f: CiFixture, testCommands?: string[]): LockRecord;
/** A merge approval for pull request `pr` bound to `tree`. */
export declare function mergeApproval(kind: 'story' | 'bootstrap', pr: number, tree: string): ApprovalRecord;
/** Plants a merge approval for pull request `pr` bound to `tree`. */
export declare function plantApproval(f: Fixture, kind: 'story' | 'bootstrap', pr: number, tree: string, options?: {
    by?: 'runner';
}): ApprovalRecord;
/** Plants a verify check result for pull request `pr` bound to `tree`, committed as CI does. */
export declare function plantVerify(f: Fixture, pr: number, tree: string, options?: {
    outcome?: 'pass' | 'fail';
    by?: 'runner' | 'human';
}): CheckResultRecord;
export interface JobRun {
    status: number | null;
    out: string;
    err: string;
}
/** Runs `pod-factory ci <job>` as the check runner, from the enforcing copy `cwd`. */
export declare function job(cwd: string, args: string[], extraEnv?: Record<string, string>): JobRun;
/** A checkout of pull request `pr`'s head, as the verify job's subject directory. */
export declare function subjectAt(f: Fixture, pr: number, name?: string): string;
export declare function readManifest(bundle: string): BundleManifest;
export declare const CONFIG = "packages/cli/vitest.config.ts";
export declare const CONFIG_V0: string;
export declare const CONFIG_V1 = "export default { amended: 1 };\n";
export declare const CONFIG_V2 = "export default { amended: 2 };\n";
/** A locked project whose story one may change the locked runner configuration. */
export declare function amendableProject(): {
    f: CiFixture;
    lock: LockRecord;
};
/** An amendment approval for the runner configuration, as `approve amendment` writes it. */
export declare function plantAmendment(f: CiFixture, lock: LockRecord, pr: number, tree: string, before: string, after: string): ApprovalRecord;
/** Pull request `pr` changing the configuration from `before` to `after`, amended, approved and verified. */
export declare function amendedPullRequest(f: CiFixture, lock: LockRecord, pr: number, before: string, after: string): {
    head: string;
    amendment: ApprovalRecord;
};
export declare const ciCheck: (f: CiFixture, name: "gate-check" | "lock-guard", pr: number, head: string) => JobRun;
/** Pull request `pr` with `files`, approved for story one and verified, with no amendment. */
export declare function approvedChange(f: CiFixture, pr: number, files: Record<string, string | null>): string;
