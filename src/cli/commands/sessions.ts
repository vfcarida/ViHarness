#!/usr/bin/env node
/**
 * Vi-Harness Sessions CLI Command.
 *
 * Usage:
 *   vi-harness sessions list [--limit 50]
 *   vi-harness sessions show <id>
 *   vi-harness sessions resume <id>
 *   vi-harness sessions branch <id> <branch-point>
 */
import { SqliteStore } from '../../infra/storage/sqlite-store.js';
import { SqliteSessionStore } from '../../infra/storage/session-store.js';

export interface SessionsCliArgs {
  action: 'list' | 'show' | 'resume' | 'branch' | 'help';
  sessionId?: string;
  branchPoint?: number;
  limit: number;
  dbPath?: string;
}

export function parseSessionsArgs(args: string[]): SessionsCliArgs {
  const result: SessionsCliArgs = {
    action: 'list',
    limit: 20,
  };

  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--help' || arg === '-h') {
      result.action = 'help';
    } else if (arg === '--limit' && i + 1 < args.length) {
      result.limit = parseInt(args[++i]!, 10) || 20;
    } else if (arg === '--db' && i + 1 < args.length) {
      result.dbPath = args[++i]!;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  if (positional.length > 0) {
    const act = positional[0]!.toLowerCase();
    if (act === 'list' || act === 'show' || act === 'resume' || act === 'branch') {
      result.action = act;
      result.sessionId = positional[1];
      if (positional[2]) {
        result.branchPoint = parseInt(positional[2], 10);
      }
    } else {
      result.sessionId = positional[0];
      result.action = 'show';
    }
  }

  return result;
}

export async function runSessionsCli(rawArgs: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseSessionsArgs(rawArgs);

  if (args.action === 'help') {
    console.log(`
======================================================================
                 Vi-Harness Sessions Manager CLI
======================================================================

Commands:
  vi-harness sessions list [--limit N]        List recent sessions
  vi-harness sessions show <id>               Display session messages
  vi-harness sessions resume <id>             Resume session by ID
  vi-harness sessions branch <id> <point>     Branch session at message index
`);
    return;
  }

  const store = new SqliteStore(args.dbPath);
  await store.open();
  const sessionStore = new SqliteSessionStore({ store });

  try {
    switch (args.action) {
      case 'list': {
        const sessions = await sessionStore.listRecent(args.limit);
        console.log(`\nFound ${sessions.length} sessions (DB: ${store.resolvedDbPath}):\n`);
        console.log(
          '--------------------------------------------------------------------------------',
        );
        console.log('ID                                    MESSAGES  UPDATED AT');
        console.log(
          '--------------------------------------------------------------------------------',
        );
        for (const s of sessions) {
          const dateStr = new Date(s.updatedAt).toISOString().replace('T', ' ').slice(0, 19);
          console.log(`${s.id.padEnd(38)} ${String(s.messageCount).padEnd(9)} ${dateStr}`);
        }
        console.log(
          '--------------------------------------------------------------------------------\n',
        );
        break;
      }

      case 'show':
      case 'resume': {
        if (!args.sessionId) {
          console.error('[ERROR] Missing sessionId argument.');
          process.exit(1);
        }
        const record = await sessionStore.loadSession(args.sessionId);
        if (!record) {
          console.error(`[ERROR] Session [${args.sessionId}] not found.`);
          process.exit(1);
        }
        console.log(`\nSession: ${record.session.id}`);
        console.log(`Created: ${new Date(record.session.header.createdAt).toISOString()}`);
        if (record.session.header.parentId) {
          console.log(
            `Parent:  ${record.session.header.parentId} (branch point: ${record.session.header.branchPoint})`,
          );
        }
        console.log(`Messages: ${record.session.log.length}\n`);

        for (let i = 0; i < record.session.log.length; i++) {
          const ev = record.session.log[i]!;
          console.log(`[#${i} ${ev.type}] ${JSON.stringify(ev.data).slice(0, 100)}`);
        }
        break;
      }

      case 'branch': {
        if (!args.sessionId || args.branchPoint === undefined) {
          console.error('[ERROR] Usage: vi-harness sessions branch <sessionId> <branchPoint>');
          process.exit(1);
        }
        const child = await sessionStore.branchSession(args.sessionId, args.branchPoint);
        console.log(`\nSuccessfully branched session!`);
        console.log(`Parent: ${args.sessionId} (at index #${args.branchPoint})`);
        console.log(`Child:  ${child.id}`);
        console.log(`Inherited Messages: ${child.log.length}\n`);
        break;
      }
    }
  } finally {
    await store.close();
  }
}

if (process.argv[1]?.endsWith('sessions.ts') || process.argv[1]?.endsWith('sessions.js')) {
  runSessionsCli().catch((err) => {
    console.error('[ERROR] Sessions CLI failed:', err);
    process.exit(1);
  });
}
