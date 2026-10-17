/**
 * Minimal newline-delimited JSON-RPC 2.0 over stdio (ACP transport).
 */

export type JsonRpcId = number | string;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return "id" in msg && msg.id != null && !("method" in msg && (msg as JsonRpcRequest).method);
}

export function isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return "method" in msg && !("id" in msg && (msg as { id?: unknown }).id != null);
}

export function encodeMessage(msg: object): string {
  return JSON.stringify(msg) + "\n";
}

export function parseMessageLine(line: string): JsonRpcMessage | null {
  const t = line.trim();
  if (!t) return null;
  try {
    return JSON.parse(t) as JsonRpcMessage;
  } catch {
    return null;
  }
}
