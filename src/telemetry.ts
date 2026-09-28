import { randomUUID } from 'node:crypto';
import { appDb } from './db';
import type { ToolContext } from './types';
export function recordEvent(ctx: ToolContext, kind: string, data: Record<string, unknown>) {
  appDb()
    .prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)')
    .run(
      randomUUID(),
      ctx.runId,
      ctx.userId,
      ctx.conversationId,
      kind,
      // Persist the full payload: tool arguments, outputs and durationMs are
      // the operator's evidence and must survive verbatim.
      JSON.stringify(data),
      new Date().toISOString(),
    );
}
