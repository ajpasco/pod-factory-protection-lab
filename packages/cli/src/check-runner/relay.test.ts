// Regression tests for the two fixes proven on real GitHub in the protection lab:
//  1. gate-check names a revoked latest gate-3 record and never falls back to its predecessor;
//  2. the relay posts gate-check's CURRENT conclusion for an affected pull request, a pass as
//     well as a failure, so a valid fresh approval clears a block the relay posted earlier, and a
//     revoked authority still ends in a failure.
// They use the repository's CI fixtures (a real git project, a fake gh), as the locked tests do.
import { describe, expect, it } from 'vitest';
import {
  hashText,
  loadRecords,
  recordBase,
  type ApprovalRecord,
  type CheckResultRecord,
  type RevocationRecord,
} from '../index.js';
import { relayConclusion } from './relay.js';
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
import { fakeGitHub } from '../../test/support/gh.js';
import { HUMAN, SHA_A, gateApproval, revocation, stored } from '../../test/support/records.js';

const RELAY_RUN = [
  '--run-id',
  '777',
  '--run-url',
  'https://github.com/example/project/actions/runs/777',
];

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
  const github = fakeGitHub({ pulls: { '7': { state: 'OPEN', head } } });
  return { f, a, b, head, tree, approval, github };
}

const gateCheck = (f: CiFixture, head: string) =>
  job(f.work, ['gate-check', '--pr', '7', '--head', head]);
const relayRun = (f: CiFixture, github: ReturnType<typeof fakeGitHub>) =>
  job(f.work, ['records-validate', '--relay', ...RELAY_RUN], github.env);
const posts = (github: ReturnType<typeof fakeGitHub>) =>
  github.calls().filter((c) => c.includes('POST') && c.includes('name=gate-check'));
const conclusions = (github: ReturnType<typeof fakeGitHub>) =>
  posts(github).map((c) => c.find((a) => a.startsWith('conclusion='))?.slice(11));
const relayRecords = (f: CiFixture) =>
  loadRecords(f.work)
    .records.map((s) => s.record)
    .filter(
      (r): r is CheckResultRecord =>
        r.recordType === 'check-result' && r.checkResult.check === 'gate-check',
    );

describe('the relay conclusion follows the verdict', () => {
  it('is a success and a recorded pass when the verdict passes', () => {
    expect(relayConclusion({ pass: true })).toEqual({ conclusion: 'success', outcome: 'pass' });
  });

  it('is a failure and a recorded fail when the verdict fails', () => {
    expect(relayConclusion({ pass: false })).toEqual({ conclusion: 'failure', outcome: 'fail' });
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

describe('the relay posts the current conclusion for an affected pull request', () => {
  it('blocks on a revocation, then clears the pull request once a valid fresh approval makes the verdict pass', () => {
    const { f, approval, tree, head, github } = pullRequestUnderTwoGate3s();
    expect(gateCheck(f, head).status).toBe(0);

    f.plant(
      Object.fromEntries([stored(revocation(approval.recordId), 'revoke-story')]),
      'revoke the story approval',
    );
    expect(relayRun(f, github).out).toMatch(/posted a failing gate-check on pull request 7/);
    expect(conclusions(github)).toEqual(['failure']);

    // A fresh approval for the SAME head tree: nothing about the candidate changes.
    plantApproval(f, 'story', 7, tree);
    const cleared = relayRun(f, github);
    expect(cleared.out).toMatch(/posted a passing gate-check on pull request 7/);
    expect(conclusions(github)).toEqual(['failure', 'success']);
    expect(relayRecords(f).map((r) => r.outcome)).toEqual(['fail', 'pass']);

    const again = relayRun(f, github);
    expect(again.out).toMatch(/pull request 7 at [0-9a-f]{12} is already cleared/);
    expect(conclusions(github)).toEqual(['failure', 'success']);
  });

  it('keeps failing while the authority is still revoked, even after a fresh approval for the pull request', () => {
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

    const out = relayRun(f, github).out;
    expect(conclusions(github)).not.toContain('success');
    expect(out).not.toMatch(/passing gate-check/);
    expect(relayRecords(f).every((r) => r.outcome === 'fail')).toBe(true);
    expect(gateCheck(f, head).status).toBe(1);
  });

  it('posts a failure for a revoked gate-3 authority on an open pull request, and does not fall back to the older approval', () => {
    const { f, a, b, github } = pullRequestUnderTwoGate3s();
    const revoked: RevocationRecord = revocation(b.recordId);
    f.plant(Object.fromEntries([stored(revoked, 'revoke-gate-3')]), 'revoke the latest gate 3');
    const out = relayRun(f, github).out;
    expect(conclusions(github)).toEqual(['failure']);
    expect(out).toMatch(/posted a failing gate-check on pull request 7/);
    expect(JSON.stringify(posts(github))).not.toContain(a.recordId);
  });
});
