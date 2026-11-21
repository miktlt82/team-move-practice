const listing = document.querySelector('#operations');
function element(tag, content, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = content;
  return node;
}
function describe(schema, spec) {
  if (schema.$ref) return describe(spec.components.schemas[schema.$ref.split('/').at(-1)], spec);
  if (schema.allOf) return schema.allOf.map(part => describe(part, spec)).join(' + ');
  if (schema.oneOf) return schema.oneOf.map(part => describe(part, spec)).join(' или ');
  if (schema.enum) return schema.enum.map(String).join(' | ');
  if (schema.const !== undefined) return String(schema.const);
  if (schema.prefixItems) return '[' + schema.prefixItems.map(part => describe(part, spec)).join(', ') + ']';
  if (schema.type === 'array') return '[' + describe(schema.items, spec) + ']';
  if (schema.type === 'object' && schema.properties) {
    return '{ ' + Object.entries(schema.properties).map(([key, value]) =>
      key + (schema.required?.includes(key) ? '' : '?') + ': ' + describe(value, spec)).join(', ') + ' }';
  }
  return [schema.type, schema.format].filter(Boolean).flat().join(' | ');
}
try {
  const response = await fetch('/openapi.json');
  if (!response.ok) throw new Error('Не удалось загрузить спецификацию.');
  const spec = await response.json();
  listing.replaceChildren(...Object.entries(spec.paths).flatMap(([path, definitions]) =>
    Object.entries(definitions).map(([method, op]) => {
      const details = element('details', '', 'surface api-operation');
      details.append(element('summary', method.toUpperCase() + ' ' + path, 'api-method'),
        element('p', op.summary, 'compact-actions'));
      if (op.description) details.append(element('p', op.description));
      if (op.security?.some(scheme => scheme.session)) details.append(element('p', 'Требуется cookie сеанса.'));
      if (op.security?.some(scheme => scheme.telegramSecret)) details.append(element('p', 'Требуется заголовок X-Telegram-Bot-Api-Secret-Token.'));
      for (const parameter of op.parameters ?? []) {
        details.append(element('p', parameter.name + ' (' + parameter.in + ') — ' + describe(parameter.schema, spec)));
      }
      const body = op.requestBody?.content['application/json'];
      if (body) {
        details.append(element('h3', 'Тело запроса', 'compact-actions'), element('pre', describe(body.schema, spec)));
        if (body.example) details.append(element('pre', JSON.stringify(body.example, null, 2)));
      } else if (op.requestBody?.content['image/png']) {
        details.append(element('h3', 'Тело запроса', 'compact-actions'),
          element('p', 'image/png · бинарный файл до 256 КиБ'));
      }
      details.append(element('h3', 'Ответы', 'compact-actions'));
      const list = element('ul', '', 'rows');
      for (const [code, reply] of Object.entries(op.responses)) {
        const item = element('li', code + ' · ' + reply.description);
        const content = reply.content?.['application/json'];
        if (content) item.append(element('pre', describe(content.schema, spec)));
        if (content?.example) item.append(element('pre', JSON.stringify(content.example, null, 2)));
        list.append(item);
      }
      details.append(list);
      return details;
    })));
} catch {
  listing.replaceChildren(element('p', 'Не удалось загрузить OpenAPI. Обновите страницу.', 'error'));
}
