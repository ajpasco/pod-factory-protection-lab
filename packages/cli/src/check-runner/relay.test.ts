// Regression tests for the two fixes proven on real GitHub in the protection lab:
//  1. gate-check names a revoked latest gate-3 record and never falls back to its predecessor;
//  2. the relay posts gate-check's CURRENT conclusion for an affected pull request, a pass as
//     well as a failure, so a valid fresh approval clears a block the relay posted earlier, and a
//     revoked authority still ends in a failure.
// They use the repository's CI fixtures (a real git project, a fake gh), as the locked tests do.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  hashText,
  loadRecords,
  recordBase,
  type ApprovalRecord,
  type CheckResultRecord,
} from '../index.js';
import { relayOutcome } from './relay.js';
import {
  STORY_FILES,
  ciProject,
  job,
  plantApproval,
  plantLock,
  plantVerify,
  treeAt,
  type CiFixture,
} from '../../test/support/ci.js';
import { tempDir } from '../../test/support/repo.js';
import { HUMAN, SHA_A, gateApproval, revocation, stored } from '../../test/support/records.js';

const RELAY_RUN = [
  '--run-id',
  '777',
  '--run-url',
  'https://github.com/example/project/actions/runs/777',
];

// A fake GitHub CLI for the relay: it lists pull request 7, lists pr-checks runs for its head
// (deliberately NOT newest-first), lists the gate-check job of a run, and logs every call.
const FAKE_GH = `
const { appendFileSync, readFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + '\\n');
const state = JSON.parse(readFileSync(process.env.FAKE_GH_STATE, 'utf8'));
const path = args.find((a) => a.startsWith('repos/')) || '';
if (args[0] === 'workflow') process.exit(0);
if (args[0] === 'api' && args.includes('POST')) { process.stdout.write('{}'); process.exit(0); }
if (path.includes('/pulls?')) { process.stdout.write('7\\t' + state.head + '\\n'); process.exit(0); }
if (path.includes('/actions/runs?')) { for (const r of state.runs) process.stdout.write(r.id + '\\t' + r.status + '\\n'); process.exit(0); }
const jobs = /actions\\/runs\\/(\\d+)\\/jobs/.exec(path);
if (jobs) { process.stdout.write('9' + jobs[1] + '\\n'); process.exit(0); }
process.stderr.write('fake gh: unexpected call ' + args.join(' '));
process.exit(1);
`;

interface FakeRuns {
  runs: { id: number; status: string }[];
}

function fakeGitHub(
  head: string,
  runs: FakeRuns['runs'] = [
    { id: 101, status: 'completed' },
    { id: 205, status: 'completed' },
    { id: 150, status: 'completed' },
  ],
) {
  const dir = tempDir();
  const bin = join(dir, 'bin');
  const state = join(dir, 'state.json');
  const log = join(dir, 'calls.jsonl');
  writeFileSync(join(dir, 'gh.cjs'), FAKE_GH);
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'gh'),
    `#!/bin/sh\nexec '${process.execPath}' '${join(dir, 'gh.cjs')}' "$@"\n`,
  );
  chmodSync(join(bin, 'gh'), 0o755);
  writeFileSync(state, JSON.stringify({ head, runs }));
  return {
    env: { PATH: `${bin}:${process.env.PATH ?? ''}`, FAKE_GH_STATE: state, FAKE_GH_LOG: log },
    calls: () =>
      existsSync(log)
        ? readFileSync(log, 'utf8')
            .split('\n')
            .filter((l) => l !== '')
            .map((l) => JSON.parse(l) as string[])
        : [],
  };
}
type Github = ReturnType<typeof fakeGitHub>;

/** A gate-3 approval whose authority chain is complete: it refers to a gate-2 approval and the lock in force. */
function gate3Over(f: CiFixture, refs: string[]): ApprovalRecord {
  const record: ApprovalRecord = {
    ...recordBase(HUMAN),
    recordType: 'approval',
    binds: {
      tree: treeAt(f, f.main),
      files: Object.fromEntries(
        Object.entries(STORY_FILES).map(([p, text]) => [p, hashText(text)]),
      ),
    },
    outcome: 'approved',
    refs,
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
  f.plant(Object.fromEntries([stored(record, 'gate-3')]), 'gate 3');
  return record;
}

/** A locked project with a complete chain, gate-3 approvals A then B, and pull request 7 approved and verified. */
function pullRequestUnderTwoGate3s() {
  const f = ciProject({ story: true });
  const lock = plantLock(f);
  // A gate-2 approval that binds the tree and no file, so the chain's "unchanged on main" test has nothing to drift.
  const gate2: ApprovalRecord = {
    ...gateApproval(),
    binds: { tree: treeAt(f, f.main), files: {} },
  };
  f.plant(Object.fromEntries([stored(gate2, 'gate-2-chain')]), 'a gate-2 approval for the chain');
  const refs = [gate2.recordId, lock.recordId];
  const a = gate3Over(f, refs);
  const b = gate3Over(f, refs);
  const head = f.pullRequest(7, { 'src/app.js': 'export const app = 1;\n' });
  const tree = treeAt(f, head);
  const approval = plantApproval(f, 'story', 7, tree);
  plantVerify(f, 7, tree);
  const github = fakeGitHub(head);
  return { f, a, b, head, tree, approval, github };
}

const gateCheck = (f: CiFixture, head: string) =>
  job(f.work, ['gate-check', '--pr', '7', '--head', head]);
const relayRun = (f: CiFixture, github: Github) =>
  job(f.work, ['records-validate', '--relay', ...RELAY_RUN], github.env);
/** The jobs the relay asked GitHub to re-run, by job id. */
const reruns = (github: Github) =>
  github
    .calls()
    .filter((c) => c.includes('POST'))
    .map((c) => c.find((a) => a.includes('/rerun')) ?? '');
const checkRunPosts = (github: Github) =>
  github.calls().filter((c) => c.includes('POST') && c.some((a) => a.endsWith('/check-runs')));
const relayRecords = (f: CiFixture) =>
  loadRecords(f.work)
    .records.map((s) => s.record)
    .filter(
      (r): r is CheckResultRecord =>
        r.recordType === 'check-result' && r.checkResult.check === 'gate-check',
    );

describe('what the relay records for a verdict', () => {
  it('is a pass when the verdict passes', () => {
    expect(relayOutcome({ pass: true })).toBe('pass');
  });

  it('is a fail when the verdict fails', () => {
    expect(relayOutcome({ pass: false })).toBe('fail');
  });
});

describe('gate-check with a revoked latest gate-3 record', () => {
  it('passes while the latest gate-3 record is unrevoked, naming it', () => {
    const { f, b, head } = pullRequestUnderTwoGate3s();
    const result = gateCheck(f, head);
    expect(result.out).toContain(
      `Gate-3 approval ${b.recordId} (the latest gate-3 record, unrevoked)`,
    );
    expect(result.status).toBe(0);
  });

  it('fails naming the revoked record and the revocation, and never falls back to the older gate-3 approval', () => {
    const { f, a, b, head } = pullRequestUnderTwoGate3s();
    const revoked = revocation(b.recordId);
    f.plant(Object.fromEntries([stored(revoked, 'revoke-gate-3')]), 'revoke the latest gate 3');
    const result = gateCheck(f, head);
    expect(result.status).toBe(1);
    expect(result.out).toContain(
      `Gate-3 approval ${b.recordId} is the latest gate-3 record and it was revoked by ${revoked.recordId}`,
    );
    expect(result.out).not.toContain(a.recordId);
    expect(result.out).not.toMatch(/chain holds/);
  });
});

describe('the relay re-runs the gate-check job of the newest run for an affected head', () => {
  it('re-runs the NEWEST pr-checks run, not the first one listed, posts no check run of its own, and records the block', () => {
    const { f, approval, github } = pullRequestUnderTwoGate3s();
    f.plant(
      Object.fromEntries([stored(revocation(approval.recordId), 'revoke-story')]),
      'revoke the story approval',
    );
    const out = relayRun(f, github);
    expect(out.status).toBe(0);
    expect(out.out).toMatch(
      /re-ran the gate-check job \(job 9205 of run 205, the newest pr-checks run/,
    );
    expect(reruns(github)).toEqual(['repos/{owner}/{repo}/actions/jobs/9205/rerun']);
    expect(checkRunPosts(github)).toEqual([]);
    expect(relayRecords(f).map((r) => r.outcome)).toEqual(['fail']);
  });

  it('blocks on a revocation, then re-runs again once a valid fresh approval makes the verdict pass, and not a third time', () => {
    const { f, approval, tree, head, github } = pullRequestUnderTwoGate3s();
    expect(gateCheck(f, head).status).toBe(0);
    f.plant(
      Object.fromEntries([stored(revocation(approval.recordId), 'revoke-story')]),
      'revoke the story approval',
    );
    relayRun(f, github);
    expect(reruns(github)).toHaveLength(1);

    // A fresh approval for the SAME head tree: the candidate does not change.
    plantApproval(f, 'story', 7, tree);
    const cleared = relayRun(f, github);
    expect(cleared.out).toMatch(/re-ran the gate-check job .* the verdict is a pass/);
    expect(reruns(github)).toHaveLength(2);
    expect(relayRecords(f).map((r) => r.outcome)).toEqual(['fail', 'pass']);

    const again = relayRun(f, github);
    expect(again.out).toMatch(/pull request 7 at [0-9a-f]{12} is already cleared/);
    expect(reruns(github)).toHaveLength(2);
  });

  it('keeps the verdict a failure while the authority is still revoked, even after a fresh approval for the pull request', () => {
    const { f, b, approval, tree, head, github } = pullRequestUnderTwoGate3s();
    f.plant(
      Object.fromEntries([stored(revocation(approval.recordId), 'revoke-story')]),
      'revoke the story approval',
    );
    expect(relayRun(f, github).status).toBe(0);
    f.plant(
      Object.fromEntries([stored(revocation(b.recordId), 'revoke-gate-3')]),
      'revoke the latest gate 3',
    );
    plantApproval(f, 'story', 7, tree);
    const out = relayRun(f, github);
    expect(out.out).toMatch(/already blocked/);
    expect(reruns(github)).toHaveLength(1);
    expect(relayRecords(f).every((r) => r.outcome === 'fail')).toBe(true);
    expect(gateCheck(f, head).status).toBe(1);
  });

  it('re-runs nothing and records nothing while the newest run is still in progress, because its gate-check reads the records itself', () => {
    const { f, approval, head } = pullRequestUnderTwoGate3s();
    const github = fakeGitHub(head, [
      { id: 101, status: 'completed' },
      { id: 205, status: 'in_progress' },
    ]);
    f.plant(
      Object.fromEntries([stored(revocation(approval.recordId), 'revoke-story')]),
      'revoke the story approval',
    );
    const out = relayRun(f, github);
    expect(out.out).toMatch(/newest pr-checks run 205 .* is still in_progress/);
    expect(out.status).toBe(0);
    expect(reruns(github)).toEqual([]);
    expect(relayRecords(f)).toEqual([]);
  });

  it('fails the relay, naming the reason, when GitHub refuses the re-run', () => {
    const { f, approval, head } = pullRequestUnderTwoGate3s();
    const github = fakeGitHub(head, []);
    f.plant(
      Object.fromEntries([stored(revocation(approval.recordId), 'revoke-story')]),
      'revoke the story approval',
    );
    const out = relayRun(f, github);
    expect(out.out).toMatch(/Relay could not block pull request 7 .*: no pr-checks run exists/);
    expect(out.status).toBe(1);
    expect(relayRecords(f)).toEqual([]);
  });
});
