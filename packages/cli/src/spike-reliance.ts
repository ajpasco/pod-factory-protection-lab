// SPIKE (brief C, part C): which open pull requests rely on a record that names no pull request.
import type { CommandIO } from './commands/common.js';
import { fetchPullRequest, fetchTrunk, treeOf } from './git-tree.js';
import type { PullRequestState } from './github.js';
import type { FactoryRecord } from './records/format.js';
import { git, gitText } from './records/git.js';

/** 'paths': an amendment with no pull request relied on by pull requests that change its paths; 'every': a gate-3 approval. */
export function wideReliance(record: FactoryRecord): { paths: string[] } | 'every' | null {
  if (record.recordType !== 'approval') return null;
  if (record.approval.kind === 'amendment' && record.approval.pullRequest === null) {
    return { paths: Object.keys(record.binds.files) };
  }
  if (record.approval.kind === 'gate' && record.approval.gate === 3) return 'every';
  return null;
}

/** The open pull requests that relied on `record`, each with the reason, newest head as given. */
export function relyingPulls(
  io: CommandIO,
  record: FactoryRecord,
  open: PullRequestState[],
): { pull: PullRequestState; tree: string; why: string }[] {
  const wide = wideReliance(record);
  if (wide === null) return [];
  const main = fetchTrunk(io.cwd, io.remote);
  const found: { pull: PullRequestState; tree: string; why: string }[] = [];
  for (const pull of open) {
    fetchPullRequest(io.cwd, pull.number, io.remote);
    git(io.cwd, ['fetch', '--quiet', '--no-tags', io.remote, pull.headSha], { allowFail: true });
    const tree = treeOf(io.cwd, pull.headSha);
    if (wide === 'every') {
      found.push({ pull, tree, why: 'every open pull request rests on gate 3' });
      continue;
    }
    const base = gitText(io.cwd, ['merge-base', main, pull.headSha]);
    const changed = gitText(io.cwd, ['diff', '--name-only', '--no-renames', '-z', base, pull.headSha]).split('\0');
    const carried = wide.paths.filter((p) => changed.includes(p));
    if (carried.length > 0) found.push({ pull, tree, why: `its head carries ${carried.join(', ')}` });
  }
  return found;
}
