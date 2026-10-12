// A small JSON Schema validator: the subset these schemas use (type, enum, const, required, properties,
// additionalProperties, items, minItems, maxItems, minimum, maximum, pattern, minLength, anyOf, oneOf).
// It exists so the repository needs no dependencies. It returns a list of problems, empty when the value is valid.

const typeOf = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const matchesType = (v, t) => (t === 'number' ? typeof v === 'number' : typeOf(v) === t || (t === 'integer' && Number.isInteger(v)));

export function validate(value, schema, at = '$') {
  const problems = [];
  const fail = msg => problems.push(`${at}: ${msg}`);
  if (schema.anyOf) {
    if (!schema.anyOf.some(s => validate(value, s, at).length === 0)) fail('matches none of the allowed shapes');
    return problems;
  }
  if (schema.oneOf) {
    const n = schema.oneOf.filter(s => validate(value, s, at).length === 0).length;
    if (n !== 1) fail(`matches ${n} of the exclusive shapes`);
    return problems;
  }
  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) fail(`expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some(e => JSON.stringify(e) === JSON.stringify(value))) fail(`${JSON.stringify(value)} is not one of ${schema.enum.slice(0, 8).join(', ')}${schema.enum.length > 8 ? ', …' : ''}`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(t => matchesType(value, t))) { fail(`expected ${types.join(' or ')}, got ${typeOf(value)}`); return problems; }
  }
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail(`does not match ${schema.pattern}`);
    if (schema.minLength !== undefined && value.length < schema.minLength) fail(`shorter than ${schema.minLength}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => problems.push(...validate(v, schema.items, `${at}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const r of schema.required || []) if (!(r in value)) fail(`missing required property ${r}`);
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) problems.push(...validate(v, props[k], `${at}.${k}`));
      else if (schema.additionalProperties === false) fail(`unexpected property ${k}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') problems.push(...validate(v, schema.additionalProperties, `${at}.${k}`));
    }
  }
  return problems;
}
