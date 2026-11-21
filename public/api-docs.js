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
  if (schema.enum) return schema.enum.join(' | ');
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
      if (op.security) details.append(element('p', 'Требуется cookie сеанса.'));
      for (const parameter of op.parameters ?? []) {
        details.append(element('p', parameter.name + ' (' + parameter.in + ') — ' + describe(parameter.schema, spec)));
      }
      const body = op.requestBody?.content['application/json'];
      if (body) {
        details.append(element('h3', 'Тело запроса', 'compact-actions'),
          element('pre', body.example ? JSON.stringify(body.example, null, 2) : describe(body.schema, spec)));
      }
      details.append(element('h3', 'Ответы', 'compact-actions'));
      const list = element('ul', '', 'rows');
      for (const [code, reply] of Object.entries(op.responses)) {
        const item = element('li', code + ' · ' + reply.description);
        if (reply.content) item.append(element('pre', describe(reply.content['application/json'].schema, spec)));
        list.append(item);
      }
      details.append(list);
      return details;
    })));
} catch {
  listing.replaceChildren(element('p', 'Не удалось загрузить OpenAPI. Обновите страницу.', 'error'));
}
