'use strict';

// Keep an unfinished expression across reloads on this device.
const DRAFT_KEY = 'rekishi-calculator-draft-v1';
const originalSetExpression = window.setExpression;
window.setExpression = function (value) {
  originalSetExpression(value);
  try { localStorage.setItem(DRAFT_KEY, document.querySelector('#expression').textContent || ''); }
  catch (_) { /* Draft persistence is best-effort. */ }
};

try {
  const draft = localStorage.getItem(DRAFT_KEY);
  if (draft !== null && draft !== '') {
    window.setExpression(draft);
    window.moveCursorToEnd();
    window.displayResult();
  }
} catch (_) { /* Continue with an empty expression if storage is unavailable. */ }

const keypad = document.querySelector('#keypad');
const expressionEditor = document.querySelector('#expression');
const originalPress = window.press;
let equalsJustPressed = false;

function rawExpression() {
  return expressionEditor.textContent.replace(/,/g, '');
}

function lastNumberRange() {
  const value = rawExpression();
  const selection = window.getSelection();
  let cursor = value.length;
  if (selection && selection.rangeCount) {
    const range = selection.getRangeAt(0);
    if (expressionEditor.contains(range.startContainer)) {
      const before = range.cloneRange();
      before.selectNodeContents(expressionEditor);
      before.setEnd(range.startContainer, range.startOffset);
      cursor = before.toString().replace(/,/g, '').length;
    }
  }
  let start = cursor, end = cursor;
  while (start > 0 && /[0-9.]/.test(value[start - 1])) start--;
  while (end < value.length && /[0-9.]/.test(value[end])) end++;
  if (start === end && cursor < value.length) {
    while (start > 0 && /[0-9.]/.test(value[start - 1])) start--;
    while (end < value.length && /[0-9.]/.test(value[end])) end++;
  }
  return start === end ? null : { value, start, end, number: value.slice(start, end) };
}

function replaceCurrentNumber(replacement) {
  const range = lastNumberRange();
  if (!range) {
    window.showMessage('数字を入力してから押してください');
    return false;
  }
  window.pushUndo();
  const next = range.value.slice(0, range.start) + replacement + range.value.slice(range.end);
  window.setExpression(next);
  const cursor = window.formatExpression(next.slice(0, range.start + replacement.length)).length;
  window.setSelectionOffsets(cursor, cursor);
  window.displayResult();
  return true;
}

function toggleSign() {
  const range = lastNumberRange();
  if (!range) {
    window.showMessage('数字を入力してから押してください');
    return;
  }
  const before = range.value.slice(0, range.start);
  const unaryMinus = before.endsWith('-') &&
    (before.length === 1 || /[+−*/×÷(]/.test(before[before.length - 2]));
  if (unaryMinus) {
    window.pushUndo();
    const next = before.slice(0, -1) + range.value.slice(range.start);
    window.setExpression(next);
    const cursor = window.formatExpression(next.slice(0, range.start - 1)).length;
    window.setSelectionOffsets(cursor, cursor);
    window.displayResult();
    return;
  }
  replaceCurrentNumber('-' + range.number);
}

function percentValue(number) {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(number);
  if (!match) return null;
  const sign = match[1];
  const digits = (match[2] || '0') + (match[3] || '');
  const scale = (match[3] || '').length + 2;
  const padded = digits.padStart(scale + 1, '0');
  const point = padded.length - scale;
  const integer = padded.slice(0, point) || '0';
  const fraction = padded.slice(point).replace(/0+$/, '');
  return sign + integer + (fraction ? '.' + fraction : '');
}

function lastBinaryOperation(source) {
  const expression = source.replace(/,/g, '');
  let depth = 0, candidate = null;
  for (let i = 0; i < expression.length; i++) {
    const c = expression[i];
    if (c === '(') { depth++; continue; }
    if (c === ')') { depth--; continue; }
    if (depth !== 0 || !'+-−*/×÷'.includes(c)) continue;
    if ('+-−'.includes(c) && (i === 0 || '+-−*/×÷('.includes(expression[i - 1]))) continue;
    candidate = { operator: c, operand: expression.slice(i + 1) };
  }
  if (!candidate || !candidate.operand) return null;
  try {
    window.calculate(candidate.operand);
    return candidate;
  } catch (_) {
    return null;
  }
}

keypad.addEventListener('click', event => {
  const button = event.target.closest('button[data-key]');
  if (!button) return;
  const key = button.dataset.key;
  if (key === '±' || key === '%') {
    event.stopImmediatePropagation();
    equalsJustPressed = false;
    if (key === '±') toggleSign();
    else {
      const range = lastNumberRange();
      if (range) replaceCurrentNumber(percentValue(range.number));
      else window.showMessage('数字を入力してから押してください');
    }
  } else if (key !== '=') {
    equalsJustPressed = false;
  }
}, true);

// Repeated equals is intentionally a no-op; each explicit calculation is saved once.
window.press = async function (key) {
  if (key === '=') {
    if (equalsJustPressed) return;
    equalsJustPressed = true;
    return originalPress(key);
  }
  equalsJustPressed = false;
  return originalPress(key);
};

// Add a separate action to insert the prior result into the current expression.
const originalRenderHistory = window.renderHistory;
window.renderHistory = function () {
  originalRenderHistory();
  document.querySelectorAll('#history .history-item').forEach(card => {
    const resultText = card.querySelector('.history-result')?.textContent || '';
    const result = resultText.replace(/^=\s*/, '').replace(/,/g, '');
    if (!result) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '結果を使う';
    button.addEventListener('click', () => window.insert(result));
    card.querySelector('.history-actions')?.append(button);
  });
};
window.renderHistory();
