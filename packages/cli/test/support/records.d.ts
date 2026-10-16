import { type Actor, type ApprovalRecord, type CheckResultRecord, type FactoryRecord, type LockRecord, type RevocationRecord, type TransitionRecord } from '../../src/index.js';
export declare const HUMAN: Actor;
export declare const AGENT: Actor;
export declare const RUNNER: Actor;
export declare const SHA_A: string;
export declare const SHA_B: string;
export declare const TREE: string;
export declare function gateApproval(): ApprovalRecord;
export declare function lockRecord(approvalId: string): LockRecord;
export declare function revocation(target: string): RevocationRecord;
export declare function inProgress(actor?: Actor): TransitionRecord;
export declare function checkResult(check?: 'verify' | 'lock-guard' | 'gate-check'): CheckResultRecord;
/** The path and bytes a record is stored at on the records branch. */
export declare function stored(record: FactoryRecord, subject?: string): [string, string];
