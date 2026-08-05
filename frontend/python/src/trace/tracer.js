// tracer.js — мини-интерпретатор Python для пошаговой трассировки.
// Покрывает подмножество, встречающееся в курсе. Используется ТОЛЬКО если
// итоговый вывод совпал с уже проверенным ответом (гарантия корректности).

// ─────────── Токенизатор ───────────
function tokenize(src) {
  const t = []; let i = 0, line = 1;
  const kw = ['for','in','if','elif','else','while','def','return','and','or','not','True','False','None','break','continue','pass'];
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { t.push({ t: 'NL', line }); line++; i++; continue; }
    if (c === ' ') { // считаем отступы только в начале строки
      let n = 0; while (src[i] === ' ') { n++; i++; }
      if (t.length && t[t.length-1].t === 'NL' || t.length===0) t.push({ t: 'IND', n, line });
      continue;
    }
    if (c === '\t') { i++; continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '"' || c === "'") {
      const q = c; i++; let s = '';
      while (i < src.length && src[i] !== q) { if (src[i]==='\\'){s+=src[i+1];i+=2;continue;} s += src[i]; i++; }
      i++; t.push({ t: 'STR', v: s, line }); continue;
    }
    if (/[0-9]/.test(c)) {
      let n = ''; while (i < src.length && /[0-9.]/.test(src[i])) { n += src[i]; i++; }
      t.push({ t: 'NUM', v: n.includes('.') ? parseFloat(n) : parseInt(n,10), line }); continue;
    }
    if (/[a-zA-Zа-яА-Я_]/.test(c)) {
      let id = ''; while (i < src.length && /[a-zA-Z0-9а-яА-Я_]/.test(src[i])) { id += src[i]; i++; }
      t.push({ t: kw.includes(id) ? 'KW' : 'ID', v: id, line }); continue;
    }
    const two = src.substr(i,2);
    if (['==','!=','<=','>=','**','//'].includes(two)) { t.push({t:'OP',v:two,line}); i+=2; continue; }
    if ('()[]{}:,+-*/=<>%.'.includes(c)) { t.push({t:'OP',v:c,line}); i++; continue; }
    throw new Error('bad char ' + c);
  }
  t.push({ t: 'NL', line }); t.push({ t: 'EOF', line });
  return t;
}

// ─────────── Парсер (с учётом отступов) ───────────
function parse(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = (o=0) => toks[p+o];
  const at = (tt, v=null) => peek().t===tt && (v===null||peek().v===v);
  const eat = (tt, v=null) => { if(!at(tt,v)) throw new Error(`ожид ${v??tt}, встр ${peek().v??peek().t}`); return toks[p++]; };
  const skipNL = () => { while (at('NL')) p++; };

  function block(minIndent) {
    // читаем строки с отступом > minIndent
    const stmts = [];
    while (true) {
      skipNL();
      if (at('EOF')) break;
      let ind = 0;
      if (at('IND')) ind = peek().n;
      if (ind <= minIndent) break;
      // съесть отступ и распарсить строку
      eat('IND');
      stmts.push(statement(ind));
      skipNL();
    }
    return stmts;
  }

  function program() {
    const stmts = [];
    skipNL();
    while (!at('EOF')) {
      let ind = 0;
      if (at('IND')) { ind = peek().n; eat('IND'); }
      stmts.push(statement(ind));
      skipNL();
    }
    return { type:'Program', body: stmts };
  }

  function statement(indent) {
    if (at('KW','for')) return forStmt(indent);
    if (at('KW','while')) return whileStmt(indent);
    if (at('KW','if')) return ifStmt(indent);
    if (at('KW','def')) return defStmt(indent);
    if (at('KW','return')) { eat('KW','return'); if (at('NL')) return {type:'Return', value:null}; return {type:'Return', value: expr()}; }
    if (at('KW','break')) { eat('KW','break'); return {type:'Break'}; }
    if (at('KW','continue')) { eat('KW','continue'); return {type:'Continue'}; }
    if (at('KW','pass')) { eat('KW','pass'); return {type:'Pass'}; }
    // assign? lookahead: ID/target followed by =
    const start = p;
    const target = postfixOrName();
    if (at('OP','=')) { eat('OP','='); const value = expr(); return {type:'Assign', target, value}; }
    if (at('OP',',')) {
      // множественное присваивание a, b = ...
      const targets = [target];
      while (at('OP',',')) { eat('OP',','); targets.push(postfixOrName()); }
      eat('OP','='); const values = [expr()]; while (at('OP',',')){eat('OP',',');values.push(expr());}
      return {type:'MultiAssign', targets, values};
    }
    return {type:'ExprStmt', expr: target};
  }

  function forStmt(indent) {
    eat('KW','for'); const v = eat('ID').v; eat('KW','in'); const iter = expr(); eat('OP',':');
    const body = inlineOrBlock(indent);
    return {type:'For', varName:v, iter, body};
  }
  function whileStmt(indent) {
    eat('KW','while'); const cond = expr(); eat('OP',':');
    const body = inlineOrBlock(indent);
    return {type:'While', cond, body};
  }
  function ifStmt(indent) {
    eat('KW','if'); const cond = expr(); eat('OP',':');
    const body = inlineOrBlock(indent);
    const clauses = [{cond, body}];
    let elseBody = null;
    while (true) {
      const save = p; skipNL();
      const ind = at('IND') ? peek().n : 0;              // отступ след. строки (0 если нет IND)
      const kwTok = at('IND') ? peek(1) : peek();         // ключевое слово после возможного IND
      const isElif = ind === indent && kwTok.t==='KW' && kwTok.v==='elif';
      const isElse = ind === indent && kwTok.t==='KW' && kwTok.v==='else';
      if (isElif) {
        if (at('IND')) eat('IND');
        eat('KW','elif'); const c = expr(); eat('OP',':');
        clauses.push({ cond: c, body: inlineOrBlock(indent) });
        continue;
      }
      if (isElse) {
        if (at('IND')) eat('IND');
        eat('KW','else'); eat('OP',':');
        elseBody = inlineOrBlock(indent);
        break;
      }
      p = save; break;
    }
    return {type:'If', clauses, elseBody};
  }
  function defStmt(indent) {
    eat('KW','def'); const name = eat('ID').v; eat('OP','('); const params=[];
    while (!at('OP',')')) { params.push(eat('ID').v); if (at('OP',',')) eat('OP',','); }
    eat('OP',')'); eat('OP',':');
    const body = inlineOrBlock(indent);
    return {type:'Def', name, params, body};
  }

  function inlineOrBlock(indent) {
    // тело на той же строке (одна инструкция) или блок с отступом
    if (!at('NL')) { return [ statement(indent+1) ]; }
    return block(indent);
  }

  // ── выражения ──
  function expr() { return orE(); }
  function orE() { let l = andE(); while (at('KW','or')) { eat('KW','or'); l = {type:'Bin',op:'or',l,r:andE()}; } return l; }
  function andE() { let l = notE(); while (at('KW','and')) { eat('KW','and'); l = {type:'Bin',op:'and',l,r:notE()}; } return l; }
  function notE() { if (at('KW','not')) { eat('KW','not'); return {type:'Not', v:notE()}; } return cmp(); }
  function cmp() {
    let l = add();
    while ((at('OP')&&['==','!=','<','>','<=','>='].includes(peek().v)) || at('KW','in') || (at('KW','not')&&peek(1).v==='in')) {
      if (at('KW','not')) { eat('KW','not'); eat('KW','in'); l = {type:'Bin',op:'notin',l,r:add()}; }
      else if (at('KW','in')) { eat('KW','in'); l = {type:'Bin',op:'in',l,r:add()}; }
      else { const op = eat('OP').v; l = {type:'Bin',op,l,r:add()}; }
    }
    return l;
  }
  function add() { let l = mul(); while (at('OP','+')||at('OP','-')) { const op=eat('OP').v; l={type:'Bin',op,l,r:mul()}; } return l; }
  function mul() { let l = unary(); while (at('OP')&&['*','/','//','%'].includes(peek().v)) { const op=eat('OP').v; l={type:'Bin',op,l,r:unary()}; } return l; }
  function unary() { if (at('OP','-')) { eat('OP','-'); return {type:'Neg', v:unary()}; } return power(); }
  function power() { let l = postfixOrName(); if (at('OP','**')) { eat('OP','**'); return {type:'Bin',op:'**',l,r:unary()}; } return l; }

  function postfixOrName() {
    let node = atom();
    while (true) {
      if (at('OP','.')) { eat('OP','.'); const name = eat('ID').v; node = {type:'Member', obj:node, name}; }
      else if (at('OP','(')) { eat('OP','('); const args=[]; while(!at('OP',')')){args.push(expr()); if(at('OP',','))eat('OP',',');} eat('OP',')'); node={type:'Call', callee:node, args}; }
      else if (at('OP','[')) {
        eat('OP','[');
        let a=null,b=null,c=null,isSlice=false;
        if (!at('OP',':')) a = expr();
        if (at('OP',':')) { isSlice=true; eat('OP',':'); if(!at('OP',':')&&!at('OP',']')) b=expr(); if(at('OP',':')){eat('OP',':'); if(!at('OP',']'))c=expr();} }
        eat('OP',']');
        node = isSlice ? {type:'Slice', obj:node, a,b,c} : {type:'Index', obj:node, index:a};
      }
      else break;
    }
    return node;
  }

  function atom() {
    if (at('NUM')) return {type:'Num', v:eat('NUM').v};
    if (at('STR')) return {type:'Str', v:eat('STR').v};
    if (at('KW','True')) { eat('KW','True'); return {type:'Bool', v:true}; }
    if (at('KW','False')) { eat('KW','False'); return {type:'Bool', v:false}; }
    if (at('KW','None')) { eat('KW','None'); return {type:'None'}; }
    if (at('ID')) return {type:'Name', name:eat('ID').v};
    if (at('OP','(')) { eat('OP','('); const e=expr(); eat('OP',')'); return e; }
    if (at('OP','[')) { eat('OP','['); const items=[]; while(!at('OP',']')){items.push(expr()); if(at('OP',','))eat('OP',',');} eat('OP',']'); return {type:'ListLit', items}; }
    if (at('OP','{')) {
      eat('OP','{'); const entries=[]; let isDict=false;
      while(!at('OP','}')){ const k=expr(); if(at('OP',':')){isDict=true;eat('OP',':');const v=expr();entries.push([k,v]);} else entries.push([k]); if(at('OP',','))eat('OP',','); }
      eat('OP','}');
      // пустые {} в Python — это словарь, не множество
      return (isDict || entries.length===0) ? {type:'DictLit', entries} : {type:'SetLit', items:entries.map(e=>e[0])};
    }
    throw new Error('неожид ' + (peek().v??peek().t));
  }

  return program();
}

// ─────────── Исполнение с трассировкой ───────────
class ReturnSignal { constructor(v){this.v=v;} }
class BreakSignal {}
class ContinueSignal {}

const MAX_STEPS = 300;

export function trace(src, seed = {}) {
  const ast = parse(src);
  const steps = [];
  const output = [];
  const scopes = [ new Map() ];
  for (const [k, v] of Object.entries(seed)) scopes[0].set(k, v);
  const funcs = new Map();
  let stepCount = 0;

  const push = (text) => { if (steps.length < MAX_STEPS) steps.push(text); };
  const getVar = (n) => { for (let i=scopes.length-1;i>=0;i--) if (scopes[i].has(n)) return scopes[i].get(n); throw new Error('нет '+n); };
  const setVar = (n,v) => { scopes[scopes.length-1].set(n,v); };

  execBlock(ast.body);

  return { steps, output: output.join('\n') };

  function execBlock(b){ for (const s of b) execStmt(s); }

  function execStmt(node){
    if (stepCount++ > 5000) throw new Error('too long');
    switch(node.type){
      case 'Assign': { const v = evalE(node.value); assignTo(node.target, v); push(fmtAssign(node.target,v)); return; }
      case 'MultiAssign': { const vals = node.values.map(evalE); node.targets.forEach((t,i)=>{assignTo(t,vals[i]); push(fmtAssign(t,vals[i]));}); return; }
      case 'ExprStmt': evalE(node.expr); return;
      case 'For': return execFor(node);
      case 'While': return execWhile(node);
      case 'If': return execIf(node);
      case 'Def': funcs.set(node.name, node); return;
      case 'Return': throw new ReturnSignal(node.value?evalE(node.value):null);
      case 'Break': throw new BreakSignal();
      case 'Continue': throw new ContinueSignal();
      case 'Pass': return;
      default: throw new Error('stmt '+node.type);
    }
  }

  function execFor(node){
    const seq = toSeq(evalE(node.iter));
    push(`цикл for: ${node.varName} пробегает ${seq.slice(0,8).map(pyStr).join(', ')}${seq.length>8?'…':''}`);
    for (const val of seq){
      setVar(node.varName, val);
      push(`  ${node.varName} = ${pyStr(val)}`);
      try { execBlock(node.body); }
      catch(e){ if(e instanceof BreakSignal) break; if(e instanceof ContinueSignal) continue; throw e; }
    }
  }

  function execWhile(node){
    let guard=0;
    while (truthy(evalE(node.cond))){
      if (guard++>2000) throw new Error('inf');
      push(`while: условие истинно`);
      try { execBlock(node.body); }
      catch(e){ if(e instanceof BreakSignal) break; if(e instanceof ContinueSignal) continue; throw e; }
    }
    push(`while: условие ложно — выход`);
  }

  function execIf(node){
    for (const cl of node.clauses){
      const r = evalE(cl.cond);
      push(`проверка условия → ${truthy(r)?'истина':'ложь'}`);
      if (truthy(r)) { execBlock(cl.body); return; }
    }
    if (node.elseBody){ push('иначе (else)'); execBlock(node.elseBody); }
  }

  function assignTo(target, v){
    if (target.type==='Name') setVar(target.name, v);
    else if (target.type==='Index'){ const obj=evalE(target.obj); const idx=evalE(target.index);
      if (Array.isArray(obj)) obj[normIdx(idx,obj.length)] = v;
      else if (obj && obj.__dict__) obj.map.set(keyOf(idx), v);
      else throw new Error('assign index');
    } else throw new Error('assign target');
  }

  function evalE(node){
    switch(node.type){
      case 'Num': return node.v;
      case 'Str': return node.v;
      case 'Bool': return node.v;
      case 'None': return null;
      case 'Name': {
        if (node.name==='True') return true; if (node.name==='False') return false; if (node.name==='None') return null;
        return getVar(node.name);
      }
      case 'ListLit': return node.items.map(evalE);
      case 'SetLit': { const s=new Set(); for(const it of node.items) s.add(keyOf(evalE(it))); return {__set__:true, set:s}; }
      case 'DictLit': { const m=new Map(); for(const [k,val] of node.entries) m.set(keyOf(evalE(k)), evalE(val)); return {__dict__:true, map:m}; }
      case 'Neg': return -evalE(node.v);
      case 'Not': return !truthy(evalE(node.v));
      case 'Bin': return binop(node);
      case 'Index': return indexGet(evalE(node.obj), evalE(node.index));
      case 'Slice': return sliceGet(node);
      case 'Member': return {__bound__:true, obj:evalE(node.obj), name:node.name};
      case 'Call': return callE(node);
      default: throw new Error('expr '+node.type);
    }
  }

  function binop(node){
    if (node.op==='and'){ const l=evalE(node.l); return truthy(l)?evalE(node.r):l; }
    if (node.op==='or'){ const l=evalE(node.l); return truthy(l)?l:evalE(node.r); }
    const l=evalE(node.l), r=evalE(node.r);
    switch(node.op){
      case '+': if(typeof l==='string'||typeof r==='string') return String(pyStr(l))+String(pyStr(r)); if(Array.isArray(l)&&Array.isArray(r)) return l.concat(r); return l+r;
      case '-': return l-r;
      case '*': if(typeof l==='string') return l.repeat(r); if(typeof r==='string') return r.repeat(l); if(Array.isArray(l)) return Array.from({length:r}).flatMap(()=>l); return l*r;
      case '/': return l/r;
      case '//': return Math.floor(l/r);
      case '%': return ((l%r)+r)%r;
      case '**': return Math.pow(l,r);
      case '==': return eq(l,r);
      case '!=': return !eq(l,r);
      case '<': return l<r; case '>': return l>r; case '<=': return l<=r; case '>=': return l>=r;
      case 'in': return inOp(l,r);
      case 'notin': return !inOp(l,r);
      default: throw new Error('op '+node.op);
    }
  }

  function callE(node){
    // метод?
    if (node.callee.type==='Member'){
      const obj = evalE(node.callee.obj);
      const args = node.args.map(evalE);
      return method(obj, node.callee.name, args);
    }
    const name = node.callee.type==='Name' ? node.callee.name : null;
    const args = node.args.map(evalE);
    // пользовательская функция
    if (name && funcs.has(name)){
      const fn = funcs.get(name);
      const sc = new Map(); fn.params.forEach((pn,i)=>sc.set(pn,args[i]));
      scopes.push(sc);
      let ret = null;
      try { execBlock(fn.body); } catch(e){ if(e instanceof ReturnSignal) ret=e.v; else { scopes.pop(); throw e; } }
      scopes.pop();
      push(`${name}(${args.map(pyStr).join(', ')}) вернула ${pyStr(ret)}`);
      return ret;
    }
    return builtin(name, args, node);
  }

  function builtin(name, args, node){
    switch(name){
      case 'print': { const s = args.map(pyStr).join(' '); output.push(s); push(`▶ печатает: ${s}`); return null; }
      case 'range': { let a=0,b=0,c=1; if(args.length===1)b=args[0]; else if(args.length===2){a=args[0];b=args[1];} else {a=args[0];b=args[1];c=args[2];} return {__range__:true,start:a,stop:b,step:c}; }
      case 'len': { const v=args[0]; if(typeof v==='string'||Array.isArray(v))return v.length; if(v&&v.__set__)return v.set.size; if(v&&v.__dict__)return v.map.size; if(v&&v.__range__)return rangeArr(v).length; throw new Error('len'); }
      case 'sum': return toSeq(args[0]).reduce((a,b)=>a+b,0);
      case 'max': { const s = args.length>1?args:toSeq(args[0]); return s.reduce((a,b)=>b>a?b:a); }
      case 'min': { const s = args.length>1?args:toSeq(args[0]); return s.reduce((a,b)=>b<a?b:a); }
      case 'abs': return Math.abs(args[0]);
      case 'round': return Math.round(args[0]);
      case 'int': return typeof args[0]==='string'?parseInt(args[0],10):Math.trunc(args[0]);
      case 'str': return pyStr(args[0]);
      case 'float': return parseFloat(args[0]);
      case 'sorted': { const a=[...toSeq(args[0])]; a.sort((x,y)=>x>y?1:x<y?-1:0); return a; }
      // math.* приходит как Member → см. method; но import math\nmath.sqrt(...) → callee Member obj=Name math
      default: throw new Error('builtin '+name);
    }
  }

  function method(obj, name, args){
    // math как «модуль»
    if (obj && obj.__module__==='math'){
      switch(name){
        case 'sqrt': return Math.sqrt(args[0]);
        case 'floor': return Math.floor(args[0]);
        case 'ceil': return Math.ceil(args[0]);
        case 'factorial': { let r=1; for(let k=2;k<=args[0];k++) r*=k; return r; }
        default: throw new Error('math.'+name);
      }
    }
    if (typeof obj==='string'){
      switch(name){
        case 'upper': return obj.toUpperCase();
        case 'lower': return obj.toLowerCase();
        case 'count': return obj.split(args[0]).length-1;
        case 'find': return obj.indexOf(args[0]);
        case 'replace': return obj.split(args[0]).join(args[1]);
        case 'split': return args.length? obj.split(args[0]) : obj.split(/\s+/).filter(Boolean);
        case 'join': return toSeq(args[0]).map(pyStr).join(obj);
        case 'strip': return obj.trim();
        default: throw new Error('str.'+name);
      }
    }
    if (Array.isArray(obj)){
      switch(name){
        case 'append': obj.push(args[0]); push(`добавили ${pyStr(args[0])} → ${pyStr(obj)}`); return null;
        case 'sort': obj.sort((x,y)=>x>y?1:x<y?-1:0); push(`отсортировали → ${pyStr(obj)}`); return null;
        case 'pop': return args.length?obj.splice(normIdx(args[0],obj.length),1)[0]:obj.pop();
        case 'insert': obj.splice(args[0],0,args[1]); return null;
        case 'remove': { const idx=obj.indexOf(args[0]); if(idx>=0)obj.splice(idx,1); return null; }
        case 'count': return obj.filter(x=>eq(x,args[0])).length;
        case 'index': return obj.indexOf(args[0]);
        default: throw new Error('list.'+name);
      }
    }
    if (obj && obj.__dict__){
      switch(name){
        case 'get': { const k=keyOf(args[0]); return obj.map.has(k)?obj.map.get(k):(args.length>1?args[1]:null); }
        default: throw new Error('dict.'+name);
      }
    }
    throw new Error('method '+name);
  }

  // ── помощники ──
  function indexGet(obj, idx){
    if (typeof obj==='string') return obj[normIdx(idx,obj.length)];
    if (Array.isArray(obj)) return obj[normIdx(idx,obj.length)];
    if (obj && obj.__dict__){ const k=keyOf(idx); if(!obj.map.has(k)) throw new Error('key'); return obj.map.get(k); }
    throw new Error('index');
  }
  function sliceGet(node){
    const obj = evalE(node.obj);
    const len = obj.length;
    let step = node.c!=null?evalE(node.c):1;
    let a = node.a!=null?evalE(node.a):(step>0?0:len-1);
    let b = node.b!=null?evalE(node.b):(step>0?len:-len-1);
    a = a<0?a+len:a; b = b<0?b+len:b;
    const arr = typeof obj==='string'?obj.split(''):[...obj];
    const out=[];
    if (step>0){ for(let i=Math.max(0,a);i<Math.min(len,b);i+=step) out.push(arr[i]); }
    else { for(let i=Math.min(len-1,a);i>Math.max(-1,b);i+=step) out.push(arr[i]); }
    return typeof obj==='string'?out.join(''):out;
  }
  function normIdx(i,len){ return i<0?i+len:i; }
  function toSeq(v){ if(v&&v.__range__) return rangeArr(v); if(typeof v==='string') return v.split(''); if(Array.isArray(v)) return v; if(v&&v.__set__) return [...v.set]; if(v&&v.__dict__) return [...v.map.keys()]; throw new Error('seq'); }
  function rangeArr(r){ const out=[]; if(r.step>0){for(let i=r.start;i<r.stop;i+=r.step)out.push(i);} else {for(let i=r.start;i>r.stop;i+=r.step)out.push(i);} return out; }
  function inOp(l,r){ if(typeof r==='string') return r.includes(l); if(Array.isArray(r)) return r.some(x=>eq(x,l)); if(r&&r.__set__) return r.set.has(keyOf(l)); if(r&&r.__dict__) return r.map.has(keyOf(l)); return false; }
  function eq(a,b){ return a===b; }
  function keyOf(v){ return typeof v==='string'?'s:'+v:'n:'+v; }
  function truthy(v){ if(v===null||v===false) return false; if(v===0||v==='') return false; if(Array.isArray(v)) return v.length>0; return true; }
  function fmtAssign(t,v){ if(t.type==='Name') return `${t.name} = ${pyStr(v)}`; return `изменили элемент → ${pyStr(v)}`; }
}

// import math → в scope переменная math как модуль. Обрабатываем в трассировке:
// строку "import math" парсер не знает, поэтому убираем её до парса (см. prepareSource).
export function prepareSource(src){
  const lines = src.split('\n');
  const kept = [];
  let hasMath=false, hasRandom=false;
  for (const ln of lines){
    const s = ln.trim();
    if (s.startsWith('import math')) { hasMath=true; continue; }
    if (s.startsWith('import random')) { hasRandom=true; continue; }
    kept.push(ln);
  }
  return { code: kept.join('\n'), hasMath, hasRandom };
}

// Питоновское строковое представление
function pyStr(v){
  if (v===null) return 'None';
  if (v===true) return 'True';
  if (v===false) return 'False';
  if (Array.isArray(v)) return '['+v.map(pyRepr).join(', ')+']';
  if (v&&v.__set__) return '{'+[...v.set].map(k=>k.startsWith('s:')?`'${k.slice(2)}'`:k.slice(2)).join(', ')+'}';
  if (v&&v.__dict__) return '{'+[...v.map.entries()].map(([k,val])=>`${k.startsWith('s:')?`'${k.slice(2)}'`:k.slice(2)}: ${pyRepr(val)}`).join(', ')+'}';
  if (typeof v==='number' && Number.isInteger(v)) return String(v);
  return String(v);
}
function pyRepr(v){ if(typeof v==='string') return `'${v}'`; return pyStr(v); }

// Главная функция: вернуть трассировку ТОЛЬКО если вывод совпал с expected
export function safeTrace(src, expected){
  try {
    const prep = prepareSource(src);
    const seed = {};
    if (prep.hasMath) seed.math = { __module__: 'math' };
    if (prep.hasRandom) return null; // random недетерминирован — трассировку не показываем
    const res = trace(prep.code, seed);
    const out = (res.output || '').replace(/\s+$/,'');
    const exp = (expected || '').split('\n').map(l=>l.trim()).join('\n').replace(/\s+$/,'');
    const got = out.split('\n').map(l=>l.trim()).join('\n');
    if (got === exp && res.steps.length > 1) return res.steps;
    return null;
  } catch(e){ return null; }
}
