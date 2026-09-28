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
      JSON.stringify({ tool: data.tool, status: data.status }),
      new Date().toISOString(),
    );
}
