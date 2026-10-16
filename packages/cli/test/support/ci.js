import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCKED_PATTERNS, hashText, recordBase, } from '../../src/index.js';
import { cleanEnv, runCli } from './cli.js';
import { HUMAN, RUNNER, SHA_A, SHA_B, gateApproval, stored } from './records.js';
import { fixture, sh } from './repo.js';
/** The locked test command in CI fixtures: quick, and it writes a JSON report as vitest does. */
export const TEST_COMMAND = 'node run-tests.mjs --locked';
/** A fixture project: one locked test, a lockfile, a runner script and application code. */
export const CI_FILES = {
    'package.json': '{"name": "fixture", "private": true, "scripts": {"test": "exit 0"}}\n',
    'package-lock.json': '{"lockfileVersion": 3}\n',
    'packages/cli/test/a.test.ts': "it('T-01-P1 [M0] fixture', () => {});\n",
    'packages/cli/vitest.config.ts': 'export default {};\n',
    '.github/workflows/pr-checks.yml': 'name: pr-checks\n',
    'run-tests.mjs': [
        "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
        "const result = readFileSync('src/result.txt', 'utf8').trim();",
        "console.log(`ran with ${process.argv.slice(2).join(' ')}; result ${result}`);",
        'const tokens = Object.keys(process.env).filter((k) => /TOKEN|^ACTIONS_/.test(k));',
        "console.log(`tokens visible to test code: ${tokens.length === 0 ? 'none' : tokens.join(',')}`);",
        "mkdirSync('.factory/work/reports', { recursive: true });",
        "writeFileSync('.factory/work/reports/cli.json', JSON.stringify({ success: result === 'pass' }));",
        "process.exit(result === 'pass' ? 0 : 1);",
        '',
    ].join('\n'),
    'src/result.txt': 'pass\n',
};
/** Story one's file in CI fixtures: its locked test, its scope, and one input. */
export const STORY_TEXT = [
    '# story-1: the app',
    '',
    'Tests:',
    '- packages/cli/test/a.test.ts',
    '',
    'Scope:',
    '- src/**',
    '',
    'Inputs:',
    '- package.json',
    '',
].join('\n');
export const STORY_FILES = {
    '.factory/work/plan/build-plan.md': '# Build plan\n\n1. .factory/work/story-1/story.md\n',
    '.factory/work/story-1/story.md': STORY_TEXT,
};
/** The CI fixture project; with `story`, main also holds a build plan and story one. */
export function ciProject(options = {}) {
    const f = fixture(options);
    const main = f.commitToMain(options.story === true ? { ...CI_FILES, ...STORY_FILES } : CI_FILES, 'fixture project');
    sh(f.work, ['pull', '--quiet', 'origin', 'main']);
    return { ...f, main };
}
/** Plants a gate-3 approval binding the build plan and story files as main holds them now. */
export function plantGate3(f, files = STORY_FILES) {
    const approval = {
        ...recordBase(HUMAN),
        recordType: 'approval',
        binds: {
            tree: treeAt(f, 'main'),
            files: Object.fromEntries(Object.entries(files).map(([p, text]) => [p, hashText(text)])),
        },
        outcome: 'approved',
        refs: [],
        approval: {
            kind: 'gate',
            gate: 3,
            story: null,
            pullRequest: null,
            shownHash: SHA_A,
            typedPrefix: SHA_A.slice(0, 8),
            statement: 'Gate 3: the build plan and its story',
        },
    };
    f.plant(Object.fromEntries([stored(approval, 'gate-3')]), 'gate 3');
    return approval;
}
export function treeAt(f, commit) {
    return sh(f.remote, ['rev-parse', `${commit}^{tree}`]);
}
/** Plants a lock over the fixture's locked files on main, as `lock` writes it. */
export function plantLock(f, testCommands = [TEST_COMMAND]) {
    const locked = Object.keys(CI_FILES)
        .filter((p) => p !== 'run-tests.mjs' && !p.startsWith('src/') && p !== 'package.json')
        .sort();
    const approval = gateApproval();
    const lock = {
        ...recordBase(HUMAN),
        recordType: 'lock',
        binds: {
            tree: treeAt(f, f.main),
            files: Object.fromEntries(locked.map((p) => [p, hashText(CI_FILES[p])])),
        },
        outcome: 'locked',
        refs: [approval.recordId],
        lock: { patterns: [...LOCKED_PATTERNS], testCommands },
    };
    f.plant(Object.fromEntries([stored(approval, 'gate-2'), stored(lock, 'gate-2')]), 'gate 2 and lock');
    return lock;
}
/** A merge approval for pull request `pr` bound to `tree`. */
export function mergeApproval(kind, pr, tree) {
    return {
        ...recordBase(HUMAN),
        recordType: 'approval',
        binds: { tree, files: {} },
        outcome: 'approved',
        refs: [],
        approval: {
            kind,
            gate: null,
            story: kind === 'story' ? 'story-1' : null,
            pullRequest: pr,
            shownHash: SHA_A,
            typedPrefix: SHA_A.slice(0, 8),
            statement: `Merge pull request ${pr}`,
        },
    };
}
/** Plants a merge approval for pull request `pr` bound to `tree`. */
export function plantApproval(f, kind, pr, tree, options = {}) {
    const approval = mergeApproval(kind, pr, tree);
    f.plant(Object.fromEntries([stored(approval, `pr-${pr}`)]), 'approval', options);
    return approval;
}
/** Plants a verify check result for pull request `pr` bound to `tree`, committed as CI does. */
export function plantVerify(f, pr, tree, options = {}) {
    const result = {
        ...recordBase(RUNNER),
        recordType: 'check-result',
        binds: { tree, files: {} },
        outcome: options.outcome ?? 'pass',
        refs: [],
        checkResult: {
            check: 'verify',
            pullRequest: pr,
            runId: 4242,
            runUrl: 'https://github.com/example/project/actions/runs/4242',
            bundleManifestSha256: SHA_B,
        },
    };
    f.plant(Object.fromEntries([stored(result, `verify-pr-${pr}`)]), 'check result', options.by === 'human' ? {} : { by: 'runner' });
    return result;
}
/** Runs `pod-factory ci <job>` as the check runner, from the enforcing copy `cwd`. */
export function job(cwd, args, extraEnv = {}) {
    const result = runCli(cwd, ['ci', ...args], cleanEnv({ GITHUB_ACTIONS: 'true', ...extraEnv }));
    return { status: result.status, out: result.stdout, err: result.stderr };
}
/** A checkout of pull request `pr`'s head, as the verify job's subject directory. */
export function subjectAt(f, pr, name = `subject-${pr}`) {
    const dir = f.clone(name);
    sh(dir, ['fetch', '--quiet', 'origin', `refs/pull/${pr}/head`]);
    sh(dir, ['checkout', '--quiet', '--detach', 'FETCH_HEAD']);
    return dir;
}
export function readManifest(bundle) {
    return JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8'));
}
export const CONFIG = 'packages/cli/vitest.config.ts';
export const CONFIG_V0 = CI_FILES[CONFIG];
export const CONFIG_V1 = 'export default { amended: 1 };\n';
export const CONFIG_V2 = 'export default { amended: 2 };\n';
/** A locked project whose story one may change the locked runner configuration. */
export function amendableProject() {
    const story = [
        '# story-1: the app',
        '',
        'Tests:',
        '- packages/cli/test/a.test.ts',
        '',
        'Scope:',
        '- src/**',
        `- ${CONFIG}`,
        '',
        'Inputs:',
        '- package.json',
        '',
    ].join('\n');
    const files = {
        '.factory/work/plan/build-plan.md': '# Build plan\n\n1. .factory/work/story-1/story.md\n',
        '.factory/work/story-1/story.md': story,
    };
    const f = ciProject();
    f.commitToMain(files, 'build plan');
    const lock = plantLock(f);
    plantGate3(f, files);
    return { f, lock };
}
/** An amendment approval for the runner configuration, as `approve amendment` writes it. */
export function plantAmendment(f, lock, pr, tree, before, after) {
    const amendment = {
        ...recordBase(HUMAN),
        recordType: 'approval',
        binds: { tree, files: { [CONFIG]: { before: hashText(before), after: hashText(after) } } },
        outcome: 'approved',
        refs: [lock.recordId],
        approval: {
            kind: 'amendment',
            gate: null,
            story: null,
            pullRequest: pr,
            shownHash: SHA_A,
            typedPrefix: SHA_A.slice(0, 8),
            statement: `Amendment: a change to locked ${CONFIG} as pull request ${pr} stands, against lock ${lock.recordId}.`,
        },
    };
    f.plant(Object.fromEntries([stored(amendment, `amendment-pr-${pr}`)]), 'amendment');
    return amendment;
}
/** Pull request `pr` changing the configuration from `before` to `after`, amended, approved and verified. */
export function amendedPullRequest(f, lock, pr, before, after) {
    const head = f.pullRequest(pr, { 'src/app.js': `export const app = ${pr};\n`, [CONFIG]: after });
    const tree = treeAt(f, head);
    const amendment = plantAmendment(f, lock, pr, tree, before, after);
    plantApproval(f, 'story', pr, tree);
    plantVerify(f, pr, tree);
    return { head, amendment };
}
export const ciCheck = (f, name, pr, head) => job(f.work, [name, '--pr', String(pr), '--head', head]);
/** Pull request `pr` with `files`, approved for story one and verified, with no amendment. */
export function approvedChange(f, pr, files) {
    const head = f.pullRequest(pr, files);
    const tree = treeAt(f, head);
    plantApproval(f, 'story', pr, tree);
    plantVerify(f, pr, tree);
    return head;
}
//# sourceMappingURL=ci.js.map