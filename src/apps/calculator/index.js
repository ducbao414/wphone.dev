// Reference app: shows the minimal app contract.
// default export receives ctx = { root, os, args, storage, navigate, back, close, onBack, on, ... }
import './style.css';

export default async function launch(ctx) {
  const { root, os, storage } = ctx;
  const { el, appBar, I } = os.ui;
  let expr = await storage.get('expr', '');
  let sci = await storage.get('sci', false);
  let justEvaluated = false;

  const exprEl = el('div.calc-expr');
  const valEl = el('div.calc-value', '0');
  const keys = el('div.calc-keys');
  const view = el('div.calc' + (sci ? '.sci' : ''), el('div.calc-display', exprEl, valEl), keys);
  root.append(view);

  const evaluate = (s) => {
    const js = s.replace(/×/g, '*').replace(/÷/g, '/').replace(/π/g, 'PI').replace(/√\(/g, 'sqrt(')
      .replace(/(\d)(PI|\()/g, '$1*$2').replace(/\^/g, '**').replace(/(\d+(?:\.\d+)?)%/g, '($1/100)');
    if (!/^[\d+\-*/().\sPIa-z]*$/.test(js)) throw new Error('bad');
    // eslint-disable-next-line no-new-func
    const v = Function('with(Math){return (' + js.replace(/\blog\(/g, 'log10(').replace(/\bln\(/g, 'log(') + ')}')();
    if (!isFinite(v)) throw new Error('math');
    return +v.toPrecision(12);
  };
  const render = () => {
    exprEl.textContent = expr;
    try { valEl.textContent = expr ? String(evaluate(expr)) : '0'; } catch { if (!expr) valEl.textContent = '0'; }
    storage.set('expr', expr);
  };
  const press = (k) => {
    os.sounds.key();
    if (k === 'C') expr = '';
    else if (k === '⌫') expr = expr.slice(0, -1);
    else if (k === '=') {
      try { const v = evaluate(expr); expr = String(v); justEvaluated = true; render(); return; } catch { valEl.textContent = 'Error'; return; }
    } else if (k === '±') expr = expr.startsWith('-') ? expr.slice(1) : '-' + expr;
    else {
      if (justEvaluated && /[\d.]/.test(k)) expr = '';
      expr += ['sin', 'cos', 'tan', 'log', 'ln', '√'].includes(k) ? k + '(' : k;
    }
    justEvaluated = false;
    render();
  };
  const layout = () => {
    const basic = ['C', '⌫', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '-', '1', '2', '3', '+', '±', '0', '.', '='];
    const extra = ['sin', 'cos', 'tan', '(', ')', 'log', 'ln', '√', '^', 'π'];
    const list = sci ? [...extra, ...basic.slice(0, 4), '', ...basic.slice(4, 8), '', ...basic.slice(8, 12), '', ...basic.slice(12, 16), '', ...basic.slice(16)].filter((k) => k !== '') : basic;
    keys.replaceChildren(...list.map((k) => el('button.calc-key' + (/^[\d.]$/.test(k) ? '.num' : '') + (k === '=' ? '.eq' : ''), { onclick: () => press(k) }, k)));
    view.classList.toggle('sci', sci);
  };
  layout();
  render();

  const bar = appBar({
    minimized: true,
    menu: [
      { label: 'scientific / basic', onClick: () => { sci = !sci; storage.set('sci', sci); layout(); } },
      { label: 'copy result', onClick: () => { os.device.copy(valEl.textContent); os.toast('Copied'); } },
    ],
  });
  root.append(bar.el);
  // keyboard support on desktop
  const onKey = (e) => {
    if (!root.isConnected || root.closest('.app-frame:not(.active)')) return;
    const map = { '*': '×', '/': '÷', Enter: '=', Backspace: '⌫', Delete: 'C' };
    const k = map[e.key] || e.key;
    if (/^[\d.+\-%()^]$/.test(k) || ['×', '÷', '=', '⌫', 'C'].includes(k)) { e.preventDefault(); e.stopPropagation(); press(k); }
  };
  window.addEventListener('keydown', onKey, true);
  return { onDestroy: () => window.removeEventListener('keydown', onKey, true) };
}
