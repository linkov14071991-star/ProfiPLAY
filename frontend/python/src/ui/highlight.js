// highlight.js — простая подсветка Python-кода в HTML.

const KEYWORDS = ['for','in','if','elif','else','while','def','return','import','and','or','not','True','False','None','break','continue'];
const BUILTINS = ['print','input','int','float','str','len','range','sum','max','min','sorted','abs','type','list','dict','set','round'];

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}

export function highlight(code) {
  return code.split('\n').map(line => {
    let out = '';
    let i = 0;
    while (i < line.length) {
      const c = line[i];
      // комментарий
      if (c === '#') {
        out += `<span class="cm">${escapeHtml(line.slice(i))}</span>`;
        break;
      }
      // строка
      if (c === '"' || c === "'") {
        const q = c; let s = q; i++;
        while (i < line.length && line[i] !== q) { s += line[i]; i++; }
        if (i < line.length) { s += q; i++; }
        out += `<span class="str">${escapeHtml(s)}</span>`;
        continue;
      }
      // число
      if (/[0-9]/.test(c)) {
        let n = '';
        while (i < line.length && /[0-9.]/.test(line[i])) { n += line[i]; i++; }
        out += `<span class="num">${n}</span>`;
        continue;
      }
      // идентификатор
      if (/[a-zA-Zа-яА-Я_]/.test(c)) {
        let id = '';
        while (i < line.length && /[a-zA-Z0-9а-яА-Я_]/.test(line[i])) { id += line[i]; i++; }
        if (KEYWORDS.includes(id)) out += `<span class="kw">${id}</span>`;
        else if (BUILTINS.includes(id)) out += `<span class="fn">${id}</span>`;
        else out += escapeHtml(id);
        continue;
      }
      out += escapeHtml(c);
      i++;
    }
    return out;
  }).join('\n');
}

export function codeBlock(code) {
  if (!code) return '';
  return `<pre class="code">${highlight(code)}</pre>`;
}
