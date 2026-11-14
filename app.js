'use strict';

const $ = (selector) => document.querySelector(selector);
const exprEl = $('#expression');
let rememberedSelection = { start: 0, end: 0 };

function getExpression() { return exprEl.textContent || ''; }
function setExpression(value) { exprEl.textContent = String(value ?? ''); }
function getSelectionOffsets() {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return rememberedSelection;
  const range = selection.getRangeAt(0);
  if (!exprEl.contains(range.startContainer) || !exprEl.contains(range.endContainer)) return rememberedSelection;
  const beforeStart = range.cloneRange();
  beforeStart.selectNodeContents(exprEl);
  beforeStart.setEnd(range.startContainer, range.startOffset);
  const beforeEnd = range.cloneRange();
  beforeEnd.selectNodeContents(exprEl);
  beforeEnd.setEnd(range.endContainer, range.endOffset);
  rememberedSelection = { start: beforeStart.toString().length, end: beforeEnd.toString().length };
  return rememberedSelection;
}
function setSelectionOffsets(start, end = start) {
  exprEl.focus({ preventScroll: true });
  const textNode = exprEl.firstChild || exprEl.appendChild(document.createTextNode(''));
  const length = textNode.textContent.length;
  const a = Math.max(0, Math.min(start, length));
  const b = Math.max(a, Math.min(end, length));
  const range = document.createRange();
  range.setStart(textNode, a);
  range.setEnd(textNode, b);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  rememberedSelection = { start: a, end: b };
}
function normalizeExpression(source) {
  return String(source)
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[＋]/g, '+').replace(/[－−]/g, '-').replace(/[．。]/g, '.')
    .replace(/[×]/g, '*').replace(/[÷]/g, '/');
}
const resultEl = $('#result');
const messageEl = $('#message');
const historyEl = $('#history');
const STORAGE_KEY = 'rekishi-calculator-history-v2';

let history = [];
let lastResult = null;
let undoStack = [];
let redoStack = [];
let tapAudioContext = null;

function showMessage(message = '') {
  messageEl.textContent = message;
}

function pushSnapshot(stack, expression) {
  stack.push(expression);
  if (stack.length > 100) stack.shift();
}

function pushUndo() {
  pushSnapshot(undoStack, getExpression());
  redoStack = [];
}

function undo() {
  if (!undoStack.length) {
    showMessage('戻せる操作がありません');
    return;
  }
  pushSnapshot(redoStack, getExpression());
  setExpression(undoStack.pop());
  moveCursorToEnd();
  displayResult();
  showMessage('元に戻しました');
}

function redo() {
  if (!redoStack.length) {
    showMessage('やり直せる操作がありません');
    return;
  }
  pushSnapshot(undoStack, getExpression());
  setExpression(redoStack.pop());
  moveCursorToEnd();
  displayResult();
  showMessage('やり直しました');
}

function moveCursorToEnd() {
  const end = getExpression().length;
  setSelectionOffsets(end, end);
}

function playTapSound() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  try {
    if (!tapAudioContext) tapAudioContext = new AudioContext();
    const context = tapAudioContext;
    const play = () => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(1100, now);
      gain.gain.setValueAtTime(0.035, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.04);
    };

    if (context.state === 'suspended') {
      context.resume().then(play).catch(error => {
        console.warn('タップ音を再生できませんでした', error);
      });
    } else {
      play();
    }
  } catch (error) {
    console.warn('タップ音を再生できませんでした', error);
  }
}

// Decimal arithmetic backed by BigInt; division is rounded to 15 decimal places.
function dec(s) {
  s = String(s);
  let sign = 1n;
  if (s[0] === '-') { sign = -1n; s = s.slice(1); }
  let [a, b = ''] = s.split('.');
  b = b.replace(/0+$/, '');
  return norm({ n: sign * BigInt((a || '0') + b), scale: b.length });
}
function norm(x) {
  while (x.scale > 0 && x.n % 10n === 0n) { x.n /= 10n; x.scale--; }
  return x;
}
function align(a, b) {
  const scale = Math.max(a.scale, b.scale);
  return [
    { n: a.n * 10n ** BigInt(scale - a.scale), scale },
    { n: b.n * 10n ** BigInt(scale - b.scale), scale },
    scale
  ];
}
function add(a, b) { const [x, y, scale] = align(a, b); return norm({ n: x.n + y.n, scale }); }
function sub(a, b) { const [x, y, scale] = align(a, b); return norm({ n: x.n - y.n, scale }); }
function mul(a, b) { return norm({ n: a.n * b.n, scale: a.scale + b.scale }); }
function div(a, b) {
  if (b.n === 0n) throw Error('0では割れません');
  const power = 15n + BigInt(b.scale) - BigInt(a.scale);
  let numerator = a.n, denominator = b.n;
  if (power >= 0n) numerator *= 10n ** power;
  else denominator *= 10n ** (-power);
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if ((remainder < 0n ? -remainder : remainder) * 2n >= (denominator < 0n ? -denominator : denominator)) {
    quotient += ((numerator < 0n) !== (denominator < 0n)) ? -1n : 1n;
  }
  return norm({ n: quotient, scale: 15 });
}
function fmt(x) {
  x = norm(x);
  const negative = x.n < 0n;
  let raw = (negative ? -x.n : x.n).toString();
  if (x.scale) {
    raw = raw.padStart(x.scale + 1, '0');
    raw = raw.slice(0, -x.scale) + '.' + raw.slice(-x.scale);
  }
  return (negative ? '-' : '') + raw;
}
function tokenize(source) {
  if (source.length > 300) throw Error('式が長すぎます');
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const start = i;
      let dots = 0;
      while (i < source.length && /[0-9.]/.test(source[i])) {
        if (source[i] === '.') dots++;
        i++;
      }
      const value = source.slice(start, i);
      if (dots > 1 || value === '.') throw Error('数字の形式を確認してください');
      tokens.push({ type: 'num', value });
      continue;
    }
    if ('+-−*/×÷()'.includes(c)) {
      tokens.push({ type: 'op', value: c });
      i++;
      continue;
    }
    throw Error('使えない文字があります');
  }
  return tokens;
}
function calculate(source) {
  const tokens = tokenize(normalizeExpression(source));
  let position = 0;
  function primary() {
    const token = tokens[position];
    if (!token) throw Error('式が途中です');
    if (token.type === 'op' && ['+', '-', '−'].includes(token.value)) {
      position++;
      const value = primary();
      return token.value === '+' ? value : { n: -value.n, scale: value.scale };
    }
    if (token.value === '(') {
      position++;
      const value = expression();
      if (!tokens[position] || tokens[position].value !== ')') throw Error('括弧が閉じていません');
      position++;
      return value;
    }
    if (token.type === 'num') {
      position++;
      return dec(token.value);
    }
    throw Error('数字を入力してください');
  }
  function term() {
    let value = primary();
    while (tokens[position] && ['*', '×', '/', '÷'].includes(tokens[position].value)) {
      const operator = tokens[position++].value;
      const right = primary();
      value = (operator === '*' || operator === '×') ? mul(value, right) : div(value, right);
    }
    return value;
  }
  function expression() {
    let value = term();
    while (tokens[position] && ['+', '-', '−'].includes(tokens[position].value)) {
      const operator = tokens[position++].value;
      const right = term();
      value = operator === '+' ? add(value, right) : sub(value, right);
    }
    return value;
  }
  if (!tokens.length) throw Error('式を入力してください');
  const value = expression();
  if (position !== tokens.length) throw Error('式を確認してください');
  return value;
}

function displayResult() {
  const source = getExpression().trim();
  if (!source) {
    resultEl.textContent = '0';
    lastResult = null;
    return;
  }
  try {
    lastResult = fmt(calculate(source));
    resultEl.textContent = lastResult;
    showMessage('');
  } catch (error) {
    lastResult = null;
    resultEl.textContent = '';
    showMessage(error.message);
  }
}

function insert(text) {
  const current = getExpression();
  const { start, end } = getSelectionOffsets();
  pushUndo();
  setExpression(current.slice(0, start) + text + current.slice(end));
  const cursor = start + text.length;
  setSelectionOffsets(cursor, cursor);
  displayResult();
}

async function press(key) {
  if (key === '貼付') {
    try {
      const text = await navigator.clipboard.readText();
      if (text) insert(text);
      else showMessage('クリップボードは空です');
    } catch (_) {
      showMessage('貼り付けできません。コピーした式を確認してください');
    }
    return;
  }
  if (key === 'C') {
    if (getExpression()) pushUndo();
    setExpression('');
    moveCursorToEnd();
    displayResult();
    showMessage('');
    return;
  }
  if (key === '⌫') {
    const current = getExpression();
    let { start, end } = getSelectionOffsets();
    if (start === end && start > 0) start--;
    if (start !== end) {
      pushUndo();
      setExpression(current.slice(0, start) + current.slice(end));
      setSelectionOffsets(start, start);
      displayResult();
    }
    return;
  }
  if (key === '=') {
    if (lastResult === null) { displayResult(); return; }
    const original = getExpression();
    const result = lastResult;
    if (!save(original, result)) return;
    pushUndo();
    setExpression(result);
    moveCursorToEnd();
    displayResult();
    showMessage('履歴に保存しました');
    return;
  }
  insert(key);
}

function save(expression, result) {
  const item = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    expression,
    result,
    createdAt: new Date().toISOString()
  };
  history.unshift(item);
  history = history.slice(0, 250);
  if (!persist()) {
    history.shift();
    showMessage('保存できませんでした。端末の空き容量を確認してください');
    return false;
  }
  renderHistory();
  return true;
}

function makeButton(label, callback, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (className) button.className = className;
  button.addEventListener('click', callback);
  return button;
}

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(String(text));
    } else {
      throw new Error('Clipboard API unavailable');
    }
    showMessage('コピーしました');
  } catch (_) {
    showMessage('コピーできませんでした。Safariの共有メニュー等を利用してください');
  }
}

function renderHistory() {
  historyEl.replaceChildren();
  if (!history.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '履歴はありません';
    historyEl.append(empty);
    return;
  }

  for (const item of history) {
    const card = document.createElement('article');
    card.className = 'history-item';

    const expression = document.createElement('div');
    expression.className = 'history-expression';
    expression.textContent = item.expression;

    const result = document.createElement('div');
    result.className = 'history-result';
    result.textContent = '= ' + item.result;

    const actions = document.createElement('div');
    actions.className = 'history-actions';

    const edit = makeButton('式を編集', () => {
      pushUndo();
      setExpression(item.expression);
      moveCursorToEnd();
      displayResult();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    const copyExpression = makeButton('式をコピー', () => copyText(item.expression));
    const copyResult = makeButton('結果をコピー', () => copyText(item.result));
    const remove = makeButton('削除', () => {
      const previous = history;
      history = history.filter(entry => entry.id !== item.id);
      if (!persist()) {
        history = previous;
        showMessage('削除を保存できませんでした');
      }
      renderHistory();
    }, 'delete');

    actions.append(edit, copyExpression, copyResult, remove);
    card.append(expression, result, actions);
    historyEl.append(card);
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    return true;
  } catch (_) {
    return false;
  }
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    history = Array.isArray(saved)
      ? saved.filter(item =>
          item &&
          typeof item.expression === 'string' &&
          typeof item.result === 'string' &&
          typeof item.id === 'string'
        ).slice(0, 250)
      : [];
  } catch (_) {
    history = [];
  }
  renderHistory();
}

$('#undoBtn').addEventListener('click', undo);
$('#redoBtn').addEventListener('click', redo);
$('#pasteBtn').addEventListener('click', () => press('貼付'));
$('#cursorLeft').addEventListener('click', () => {
  const { start, end } = getSelectionOffsets();
  const position = start === end ? Math.max(0, start - 1) : start;
  setSelectionOffsets(position, position);
});
$('#cursorRight').addEventListener('click', () => {
  const { start, end } = getSelectionOffsets();
  const position = start === end ? Math.min(getExpression().length, end + 1) : end;
  setSelectionOffsets(position, position);
});
function selectNumberAt(position) {
  const value = getExpression();
  const isNumberChar = c => /[0-9０-９.．]/.test(c || '');
  let point = Math.max(0, Math.min(position, value.length));
  if (!isNumberChar(value[point]) && point > 0 && isNumberChar(value[point - 1])) point--;
  if (!isNumberChar(value[point])) return false;
  let start = point, end = point + 1;
  while (start > 0 && isNumberChar(value[start - 1])) start--;
  while (end < value.length && isNumberChar(value[end])) end++;
  setSelectionOffsets(start, end);
  return true;
}
$('#selectNumber').addEventListener('click', () => {
  const { start, end } = getSelectionOffsets();
  if (!selectNumberAt(start)) showMessage('数字の上にカーソルを置いてください');
  else showMessage('数字を選択しました');
});
exprEl.addEventListener('dblclick', event => {
  let position = getSelectionOffsets().start;
  if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(event.clientX, event.clientY);
    if (range && exprEl.contains(range.startContainer)) {
      const before = range.cloneRange();
      before.selectNodeContents(exprEl);
      before.setEnd(range.startContainer, range.startOffset);
      position = before.toString().length;
    }
  }
  if (selectNumberAt(position)) event.preventDefault();
});
let previousTap = null;
exprEl.addEventListener('touchend', event => {
  const touch = event.changedTouches && event.changedTouches[0];
  if (!touch) return;
  const now = Date.now();
  if (previousTap && now - previousTap.time < 360 &&
      Math.hypot(touch.clientX - previousTap.x, touch.clientY - previousTap.y) < 28) {
    let position = getSelectionOffsets().start;
    if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(touch.clientX, touch.clientY);
      if (range && exprEl.contains(range.startContainer)) {
        const before = range.cloneRange();
        before.selectNodeContents(exprEl);
        before.setEnd(range.startContainer, range.startOffset);
        position = before.toString().length;
      }
    }
    if (selectNumberAt(position)) event.preventDefault();
    previousTap = null;
  } else {
    previousTap = { time: now, x: touch.clientX, y: touch.clientY };
  }
}, { passive: false });
// Keep the editor selectable, but route all text changes through the calculator keypad.
exprEl.addEventListener('beforeinput', event => event.preventDefault());
exprEl.addEventListener('keydown', event => event.preventDefault());
exprEl.addEventListener('paste', event => event.preventDefault());
$('#keypad').addEventListener('click', event => {
  const button = event.target.closest('button[data-key]');
  if (button) press(button.dataset.key);
});
document.addEventListener('click', event => {
  const target = event.target;
  const button = target && typeof target.closest === 'function' && target.closest('button');
  if (button) playTapSound();
}, true);
$('#clearHistory').addEventListener('click', () => {
  if (!history.length) return;
  if (confirm('計算履歴をすべて削除しますか？')) {
    const previous = history;
    history = [];
    if (!persist()) {
      history = previous;
      showMessage('履歴を削除できませんでした');
    }
    renderHistory();
  }
});
$('#exportBtn').addEventListener('click', () => {
  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    history
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'rekishi-calculator-backup.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  showMessage('バックアップを作成しました');
});

load();
