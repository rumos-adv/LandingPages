export class JsonBodyError extends Error {
  constructor(code) {
    super(code === 'BODY_TOO_LARGE' ? 'Request body too large' : 'Invalid JSON body');
    this.name = 'JsonBodyError';
    this.code = code;
    this.status = code === 'BODY_TOO_LARGE' ? 413 : 400;
  }
}

function declaredBodyTooLarge(request, maximumBytes) {
  const value = request.headers.get('content-length');
  if (value == null || value.trim() === '') return false;
  const length = Number(value);
  return Number.isFinite(length) && length > maximumBytes;
}

export async function readBoundedJson(request, maximumBytes) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new TypeError('maximumBytes must be a positive safe integer');
  }

  if (declaredBodyTooLarge(request, maximumBytes)) {
    try {
      await request.body?.cancel('Request body exceeds the configured limit');
    } catch {
      // The declared size is already sufficient to reject the request.
    }
    throw new JsonBodyError('BODY_TOO_LARGE');
  }

  if (!request.body) throw new JsonBodyError('INVALID_JSON');

  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytesRead = 0;
  let raw = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      bytesRead += chunk.byteLength;
      if (bytesRead > maximumBytes) {
        try {
          await reader.cancel('Request body exceeds the configured limit');
        } catch {
          // The limit violation remains authoritative even if cancellation fails.
        }
        throw new JsonBodyError('BODY_TOO_LARGE');
      }
      raw += decoder.decode(chunk, { stream: true });
    }
    raw += decoder.decode();
  } catch (error) {
    if (error instanceof JsonBodyError) throw error;
    try {
      await reader.cancel('Unable to read request body');
    } catch {
      // Preserve the validation result if the stream cannot be cancelled.
    }
    throw new JsonBodyError('INVALID_JSON');
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A disturbed stream may already have released its lock.
    }
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new JsonBodyError('INVALID_JSON');
  }
}
