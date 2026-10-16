import { type SpawnSyncReturns } from 'node:child_process';
/** This process's environment without agent markers or CI variables, plus `extra`. */
export declare function cleanEnv(extra?: Record<string, string>): Record<string, string>;
/** Runs the built pod-factory CLI in `cwd` with no terminal attached. */
export declare function runCli(cwd: string, args: string[], env: Record<string, string>, input?: string): SpawnSyncReturns<string>;
