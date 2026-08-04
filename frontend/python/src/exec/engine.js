// engine.js — Execution Engine.
// AST → упорядоченный поток событий (см. TDD §4).

let uid = 0;
const nextId = () => `o${++uid}`;

class RuntimeError extends Error {
  constructor(message, hint = null) {
    super(message);
    this.hint = hint;
  }
}

function numOp(l, r, fn) {
  if (typeof l !== 'number' || typeof r !== 'number') {
    throw new RuntimeError('Оператор работает только с числами');
  }
  return fn(l, r);
}

export function execute(ast, environment = {}) {
  const events = [];
  const state = {
    vars: new Map(),
    objects: new Map(),
    profikPos: environment.profikStart ?? { x: 0, y: 0 },
    output: [],
  };

  const emit = (kind, data = {}) => events.push({ kind, ...data });

  emit('ProgramStart');

  try {
    execBlock(ast.body);
    emit('ProgramEnd', { success: true });
  } catch (e) {
    if (e instanceof RuntimeError) {
      emit('RuntimeError', { message: e.message, hint: e.hint });
      emit('ProgramEnd', { success: false });
    } else {
      throw e;
    }
  }

  return { events, finalState: state };

  function execBlock(stmts) {
    for (const s of stmts) execStmt(s);
  }

  function execStmt(node) {
    switch (node.type) {
      case 'Assign': return execAssign(node);
      case 'For':    return execFor(node);
      case 'ExprStmt': evalExpr(node.expr); return;
      default:
        throw new RuntimeError(`Неизвестная инструкция: ${node.type}`);
    }
  }

  function execAssign(node) {
    const val = evalExpr(node.value);
    const existed = state.vars.has(node.name);
    state.vars.set(node.name, val);
    if (existed) {
      emit('VariableAssigned', { name: node.name, newValue: val });
    } else {
      emit('VariableCreated', { name: node.name, value: val });
    }
  }

  function execFor(node) {
    const iterable = evalExpr(node.iterable);
    const loopId = nextId();
    let seq;
    if (iterable && iterable.kind === 'range') {
      seq = expandRange(iterable);
      emit('LoopStarted', { loopId, iterVar: node.iterVar, iterableId: iterable.id, iterableKind: 'range' });
    } else if (Array.isArray(iterable)) {
      seq = iterable;
      emit('LoopStarted', { loopId, iterVar: node.iterVar, iterableKind: 'list' });
    } else if (typeof iterable === 'string') {
      seq = iterable.split('');
      emit('LoopStarted', { loopId, iterVar: node.iterVar, iterableKind: 'string' });
    } else {
      throw new RuntimeError('Нельзя пройтись циклом по этому объекту');
    }

    let idx = 0;
    for (const value of seq) {
      emit('LoopIteration', { loopId, iterationIndex: idx, iterValue: value });
      const had = state.vars.has(node.iterVar);
      state.vars.set(node.iterVar, value);
      emit(had ? 'VariableAssigned' : 'VariableCreated',
           { name: node.iterVar, [had ? 'newValue' : 'value']: value });
      execBlock(node.body);
      idx++;
    }
    emit('LoopFinished', { loopId });
  }

  function expandRange(r) {
    const out = [];
    if (r.step > 0) {
      for (let i = r.start; i < r.stop; i += r.step) out.push(i);
    } else if (r.step < 0) {
      for (let i = r.start; i > r.stop; i += r.step) out.push(i);
    }
    return out;
  }

  function evalExpr(node) {
    switch (node.type) {
      case 'Num': return node.value;
      case 'Str': return node.value;
      case 'Name': {
        if (!state.vars.has(node.name)) {
          throw new RuntimeError(`Переменная ${node.name} не создана`,
            'Проверь: точно ли ты её присвоил выше?');
        }
        return state.vars.get(node.name);
      }
      case 'ListLit': {
        const items = node.items.map(evalExpr);
        const id = nextId();
        const list = { kind: 'list', id, items };
        state.objects.set(id, list);
        emit('ListCreated', { id, items });
        return items;
      }
      case 'Call': return evalCall(node);
      case 'Unary': {
        const v = evalExpr(node.value);
        if (node.op === '-') {
          if (typeof v !== 'number') throw new RuntimeError('Минус применяется только к числу');
          return -v;
        }
        throw new RuntimeError(`Незнакомый унарный оператор: ${node.op}`);
      }
      case 'BinOp': {
        const l = evalExpr(node.left);
        const r = evalExpr(node.right);
        switch (node.op) {
          case '+':
            if (typeof l === 'string' || typeof r === 'string') return String(l) + String(r);
            if (typeof l === 'number' && typeof r === 'number') return l + r;
            throw new RuntimeError('Нельзя сложить эти значения');
          case '-': return numOp(l, r, (a,b) => a - b);
          case '*':
            if (typeof l === 'string' && typeof r === 'number') return l.repeat(r);
            return numOp(l, r, (a,b) => a * b);
          case '/':
            if (r === 0) throw new RuntimeError('Деление на ноль');
            return numOp(l, r, (a,b) => a / b);
          case '//':
            if (r === 0) throw new RuntimeError('Деление на ноль');
            return numOp(l, r, (a,b) => Math.floor(a / b));
          case '%':
            if (r === 0) throw new RuntimeError('Остаток от деления на ноль');
            return numOp(l, r, (a,b) => ((a % b) + b) % b);
          case '==': return l === r;
          case '!=': return l !== r;
          case '<':  return l < r;
          case '>':  return l > r;
          case '<=': return l <= r;
          case '>=': return l >= r;
          default: throw new RuntimeError(`Незнакомый оператор: ${node.op}`);
        }
      }
      case 'Index': {
        const obj = evalExpr(node.object);
        const idx = evalExpr(node.index);
        if (Array.isArray(obj)) {
          if (idx < 0 || idx >= obj.length) {
            throw new RuntimeError(`В списке нет элемента с номером ${idx}`,
              'Помни: индексы начинаются с 0.');
          }
          return obj[idx];
        }
        throw new RuntimeError('К этому объекту нельзя обратиться по индексу');
      }
      default: throw new RuntimeError(`Неизвестное выражение: ${node.type}`);
    }
  }

  function evalCall(node) {
    // callee.name (для встроенных: print, range, profik.xxx)
    const name = node.callee.name;
    const args = node.args.map(evalExpr);

    switch (name) {
      case 'print': {
        const text = args.map(String).join(' ');
        state.output.push(text);
        emit('PrintCalled', { text });
        emit('ProfikSay', { text });
        return null;
      }
      case 'range': {
        let start = 0, stop = 0, step = 1;
        if (args.length === 1) { stop = args[0]; }
        else if (args.length === 2) { start = args[0]; stop = args[1]; }
        else if (args.length === 3) { start = args[0]; stop = args[1]; step = args[2]; }
        else throw new RuntimeError('range принимает 1, 2 или 3 аргумента');
        if (step === 0) throw new RuntimeError('шаг range не может быть 0');
        const id = nextId();
        const rangeObj = { kind: 'range', id, start, stop, step };
        state.objects.set(id, rangeObj);
        emit('RangeCreated', { id, start, stop, step });
        return rangeObj;
      }
      case 'len': {
        const v = args[0];
        if (Array.isArray(v) || typeof v === 'string') return v.length;
        if (v && v.kind === 'range') {
          if (v.step > 0) return Math.max(0, Math.ceil((v.stop - v.start) / v.step));
          if (v.step < 0) return Math.max(0, Math.ceil((v.start - v.stop) / -v.step));
        }
        throw new RuntimeError('len не работает с этим объектом');
      }
      case 'profik.hop': {
        const from = { ...state.profikPos };
        state.profikPos.x += 1;
        emit('ProfikHop', { from, to: { ...state.profikPos } });
        return null;
      }
      case 'profik.walk': {
        const from = { ...state.profikPos };
        state.profikPos.x += 1;
        emit('ProfikStep', { from, to: { ...state.profikPos } });
        return null;
      }
      case 'profik.say': {
        const text = String(args[0] ?? '');
        emit('ProfikSay', { text });
        return null;
      }
      case 'profik.pick_up': {
        emit('ProfikPickUp', { value: args[0] });
        return null;
      }
      default:
        throw new RuntimeError(`Незнакомая команда: ${name}`);
    }
  }
}
