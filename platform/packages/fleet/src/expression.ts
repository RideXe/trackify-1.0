/**
 * A small, sandboxed expression language for computed attributes, covering what the legacy JEXL
 * expressions are used for: arithmetic, comparisons, logic, ternaries and bit tests on IO values,
 * e.g. `io66 * 0.001`, `io239 == 1`, `bit(io1, 3) ? 'open' : 'closed'`.
 *
 * Nothing is executed: expressions are parsed into a tree and evaluated against plain data. Only
 * own properties of plain values are readable, so prototypes and functions are out of reach.
 */

export type Value = number | boolean | string | null;
type Node =
  | { kind: 'literal'; value: Value }
  | { kind: 'name'; name: string }
  | { kind: 'member'; target: Node; key: Node }
  | { kind: 'unary'; operator: '-' | '!'; operand: Node }
  | { kind: 'binary'; operator: string; left: Node; right: Node }
  | { kind: 'conditional'; test: Node; then: Node; otherwise: Node }
  | { kind: 'call'; name: string; args: Node[] };

export class ExpressionError extends Error {}

const MAX_LENGTH = 500;
const MAX_DEPTH = 40;

const FUNCTIONS: Record<string, (...args: Value[]) => Value> = {
  abs: (value) => Math.abs(number(value)),
  min: (...values) => Math.min(...values.map(number)),
  max: (...values) => Math.max(...values.map(number)),
  round: (value, digits = 0) => {
    const factor = 10 ** number(digits);
    return Math.round(number(value) * factor) / factor;
  },
  floor: (value) => Math.floor(number(value)),
  ceil: (value) => Math.ceil(number(value)),
  /** Bit `index` (0 = lowest) of an integer, e.g. a digital input in a status word. */
  bit: (value, index) => Math.floor(number(value) / 2 ** number(index)) % 2 === 1,
};

const PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

export interface CompiledExpression {
  evaluate(scope: Readonly<Record<string, unknown>>): Value;
}

export function compile(source: string): CompiledExpression {
  if (source.length > MAX_LENGTH)
    throw new ExpressionError(`expression is longer than ${MAX_LENGTH} characters`);
  const tokens = tokenize(source);
  let index = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++];
  const expect = (value: string) => {
    const token = take();
    if (token?.value !== value) throw new ExpressionError(`expected "${value}"`);
  };

  const parseExpression = (depth: number): Node => {
    if (depth > MAX_DEPTH) throw new ExpressionError('expression is nested too deeply');
    const test = parseBinary(0, depth);
    if (peek()?.value !== '?') return test;
    take();
    const then = parseExpression(depth + 1);
    expect(':');
    return { kind: 'conditional', test, then, otherwise: parseExpression(depth + 1) };
  };

  const parseBinary = (minimum: number, depth: number): Node => {
    let left = parseUnary(depth);
    for (;;) {
      const token = peek();
      const precedence = token?.type === 'operator' ? PRECEDENCE[token.value] : undefined;
      if (precedence === undefined || precedence <= minimum) return left;
      take();
      left = {
        kind: 'binary',
        operator: token!.value,
        left,
        right: parseBinary(precedence, depth + 1),
      };
    }
  };

  const parseUnary = (depth: number): Node => {
    const token = peek();
    if (token?.type === 'operator' && (token.value === '-' || token.value === '!')) {
      take();
      return { kind: 'unary', operator: token.value, operand: parseUnary(depth + 1) };
    }
    return parsePostfix(parsePrimary(depth), depth);
  };

  const parsePostfix = (node: Node, depth: number): Node => {
    for (;;) {
      const token = peek();
      if (token?.value === '.') {
        take();
        const name = take();
        if (name?.type !== 'name') throw new ExpressionError('expected a property name after "."');
        node = { kind: 'member', target: node, key: { kind: 'literal', value: name.value } };
      } else if (token?.value === '[') {
        take();
        const key = parseExpression(depth + 1);
        expect(']');
        node = { kind: 'member', target: node, key };
      } else return node;
    }
  };

  const parsePrimary = (depth: number): Node => {
    const token = take();
    if (!token) throw new ExpressionError('unexpected end of expression');
    if (token.type === 'number') return { kind: 'literal', value: Number(token.value) };
    if (token.type === 'string') return { kind: 'literal', value: token.value };
    if (token.value === '(') {
      const inner = parseExpression(depth + 1);
      expect(')');
      return inner;
    }
    if (token.type === 'name') {
      if (token.value === 'true' || token.value === 'false')
        return { kind: 'literal', value: token.value === 'true' };
      if (token.value === 'null') return { kind: 'literal', value: null };
      if (peek()?.value === '(') {
        take();
        if (!(token.value in FUNCTIONS))
          throw new ExpressionError(`unknown function ${token.value}`);
        const args: Node[] = [];
        while (peek()?.value !== ')') {
          args.push(parseExpression(depth + 1));
          if (peek()?.value === ',') take();
          else break;
        }
        expect(')');
        return { kind: 'call', name: token.value, args };
      }
      return { kind: 'name', name: token.value };
    }
    throw new ExpressionError(`unexpected "${token.value}"`);
  };

  const tree = parseExpression(0);
  if (index < tokens.length) throw new ExpressionError(`unexpected "${tokens[index]!.value}"`);
  return { evaluate: (scope) => evaluate(tree, scope) };
}

function evaluate(node: Node, scope: Readonly<Record<string, unknown>>): Value {
  switch (node.kind) {
    case 'literal':
      return node.value;
    case 'name':
      return toValue(own(scope, node.name));
    case 'member': {
      const target = resolve(node.target, scope);
      const key = evaluate(node.key, scope);
      return toValue(
        typeof target === 'object' && target !== null
          ? own(target as Record<string, unknown>, String(key))
          : undefined,
      );
    }
    case 'unary': {
      const operand = evaluate(node.operand, scope);
      return node.operator === '!' ? !truthy(operand) : -number(operand);
    }
    case 'conditional':
      return truthy(evaluate(node.test, scope))
        ? evaluate(node.then, scope)
        : evaluate(node.otherwise, scope);
    case 'call':
      return FUNCTIONS[node.name]!(...node.args.map((arg) => evaluate(arg, scope)));
    case 'binary': {
      if (node.operator === '&&')
        return truthy(evaluate(node.left, scope)) && truthy(evaluate(node.right, scope));
      if (node.operator === '||')
        return truthy(evaluate(node.left, scope)) || truthy(evaluate(node.right, scope));
      const left = evaluate(node.left, scope);
      const right = evaluate(node.right, scope);
      switch (node.operator) {
        case '==':
          return left === right;
        case '!=':
          return left !== right;
        case '+':
          return typeof left === 'string' || typeof right === 'string'
            ? `${left ?? ''}${right ?? ''}`
            : number(left) + number(right);
        case '-':
          return number(left) - number(right);
        case '*':
          return number(left) * number(right);
        case '/':
          return number(right) === 0 ? null : number(left) / number(right);
        case '%':
          return number(right) === 0 ? null : number(left) % number(right);
        case '<':
          return number(left) < number(right);
        case '<=':
          return number(left) <= number(right);
        case '>':
          return number(left) > number(right);
        case '>=':
          return number(left) >= number(right);
      }
      throw new ExpressionError(`unknown operator ${node.operator}`);
    }
  }
}

/** Member targets may be objects (io, attributes); everything else is reduced to a value. */
function resolve(node: Node, scope: Readonly<Record<string, unknown>>): unknown {
  if (node.kind === 'name') return own(scope, node.name);
  if (node.kind === 'member') {
    const target = resolve(node.target, scope);
    return typeof target === 'object' && target !== null
      ? own(target as Record<string, unknown>, String(evaluate(node.key, scope)))
      : undefined;
  }
  return evaluate(node, scope);
}

function own(object: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined;
}

function toValue(value: unknown): Value {
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string')
    return value;
  return null;
}

function number(value: Value): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
    return Number(value);
  return Number.NaN;
}

function truthy(value: Value): boolean {
  return value !== null && value !== false && value !== 0 && value !== '' && !Number.isNaN(value);
}

interface Token {
  type: 'number' | 'string' | 'name' | 'operator' | 'punctuation';
  value: string;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }
    const hex = /^0x[0-9a-fA-F]+/.exec(rest);
    const numberMatch = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (hex) {
      tokens.push({ type: 'number', value: String(Number.parseInt(hex[0], 16)) });
      index += hex[0].length;
      continue;
    }
    if (numberMatch) {
      tokens.push({ type: 'number', value: numberMatch[0] });
      index += numberMatch[0].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (name) {
      tokens.push({ type: 'name', value: name[0] });
      index += name[0].length;
      continue;
    }
    const quote = rest[0];
    if (quote === '"' || quote === "'") {
      let value = '';
      let position = 1;
      while (position < rest.length && rest[position] !== quote) {
        if (rest[position] === '\\') position += 1;
        value += rest[position] ?? '';
        position += 1;
      }
      if (rest[position] !== quote) throw new ExpressionError('unterminated string');
      tokens.push({ type: 'string', value });
      index += position + 1;
      continue;
    }
    const operator = /^(?:==|!=|<=|>=|&&|\|\||[+\-*/%<>!])/.exec(rest);
    if (operator) {
      tokens.push({ type: 'operator', value: operator[0] });
      index += operator[0].length;
      continue;
    }
    if ('()[].,?:'.includes(rest[0]!)) {
      tokens.push({ type: 'punctuation', value: rest[0]! });
      index += 1;
      continue;
    }
    throw new ExpressionError(`unexpected character "${rest[0]}"`);
  }
  return tokens;
}
