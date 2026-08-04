// parser.js — минимальный recursive-descent парсер подмножества Python
// (см. TDD §3). Для Этапа 1: только print(строка), присваивание x = expr.

/**
 * @typedef {Object} AstNode
 * @property {string} type
 * @property {number} line
 */

/** Токенизатор */
function tokenize(src) {
  const tokens = [];
  let i = 0, line = 1;
  while (i < src.length) {
    const c = src[i];

    if (c === '\n') { tokens.push({ t: 'NL', line }); line++; i++; continue; }
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }

    // строка "..."
    if (c === '"' || c === "'") {
      const quote = c; i++;
      let s = '';
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < src.length) { s += src[i+1]; i += 2; continue; }
        s += src[i]; i++;
      }
      if (src[i] !== quote) throw new ParseError(`Не хватает закрывающей кавычки`, line);
      i++;
      tokens.push({ t: 'STR', v: s, line });
      continue;
    }

    // число (в том числе отрицательные пока не поддерживаем — знак отдельно)
    if (/[0-9]/.test(c)) {
      let n = '';
      while (i < src.length && /[0-9]/.test(src[i])) { n += src[i]; i++; }
      tokens.push({ t: 'NUM', v: parseInt(n, 10), line });
      continue;
    }

    // идентификатор / ключевое слово
    if (/[a-zA-Zа-яА-Я_]/.test(c)) {
      let id = '';
      while (i < src.length && /[a-zA-Z0-9а-яА-Я_.]/.test(src[i])) { id += src[i]; i++; }
      const kw = ['for','in','if','else','elif','def','return','True','False','None'];
      tokens.push({ t: kw.includes(id) ? 'KW' : 'ID', v: id, line });
      continue;
    }

    // операторы / скобки
    if ('()[]:,+-*/=<>!%'.includes(c)) {
      // двухсимвольные
      const two = src.substr(i, 2);
      if (['==','!=','<=','>=','**','//'].includes(two)) {
        tokens.push({ t: 'OP', v: two, line }); i += 2; continue;
      }
      tokens.push({ t: 'OP', v: c, line }); i++; continue;
    }

    throw new ParseError(`Странный символ: ${c}`, line);
  }
  tokens.push({ t: 'EOF', line });
  return tokens;
}

export class ParseError extends Error {
  constructor(message, line = 0, hint = null) {
    super(message);
    this.type = 'ParseError';
    this.line = line;
    this.hint = hint;
  }
}

/** Парсер */
export function parse(src) {
  const tokens = tokenize(src);
  let pos = 0;

  const peek = (offset = 0) => tokens[pos + offset];
  const eat = (t, v = null) => {
    const tok = tokens[pos];
    if (tok.t !== t || (v !== null && tok.v !== v)) {
      throw new ParseError(
        `Ожидалось ${v ?? t}, получено ${tok.v ?? tok.t}`, tok.line
      );
    }
    pos++;
    return tok;
  };
  const match = (t, v = null) => {
    const tok = tokens[pos];
    if (tok.t !== t) return false;
    if (v !== null && tok.v !== v) return false;
    return true;
  };

  const skipNL = () => { while (match('NL')) pos++; };

  // program := stmt* EOF
  function program() {
    const body = [];
    skipNL();
    while (!match('EOF')) {
      body.push(stmt());
      skipNL();
    }
    return { type: 'Program', body };
  }

  // stmt := for_stmt | assign | expr_stmt
  function stmt() {
    if (match('KW', 'for')) return forStmt();
    // assign?
    if (match('ID') && peek(1).t === 'OP' && peek(1).v === '=') {
      return assign();
    }
    return exprStmt();
  }

  function forStmt() {
    const tok = eat('KW', 'for');
    const iterVar = eat('ID').v;
    eat('KW', 'in');
    const iterable = expr();
    eat('OP', ':');
    skipNL();
    // тело: пока просто одна инструкция с индентом — но упрощаем: одна инструкция подряд
    const body = [ stmt() ];
    return { type: 'For', iterVar, iterable, body, line: tok.line };
  }

  function assign() {
    const nameTok = eat('ID');
    eat('OP', '=');
    const value = expr();
    return { type: 'Assign', name: nameTok.v, value, line: nameTok.line };
  }

  function exprStmt() {
    const e = expr();
    return { type: 'ExprStmt', expr: e, line: e.line };
  }

  // expr := compare
  // compare := addsub (('==' | '!=' | '<' | '>' | '<=' | '>=') addsub)?
  // addsub  := muldiv (('+' | '-') muldiv)*
  // muldiv  := unary (('*' | '/' | '//' | '%') unary)*
  // unary   := '-' unary | call
  function expr() { return compare(); }

  function compare() {
    let left = addsub();
    if (match('OP') && ['==','!=','<','>','<=','>='].includes(peek().v)) {
      const op = eat('OP').v;
      const right = addsub();
      return { type: 'BinOp', op, left, right, line: left.line };
    }
    return left;
  }

  function addsub() {
    let left = muldiv();
    while (match('OP') && (peek().v === '+' || peek().v === '-')) {
      const op = eat('OP').v;
      const right = muldiv();
      left = { type: 'BinOp', op, left, right, line: left.line };
    }
    return left;
  }

  function muldiv() {
    let left = unary();
    while (match('OP') && ['*','/','//','%'].includes(peek().v)) {
      const op = eat('OP').v;
      const right = unary();
      left = { type: 'BinOp', op, left, right, line: left.line };
    }
    return left;
  }

  function unary() {
    if (match('OP', '-')) {
      const tok = eat('OP', '-');
      const value = unary();
      return { type: 'Unary', op: '-', value, line: tok.line };
    }
    return call();
  }

  function call() {
    const base = atom();
    if (match('OP', '(')) {
      pos++;
      const args = [];
      while (!match('OP', ')')) {
        args.push(expr());
        if (match('OP', ',')) pos++;
      }
      eat('OP', ')');
      return { type: 'Call', callee: base, args, line: base.line };
    }
    if (match('OP', '[')) {
      pos++;
      const index = expr();
      eat('OP', ']');
      return { type: 'Index', object: base, index, line: base.line };
    }
    return base;
  }

  function atom() {
    const tok = tokens[pos];
    if (tok.t === 'STR') { pos++; return { type: 'Str', value: tok.v, line: tok.line }; }
    if (tok.t === 'NUM') { pos++; return { type: 'Num', value: tok.v, line: tok.line }; }
    if (tok.t === 'ID')  { pos++; return { type: 'Name', name: tok.v, line: tok.line }; }
    if (tok.t === 'OP' && tok.v === '[') {
      pos++;
      const items = [];
      while (!match('OP', ']')) {
        items.push(expr());
        if (match('OP', ',')) pos++;
      }
      eat('OP', ']');
      return { type: 'ListLit', items, line: tok.line };
    }
    throw new ParseError(`Неожиданный токен: ${tok.v ?? tok.t}`, tok.line);
  }

  return program();
}
