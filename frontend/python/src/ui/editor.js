// editor.js — простой read-only редактор для этапа 1
// (block-mode editor — этап 2)

export class Editor {
  constructor(el) {
    this.el = el;
    this.code = '';
  }
  setReadOnlyCode(code) {
    this.code = code;
    this.el.innerHTML = this.highlight(code);
  }
  getCode() { return this.code; }

  highlight(code) {
    // очень простая подсветка
    const keywords = ['for','in','if','else','def','return','True','False','None'];
    const fns = ['print','range','len'];

    // работаем построчно, чтобы не резать строковые литералы неправильно
    return code.split('\n').map(line => {
      let out = '';
      let i = 0;
      while (i < line.length) {
        const c = line[i];
        if (c === '"' || c === "'") {
          const q = c;
          let s = q;
          i++;
          while (i < line.length && line[i] !== q) { s += this.escapeHtml(line[i]); i++; }
          s += q; i++;
          out += `<span class="tok-str">${s}</span>`;
          continue;
        }
        if (/[0-9]/.test(c)) {
          let n = '';
          while (i < line.length && /[0-9]/.test(line[i])) { n += line[i]; i++; }
          out += `<span class="tok-num">${n}</span>`;
          continue;
        }
        if (/[a-zA-Zа-яА-Я_]/.test(c)) {
          let id = '';
          while (i < line.length && /[a-zA-Z0-9а-яА-Я_.]/.test(line[i])) { id += line[i]; i++; }
          if (keywords.includes(id)) out += `<span class="tok-kw">${id}</span>`;
          else if (fns.includes(id) || id.startsWith('profik.')) out += `<span class="tok-fn">${this.escapeHtml(id)}</span>`;
          else out += this.escapeHtml(id);
          continue;
        }
        out += this.escapeHtml(c);
        i++;
      }
      return out;
    }).join('\n');
  }

  escapeHtml(s) {
    return s.replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
  }
}
