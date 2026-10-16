import { recordBase, serializeRecord, recordFileName, } from '../../src/index.js';
export const HUMAN = { name: 'Test Human', email: 'human@example.test', kind: 'human' };
export const AGENT = { name: 'Test Human', email: 'human@example.test', kind: 'agent' };
export const RUNNER = {
    name: 'github-actions[bot]',
    email: '41898282+github-actions[bot]@users.noreply.github.com',
    kind: 'check-runner',
};
export const SHA_A = 'a'.repeat(64);
export const SHA_B = 'b'.repeat(64);
export const TREE = 'c'.repeat(40);
export function gateApproval() {
    return {
        ...recordBase(HUMAN),
        recordType: 'approval',
        binds: { tree: null, files: { 'docs/PRD.md': SHA_A, 'docs/TECH-SPEC.md': SHA_B } },
        outcome: 'approved',
        refs: [],
        approval: {
            kind: 'gate',
            gate: 2,
            story: null,
            pullRequest: null,
            shownHash: SHA_A,
            typedPrefix: SHA_A.slice(0, 8),
            statement: 'Gate 2: design, eval plan and classification for milestone zero',
        },
    };
}
export function lockRecord(approvalId) {
    return {
        ...recordBase(HUMAN),
        recordType: 'lock',
        binds: { tree: TREE, files: { 'packages/cli/test/a.test.ts': SHA_A } },
        outcome: 'locked',
        refs: [approvalId],
        lock: {
            patterns: ['packages/*/test/**', 'docs/eval-plan.md'],
            testCommands: [
                'npm ci',
                'npm exec --workspace packages/cli -- vitest run --config vitest.config.ts',
            ],
        },
    };
}
export function revocation(target) {
    return {
        ...recordBase(HUMAN),
        recordType: 'revocation',
        binds: { tree: null, files: {} },
        outcome: 'revoked',
        refs: [target],
        revocation: { revokes: target, reason: 'approved by mistake' },
    };
}
export function inProgress(actor = AGENT) {
    return {
        ...recordBase(actor),
        recordType: 'transition',
        binds: { tree: null, files: { '.factory/work/story-1/story.md': SHA_A } },
        outcome: 'in-progress',
        refs: [],
        transition: {
            story: 'story-1',
            from: 'ready',
            to: 'in-progress',
            lease: { holder: 'builder-1', expiresAt: '2026-10-14T00:00:00Z' },
            handoffNote: null,
        },
    };
}
export function checkResult(check = 'verify') {
    return {
        ...recordBase(RUNNER),
        recordType: 'check-result',
        binds: { tree: TREE, files: {} },
        outcome: 'pass',
        refs: [],
        checkResult: {
            check,
            pullRequest: 7,
            runId: 123456,
            runUrl: 'https://github.com/example/project/actions/runs/123456',
            bundleManifestSha256: check === 'verify' ? SHA_B : null,
        },
    };
}
/** The path and bytes a record is stored at on the records branch. */
export function stored(record, subject = 'test') {
    return [`records/${recordFileName(record, subject)}`, serializeRecord(record)];
}
//# sourceMappingURL=records.js.map