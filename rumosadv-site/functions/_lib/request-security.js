export function validateSameOriginJson(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType.trim())) {
    return { status: 415, error: 'Envie a requisição como application/json.' };
  }

  if (String(request.headers.get('sec-fetch-site') || '').trim().toLowerCase() === 'cross-site') {
    return { status: 403, error: 'Origem da requisição não permitida.' };
  }

  const suppliedOrigin = request.headers.get('origin');
  if (suppliedOrigin) {
    try {
      if (new URL(suppliedOrigin).origin !== new URL(request.url).origin) {
        return { status: 403, error: 'Origem da requisição não permitida.' };
      }
    } catch {
      return { status: 403, error: 'Origem da requisição não permitida.' };
    }
  }

  return null;
}
