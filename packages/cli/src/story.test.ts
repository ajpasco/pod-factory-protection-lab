// Regression tests for the gate-3 selection rule. Records are built in memory, as the reader
// returns them, so these run without git. The defect they keep fixed: revoking the current
// gate-3 approval used to promote the older, superseded one (the selection took the latest
// UNREVOKED record), so revoking the authorization left gate 3 approved by a predecessor.
import { describe, expect, it } from 'vitest';
import {
  recordBase,
  type ApprovalRecord,
  type FactoryRecord,
  type RevocationRecord,
} from './records/format.js';
import type { RecordSet, StoredRecord } from './records/store.js';
import { gate3Approval, latestGate3 } from './story.js';

const HUMAN = { name: 'A Human', email: 'human@example.com', kind: 'human' } as const;

const stored = <T extends FactoryRecord>(record: T): StoredRecord<T> => ({
  path: `records/${record.recordType}-${record.recordId}.json`,
  commit: 'c'.repeat(40),
  record,
});

function gate3(): ApprovalRecord {
  return {
    ...recordBase(HUMAN),
    recordType: 'approval',
    binds: { tree: 't'.repeat(40), files: {} },
    outcome: 'approved',
    refs: [],
    approval: {
      kind: 'gate',
      gate: 3,
      story: null,
      pullRequest: null,
      shownHash: 'h'.repeat(64),
      typedPrefix: 'hhhhhhhh',
      statement: 'Gate 3',
    },
  };
}

function revoking(target: ApprovalRecord): RevocationRecord {
  return {
    ...recordBase(HUMAN),
    recordType: 'revocation',
    binds: { tree: null, files: {} },
    outcome: 'revoked',
    refs: [target.recordId],
    revocation: { revokes: target.recordId, reason: 'withdrawn' },
  };
}

const setOf = (...records: FactoryRecord[]): RecordSet => ({
  head: 'r'.repeat(40),
  records: records.map(stored),
  bootstrap: [],
  flagged: [],
});

describe('the gate-3 authority is the latest gate-3 record', () => {
  it('returns the latest gate-3 approval while it is unrevoked, not an older one', () => {
    const older = gate3();
    const latest = gate3();
    const set = setOf(older, latest);
    expect(gate3Approval(set)?.record.recordId).toBe(latest.recordId);
    expect(latestGate3(set)).toMatchObject({ revokedBy: null });
  });

  it('after the latest is revoked, no gate-3 approval is in force: the older unrevoked one is NOT promoted', () => {
    const older = gate3();
    const latest = gate3();
    const revocation = revoking(latest);
    const set = setOf(older, latest, revocation);
    expect(gate3Approval(set)).toBeUndefined();
    const authority = latestGate3(set);
    expect(authority?.stored.record.recordId).toBe(latest.recordId);
    expect(authority?.revokedBy?.recordId).toBe(revocation.recordId);
  });

  it('reports the revoked latest record by name, whatever else is in the records', () => {
    const a = gate3();
    const b = gate3();
    const c = gate3();
    const set = setOf(a, b, c, revoking(c));
    expect(latestGate3(set)?.stored.record.recordId).toBe(c.recordId);
    expect(gate3Approval(set)).toBeUndefined();
  });

  it('revoking an OLDER gate-3 record changes nothing: the latest is still the authority', () => {
    const older = gate3();
    const latest = gate3();
    const set = setOf(older, latest, revoking(older));
    expect(gate3Approval(set)?.record.recordId).toBe(latest.recordId);
  });

  it('a new gate-3 approval after a revoked latest is the authority again', () => {
    const first = gate3();
    const second = gate3();
    const third = gate3();
    const set = setOf(first, second, revoking(second), third);
    expect(gate3Approval(set)?.record.recordId).toBe(third.recordId);
  });

  it('with no gate-3 record there is no authority', () => {
    expect(gate3Approval(setOf())).toBeUndefined();
    expect(latestGate3(setOf())).toBeUndefined();
  });
});
