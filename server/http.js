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

async function readBody(request, limit, message) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      request.resume();
      throw new HttpError(413, 'BODY_TOO_LARGE', message);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(request) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Используйте application/json.');
  }
  const body = await readBody(request, 16384, 'Размер JSON ограничен 16 КиБ.');
  try {
    const value = JSON.parse(body.toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {
    // Both malformed JSON and a non-object body use the same response.
  }
  throw new HttpError(400, 'INVALID_JSON', 'Ожидается JSON-объект.');
}

export async function readLogo(request) {
  if (request.headers['content-type'] !== 'image/png') throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Выберите файл PNG.');
  const png = await readBody(request, 256 * 1024, 'Размер логотипа ограничен 256 КиБ.');
  const signature = Buffer.from([137,80,78,71,13,10,26,10]);
  if (png.length < 45 || !png.subarray(0,8).equals(signature) || png.toString('ascii',12,16) !== 'IHDR' ||
      png.readUInt32BE(8) !== 13 || [png.readUInt32BE(16),png.readUInt32BE(20)].some(dimension => dimension < 1 || dimension > 2048) ||
      png.toString('ascii',png.length-8,png.length-4) !== 'IEND') {
    throw invalid({ logo: 'Выберите PNG с шириной и высотой до 2048 пикселей.' });
  }
  return png;
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
