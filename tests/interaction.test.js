'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.listeners = {};
    this.dataset = {};
    this.className = '';
    this.firstChild = null;
    this._text = '';
  }

  set textContent(value) {
    this._text = String(value);
    this.firstChild = { textContent: this._text };
  }

  get textContent() { return this._text; }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; }
  focus() {}
  contains(node) { return this.firstChild === node || this.children.includes(node); }
  closest(selector) { return selector === 'button' && this.tagName === 'BUTTON' ? this : null; }
}

function createAudioContext(stats) {
  return class {
    constructor() {
      this.destination = {};
      this.state = 'suspended';
      stats.created++;
    }
    createOscillator() {
      return {
        frequency: { setValueAtTime() {} },
        connect() {},
        start() { stats.started++; },
        stop() {}
      };
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {}
      };
    }
    resume() { this.state = 'running'; return Promise.resolve(); }
  };
}

function loadApp({ audio = true } = {}) {
  const selectors = [
    '#expression', '#result', '#message', '#history', '#keypad',
    '#undoBtn', '#redoBtn', '#pasteBtn', '#cursorLeft', '#cursorRight',
    '#selectNumber', '#clearHistory', '#exportBtn'
  ];
  const elements = new Map(selectors.map(selector => [selector, new FakeElement()]));
  const documentListeners = {};
  const audioStats = { created: 0, started: 0 };
  const selection = { rangeCount: 0, removeAllRanges() {}, addRange() {} };
  const document = {
    querySelector(selector) { return elements.get(selector) || null; },
    createElement(tagName) { return new FakeElement(tagName); },
    createTextNode(text) { return { textContent: text }; },
    createRange() { return { setStart() {}, setEnd() {} }; },
    addEventListener(type, callback) { (documentListeners[type] ||= []).push(callback); },
    dispatch(type, target) {
      for (const listener of documentListeners[type] || []) listener({ target });
    }
  };
  const window = {
    getSelection() { return selection; },
    AudioContext: audio ? createAudioContext(audioStats) : undefined
  };
  const context = vm.createContext({
    document,
    window,
    navigator: {},
    localStorage: { getItem() { return '[]'; }, setItem() {} },
    confirm() { return true; },
    console
  });
  vm.runInContext(appSource, context);
  return { context, document, elements, audioStats };
}

test('editor controls use six equal-width buttons and paired undo/redo icons', () => {
  const controls = html.match(/<div class="editor-tools"[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(controls, 'editor controls should exist');
  assert.match(controls[1], /id="undoBtn"[^>]*>↶<\/button>/);
  assert.match(controls[1], /id="redoBtn"[^>]*aria-label="やり直す"[^>]*>↷<\/button>/);

  const gridRule = css.match(/\.editor-tools\s*\{([^}]+)\}/);
  assert.ok(gridRule, 'editor controls grid rule should exist');
  assert.match(gridRule[1], /grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)/);
});

test('equals occupies the open lower-right keypad cell and retains emphasis', () => {
  assert.match(html, /<button data-key="=" class="equals">=<\/button>/);

  const equalsRule = css.match(/\.keypad \.equals\s*\{([^}]+)\}/);
  assert.ok(equalsRule, 'equals styling should exist');
  assert.doesNotMatch(equalsRule[1], /grid-column:\s*1\s*\/\s*-1/);
  assert.match(equalsRule[1], /background:\s*#2864c5/);
  assert.match(equalsRule[1], /color:\s*#fff/);
});

test('redo button restores multiple undone edits and recalculates the result', () => {
  const { context, elements } = loadApp();
  vm.runInContext("insert('1'); insert('+'); insert('2'); insert('+'); insert('3'); undo(); undo();", context);
  const redoClick = elements.get('#redoBtn').listeners.click[0];
  redoClick();
  redoClick();
  assert.equal(elements.get('#expression').textContent, '1+2+3');
  assert.equal(elements.get('#result').textContent, '6');
});

test('a new edit after undo clears the redo branch', () => {
  const { context, elements } = loadApp();
  vm.runInContext("insert('1'); insert('+'); insert('2'); undo(); insert('3'); redo();", context);
  assert.equal(elements.get('#expression').textContent, '1+3');
  assert.match(elements.get('#message').textContent, /やり直せる操作がありません/);
});

test('delegated click sound covers existing and dynamically created buttons', async () => {
  const { document, audioStats } = loadApp();
  document.dispatch('click', new FakeElement('button'));
  document.dispatch('click', new FakeElement('button'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(audioStats.created, 1);
  assert.equal(audioStats.started, 2);
});

test('button actions remain usable when Web Audio is unavailable', () => {
  const { document, context, elements } = loadApp({ audio: false });
  assert.doesNotThrow(() => document.dispatch('click', new FakeElement('button')));
  vm.runInContext("insert('7')", context);
  assert.equal(elements.get('#expression').textContent, '7');
});

test('release version, service worker cache, and README use version 1.6.0', () => {
  assert.match(html, /Ver\. 1\.6\.0/);
  assert.match(serviceWorker, /rekishi-calculator-v1\.6\.0/);
  assert.match(readme, /### Version 1\.6\.0/);
  assert.match(readme, /(?:タップ音|クリック音)/);
  assert.match(readme, /REDO/);
});
