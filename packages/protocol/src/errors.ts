import { z } from "zod";

export const errorCodeSchema = z.enum([
  "invalid-message",
  "version-mismatch",
  "unauthorized",
  "unknown-provider",
  "unknown-instance",
  "unknown-key",
  "unsupported-capability",
  "write-failed",
  "internal",
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Erros são estruturados e serializáveis — nunca uma string solta. */
export const protocolErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});

export type ProtocolError = z.infer<typeof protocolErrorSchema>;

export function protocolError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ProtocolError {
  return details ? { code, message, details } : { code, message };
}
