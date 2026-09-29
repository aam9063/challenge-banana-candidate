import { config } from '../config';
import { sign } from '../auth';
export class BankError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function bankRequest<T>(
  userId: string,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const raw = body === undefined ? '' : JSON.stringify(body),
    timestamp = String(Date.now());
  const signature = sign([method, path, userId, timestamp, raw].join('\n'), config.serviceSecret);
  let response: Response;
  try {
    response = await fetch(`${config.bankUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-bank-actor': userId,
        'x-bank-time': timestamp,
        'x-bank-signature': signature,
      },
      body: raw || undefined,
      signal: AbortSignal.timeout(config.bankTimeoutMs),
      cache: 'no-store',
    });
  } catch {
    throw new BankError(504, 'No response received from the bank.');
  }
  // Parse defensively: a 5xx may return an HTML/text error page, and a raw
  // SyntaxError from JSON.parse would surface as an unrelated 500. An empty
  // body is treated as an empty JSON object.
  const text = await response.text();
  let data: { error?: string };
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new BankError(response.status, 'The bank returned a non-JSON response.');
  }
  if (!response.ok) throw new BankError(response.status, data.error || 'Bank service error.');
  return data as T;
}
