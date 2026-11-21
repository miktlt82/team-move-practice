export class HttpError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    Object.assign(this, { status, code, fields });
  }
}

export const invalid = fields => new HttpError(422, 'VALIDATION_ERROR', 'Проверьте заполнение полей.', fields);
export const missing = () => new HttpError(404, 'NOT_FOUND', 'Запись не найдена.');
export const conflict = (code, message) => new HttpError(409, code, message);

export function json(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(payload === undefined ? undefined : JSON.stringify(payload));
}

export async function readJson(request) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Используйте application/json.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 16384) {
      request.resume();
      throw new HttpError(413, 'BODY_TOO_LARGE', 'Размер JSON ограничен 16 КиБ.');
    }
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {
    // Both malformed JSON and a non-object body use the same response.
  }
  throw new HttpError(400, 'INVALID_JSON', 'Ожидается JSON-объект.');
}

export function textValue(source, key, min, max, { trim = true, label = key } = {}) {
  const value = typeof source[key] === 'string' ? source[key] : '';
  const result = trim ? value.trim() : value;
  if (result.length < min || result.length > max) {
    throw invalid({ [key]: label + ' — от ' + min + ' до ' + max + ' символов.' });
  }
  return result;
}

export function emailValue(source) {
  const email = textValue(source, 'email', 3, 254, { label: 'Email' }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid({ email: 'Введите корректный email.' });
  return email;
}
