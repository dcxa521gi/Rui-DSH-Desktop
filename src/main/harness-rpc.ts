import { randomUUID } from 'node:crypto'

type RpcBody<T> = {
  result:
    | { ok: true; value: T }
    | { ok: false; error: { code: string; message: string } }
}

export async function harnessRpc<T>(baseUrl: string, method: string, payload: unknown): Promise<T> {
  const rpcId = randomUUID()
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${method} HTTP ${String(response.status)}`)
  const body = (await response.json()) as RpcBody<T>
  if (!body.result.ok) {
    throw new Error(body.result.error.message || body.result.error.code || method)
  }
  return body.result.value
}

export type WorkspaceRow = {
  workspaceId: string
  title: string
  path: string
  sessionIds?: string[]
}
