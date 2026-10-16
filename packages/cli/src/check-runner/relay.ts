import { Refusal, short, type CommandIO } from '../commands/common.js';
import { fetchPullRequest, treeOf } from '../git-tree.js';
import { gh, openPullRequests } from '../github.js';
import { resolveActor } from '../records/actor.js';
import { recordBase, type CheckResultRecord, type RevocationRecord } from '../records/format.js';
import { git } from '../records/git.js';
import type { RecordSet, StoredRecord } from '../records/store.js';
import { writeRecord } from '../records/write.js';
import { pullRequestOf, reliedOn, revocationTarget } from '../revocation.js';
import { relyingPulls, wideReliance } from '../spike-reliance.js';
import { evaluate } from './gate-check.js';
import { fetchHead } from './job.js';

/** The relay's check results about one pull request, oldest first (they are the only gate-check results ever written). */
const relayResults = (set: RecordSet) =>
  set.records.filter(
    (s): s is StoredRecord<CheckResultRecord> =>
      s.record.recordType === 'check-result' && s.record.checkResult.check === 'gate-check',
  );

/** What the relay posts for a verdict: the check run's conclusion and the recorded outcome. */
export function relayConclusion(verdict: { pass: boolean }): {
  conclusion: 'success' | 'failure';
  outcome: 'pass' | 'fail';
} {
  return verdict.pass
    ? { conclusion: 'success', outcome: 'pass' }
    : { conclusion: 'failure', outcome: 'fail' };
}

interface Affected {
  pr: number;
  headSha: string;
  tree: string;
  whys: string[];
  revocations: RevocationRecord[];
}

/**
 * The revocation relay, run by records-validate in Actions (TECH-SPEC section 6). For every open
 * pull request that a valid revocation affects at its current head (it relied on the revoked
 * record), or that the relay blocked or cleared earlier, it evaluates gate-check, the same rule
 * the gate-check job applies, and posts the CURRENT conclusion as a gate-check check run: a
 * failure while the authority is revoked, a pass once a valid fresh approval makes the verdict
 * pass. That way the newest gate-check check run on the head is never a stale failure. It writes
 * a gate-check check result for each post, which is how `revoke` learns the block is in place,
 * and skips a head whose last recorded conclusion is already the current one. Returns the exit
 * code.
 */
export function relay(io: CommandIO, set: RecordSet, runId: number, runUrl: string): number {
  const who = resolveActor(io.cwd, io.ctx);
  if (who.actor?.kind !== 'check-runner') {
    throw new Refusal(
      'The relay runs only as the check runner under GitHub Actions. Nothing was posted.',
    );
  }
  const candidates = set.records
    .filter(
      (s): s is typeof s & { record: RevocationRecord } => s.record.recordType === 'revocation',
    )
    .flatMap((s) => {
      const target = revocationTarget(set, s.record.revocation.revokes);
      if (target?.kind !== 'record') return [];
      const pr = pullRequestOf(target.stored.record);
      // A record that names no pull request may still be relied on by many (a gate-3 approval).
      if (pr === null && wideReliance(target.stored.record) === null) return [];
      return [{ revocation: s.record, target: target.stored.record, pr }];
    });
  const earlier = relayResults(set);
  if (candidates.length === 0 && earlier.length === 0) {
    io.out(
      'Relay: no revocation names a record a pull request merges on, so there is nothing to block.',
    );
    return 0;
  }
  const open = openPullRequests(io.cwd, io.ctx);
  if ('reason' in open) {
    io.out(`Relay failed: ${open.reason}. Revocations stay pending until it runs.`);
    return 1;
  }

  const affected = new Map<number, Affected>();
  const note = (
    pr: number,
    headSha: string,
    tree: string,
    why: string,
    revocation?: RevocationRecord,
  ) => {
    const entry = affected.get(pr) ?? { pr, headSha, tree, whys: [], revocations: [] };
    entry.whys.push(why);
    if (revocation !== undefined && !entry.revocations.includes(revocation)) {
      entry.revocations.push(revocation);
    }
    affected.set(pr, entry);
  };
  for (const { revocation, target, pr: named } of candidates) {
    const relying =
      named === null
        ? relyingPulls(io, target, open).map((r) => ({
            pr: r.pull.number,
            headSha: r.pull.headSha,
            tree: r.tree,
            why: r.why,
          }))
        : open
            .filter((p) => p.number === named)
            .flatMap((pull) => {
              fetchPullRequest(io.cwd, named, io.remote);
              git(io.cwd, ['fetch', '--quiet', '--no-tags', io.remote, pull.headSha], {
                allowFail: true,
              });
              const tree = treeOf(io.cwd, pull.headSha);
              return reliedOn(target, named, tree)
                ? [{ pr: named, headSha: pull.headSha, tree, why: 'named by the record' }]
                : [];
            });
    for (const r of relying) note(r.pr, r.headSha, r.tree, r.why, revocation);
  }
  // A pull request the relay already posted about stays in view even if no revocation names it
  // now, so a fresh approval can clear what the relay blocked.
  for (const pull of open) {
    if (affected.has(pull.number)) continue;
    if (!earlier.some((s) => s.record.checkResult.pullRequest === pull.number)) continue;
    fetchPullRequest(io.cwd, pull.number, io.remote);
    git(io.cwd, ['fetch', '--quiet', '--no-tags', io.remote, pull.headSha], { allowFail: true });
    const tree = treeOf(io.cwd, pull.headSha);
    if (
      earlier.some(
        (s) => s.record.checkResult.pullRequest === pull.number && s.record.binds.tree === tree,
      )
    ) {
      note(pull.number, pull.headSha, tree, 'the relay posted about this head earlier');
    }
  }

  let failures = 0;
  for (const { pr, headSha, tree, whys, revocations } of affected.values()) {
    let verdict;
    try {
      fetchHead(io, pr, headSha);
      verdict = evaluate(io, set, pr, headSha, tree);
    } catch (error) {
      io.out(
        `Relay could not evaluate gate-check for pull request ${pr}: ${(error as Error).message}.`,
      );
      failures++;
      continue;
    }
    const { conclusion, outcome } = relayConclusion(verdict);
    const last = earlier
      .filter((s) => s.record.checkResult.pullRequest === pr && s.record.binds.tree === tree)
      .at(-1);
    const why = [...new Set(whys)].join('; ');
    const revocation = revocations.at(-1);
    if (last?.record.outcome === outcome) {
      io.out(
        outcome === 'fail'
          ? `Relay: pull request ${pr} at ${short(headSha)} is already blocked${revocation === undefined ? '' : ` for revocation ${revocation.recordId}`}.`
          : `Relay: pull request ${pr} at ${short(headSha)} is already cleared: its last posted gate-check is a pass and the verdict still passes.`,
      );
      continue;
    }
    const target =
      revocation === undefined ? undefined : revocationTarget(set, revocation.revocation.revokes);
    const summary =
      outcome === 'fail' && revocation !== undefined && target?.kind === 'record'
        ? `Revocation ${revocation.recordId} revoked ${target.stored.record.recordId}, which this pull request relied on (${why}). Reason: ${revocation.revocation.reason}`
        : `The relay evaluated gate-check for this head against the records branch at ${short(set.head ?? '')}: it ${verdict.pass ? 'passes' : 'fails'}. ${verdict.lines.join(' ')}`;
    const posted = gh(io.cwd, io.ctx, [
      'api',
      '-X',
      'POST',
      'repos/{owner}/{repo}/check-runs',
      '-f',
      'name=gate-check',
      '-f',
      `head_sha=${headSha}`,
      '-f',
      'status=completed',
      '-f',
      `conclusion=${conclusion}`,
      '-f',
      `output[title]=${verdict.pass ? 'gate-check passes (reconciled by the relay)' : revocation === undefined ? 'gate-check fails' : 'approval revoked'}`,
      '-f',
      `output[summary]=${summary}`,
    ]);
    if (!posted.ok) {
      io.out(
        `Relay could not ${verdict.pass ? 'clear' : 'block'} pull request ${pr}: ${posted.reason}.`,
      );
      failures++;
      continue;
    }
    const record: CheckResultRecord = {
      ...recordBase(who.actor),
      recordType: 'check-result',
      binds: { tree, files: {} },
      outcome,
      refs: revocations.length > 0 ? revocations.map((r) => r.recordId) : (last?.record.refs ?? []),
      checkResult: {
        check: 'gate-check',
        pullRequest: pr,
        runId,
        runUrl,
        bundleManifestSha256: null,
      },
    };
    const landed = writeRecord(io.cwd, record, `relay-pr-${pr}`, { remote: io.remote });
    io.out(
      verdict.pass
        ? `Relay: posted a passing gate-check on pull request ${pr} at ${short(headSha)} (${why}); recorded as ${landed.path}.`
        : `Relay: posted a failing gate-check on pull request ${pr} at ${short(headSha)}${revocation === undefined ? '' : ` for revocation ${revocation.recordId}`} (${why}); recorded as ${landed.path}.`,
    );
  }
  return failures === 0 ? 0 : 1;
}
