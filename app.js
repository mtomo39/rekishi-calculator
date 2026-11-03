(() => {
  "use strict";

  const STORAGE_KEY = "rekishi-calculator-history-v2";
  const MAX_HISTORY = 250;
  const MAX_EXPRESSION_LENGTH = 300;
  const MAX_TOKENS = 200;
  const MAX_DEPTH = 30;
  const DIVISION_SCALE = 15;

  const $ = (id) => document.getElementById(id);
  const expressionInput = $("expression");
  const resultOutput = $("result");
  const statusEl = $("status");
  const historyList = $("historyList");
  let history = loadHistory();
  let internalClipboard = "";
  let lastResult = null;

  function setStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.classList.toggle("error", isError);
  }

  function pow10(n) {
    if (!Number.isInteger(n) || n < 0 || n > 1000) throw new Error("数値の桁数が大きすぎます");
    return 10n ** BigInt(n);
  }

  function normalizeDecimal(c, s) {
    if (c === 0n) return { c: 0n, s: 0 };
    while (s > 0 && c % 10n === 0n) { c /= 10n; s--; }
    return { c, s };
  }

  function parseDecimalLiteral(text) {
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) throw new Error("数値の形式が正しくありません");
    const parts = text.split(".");
    const whole = parts[0] || "0";
    const fraction = parts[1] || "";
    if ((whole + fraction).length > 30 || fraction.length > 15) {
      throw new Error("数値は整数部・小数部あわせて30桁以内（小数15桁以内）にしてください");
    }
    return normalizeDecimal(BigInt(whole + fraction), fraction.length);
  }

  function align(a, b) {
    const scale = Math.max(a.s, b.s);
    return [a.c * pow10(scale - a.s), b.c * pow10(scale - b.s), scale];
  }
  function add(a, b) {
    const [x, y, s] = align(a, b);
    return normalizeDecimal(x + y, s);
  }
  function subtract(a, b) {
    const [x, y, s] = align(a, b);
    return normalizeDecimal(x - y, s);
  }
  function multiply(a, b) {
    return normalizeDecimal(a.c * b.c, a.s + b.s);
  }
  function divide(a, b) {
    if (b.c === 0n) throw new Error("0で割ることはできません");
    const numerator = a.c * pow10(b.s + DIVISION_SCALE);
    const denominator = b.c * pow10(a.s);
    let q = numerator / denominator;
    const r = numerator % denominator;
    if ((r < 0n ? -r : r) * 2n >= (denominator < 0n ? -denominator : denominator)) {
      q += (numerator < 0n) !== (denominator < 0n) ? -1n : 1n;
    }
    return normalizeDecimal(q, DIVISION_SCALE);
  }
  function negate(a) { return { c: -a.c, s: a.s }; }

  function decimalToPlain(d) {
    const negative = d.c < 0n;
    let digits = (negative ? -d.c : d.c).toString();
    if (d.s > 0) {
      digits = digits.padStart(d.s + 1, "0");
      digits = digits.slice(0, -d.s) + "." + digits.slice(-d.s);
    }
    return (negative ? "-" : "") + digits;
  }
  function formatDecimal(d) {
    const plain = decimalToPlain(d);
    const [integer, fraction] = plain.split(".");
    const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return fraction ? grouped + "." + fraction : grouped;
  }

  function tokenize(source) {
    const normalized = source.replace(/[＋]/g, "+").replace(/[−]/g, "-")
      .replace(/[×✕＊]/g, "*").replace(/[÷／]/g, "/").replace(/\s+/g, "");
    if (!normalized) throw new Error("計算式を入力してください");
    if (normalized.length > MAX_EXPRESSION_LENGTH) throw new Error("計算式は300文字以内にしてください");
    if (normalized.includes(",")) throw new Error("カンマは入力できません。数字だけで入力してください");
    const tokens = [];
    let i = 0;
    while (i < normalized.length) {
      const ch = normalized[i];
      if (/[0-9.]/.test(ch)) {
        let j = i;
        while (j < normalized.length && /[0-9.]/.test(normalized[j])) j++;
        const raw = normalized.slice(i, j);
        if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) throw new Error("小数点の位置を確認してください");
        tokens.push({ type: "number", value: parseDecimalLiteral(raw), raw });
        i = j;
      } else if ("+-*/()".includes(ch)) {
        tokens.push({ type: ch, value: ch });
        i++;
      } else {
        throw new Error(`使用できない文字があります：${ch}`);
      }
      if (tokens.length > MAX_TOKENS) throw new Error("計算式が長すぎます");
    }
    tokens.push({ type: "eof" });
    return tokens;
  }

  function calculate(source) {
    const tokens = tokenize(source);
    let pos = 0;
    let depth = 0;
    const peek = () => tokens[pos];
    const take = (type) => {
      if (peek().type !== type) throw new Error("計算式の形式を確認してください");
      return tokens[pos++];
    };
    function primary() {
      if (peek().type === "number") return take("number").value;
      if (peek().type === "(") {
        take("(");
        depth++;
        if (depth > MAX_DEPTH) throw new Error("括弧が深すぎます");
        const value = expression();
        take(")");
        depth--;
        return value;
      }
      throw new Error("数値または括弧が必要です");
    }
    function unary() {
      if (peek().type === "+") { take("+"); return unary(); }
      if (peek().type === "-") { take("-"); return negate(unary()); }
      return primary();
    }
    function term() {
      let value = unary();
      while (peek().type === "*" || peek().type === "/") {
        const op = tokens[pos++].type;
        const right = unary();
        value = op === "*" ? multiply(value, right) : divide(value, right);
      }
      return value;
    }
    function expression() {
      let value = term();
      while (peek().type === "+" || peek().type === "-") {
        const op = tokens[pos++].type;
        const right = term();
        value = op === "+" ? add(value, right) : subtract(value, right);
      }
      return value;
    }
    const value = expression();
    if (peek().type !== "eof") throw new Error("演算子または括弧の位置を確認してください");
    return value;
  }

  function safeId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
  function validateHistory(data) {
    if (!Array.isArray(data)) return [];
    return data.filter(item =>
      item && typeof item === "object" &&
      typeof item.id === "string" &&
      typeof item.expression === "string" &&
      item.expression.length <= MAX_EXPRESSION_LENGTH &&
      typeof item.result === "string" && item.result.length <= 100 &&
      typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
    ).slice(0, MAX_HISTORY);
  }
  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? validateHistory(JSON.parse(raw)) : [];
    } catch {
      return [];
    }
  }
  function saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
      return true;
    } catch {
      setStatus("端末への保存に失敗しました。空き容量やSafariの設定を確認してください", true);
      return false;
    }
  }

  function renderHistory() {
    historyList.replaceChildren();
    if (!history.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "まだ履歴はありません";
      historyList.append(empty);
      return;
    }
    for (const item of history) {
      const card = document.createElement("article");
      card.className = "history-item";

      const meta = document.createElement("div");
      meta.className = "history-meta";
      const date = document.createElement("span");
      date.textContent = new Date(item.createdAt).toLocaleString("ja-JP", {
        month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"
      });
      const tag = document.createElement("span");
      tag.textContent = "履歴";
      meta.append(date, tag);

      const expr = document.createElement("div");
      expr.className = "history-expression";
      expr.textContent = item.expression;
      expr.setAttribute("aria-label", "長押しして式の一部を選択できます");

      const result = document.createElement("div");
      result.className = "history-result";
      result.textContent = "= " + item.result;

      const actions = document.createElement("div");
      actions.className = "history-actions";
      const use = makeButton("式を再利用", "small-button primary", () => {
        expressionInput.value = item.expression;
        expressionInput.focus();
        expressionInput.setSelectionRange(item.expression.length, item.expression.length);
        updatePreview();
      });
      const copyExpression = makeButton("式をコピー", "small-button", () => copyInternal(item.expression));
      const copyResult = makeButton("結果をコピー", "small-button", () => copyInternal(item.result.replace(/,/g, "")));
      const copySelection = makeButton("選択部分をコピー", "small-button", () => copySelectedFromCard(expr));
      const remove = makeButton("削除", "small-button", () => deleteHistory(item.id));
      actions.append(use, copyExpression, copyResult, copySelection, remove);
      card.append(meta, expr, result, actions);
      historyList.append(card);
    }
  }

  function makeButton(label, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }
  function copyInternal(text) {
    internalClipboard = String(text);
    setStatus(`アプリ内にコピーしました：${internalClipboard}`);
  }
  function copySelectedFromCard(element) {
    const selection = window.getSelection();
    const text = selection ? selection.toString() : "";
    if (!text || !element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) {
      setStatus("先に履歴の式を長押しして、コピーしたい範囲を選択してください", true);
      return;
    }
    copyInternal(text);
    selection.removeAllRanges();
  }
  function deleteHistory(id) {
    history = history.filter(item => item.id !== id);
    if (saveHistory()) {
      renderHistory();
      setStatus("履歴を削除しました");
    }
  }

  function updatePreview() {
    const source = expressionInput.value.trim();
    if (!source) {
      resultOutput.textContent = "0";
      lastResult = null;
      setStatus("計算式を入力してください");
      return;
    }
    try {
      const value = calculate(source);
      lastResult = value;
      resultOutput.textContent = formatDecimal(value);
      setStatus("計算できます");
    } catch (error) {
      lastResult = null;
      resultOutput.textContent = "—";
      setStatus(error.message, true);
    }
  }

  function saveCalculation() {
    const source = expressionInput.value.trim();
    if (!source) { setStatus("計算式を入力してください", true); return; }
    try {
      const value = calculate(source);
      const plain = decimalToPlain(value);
      const item = { id: safeId(), expression: source, result: plain, createdAt: Date.now() };
      history.unshift(item);
      history = history.slice(0, MAX_HISTORY);
      if (saveHistory()) {
        renderHistory();
        resultOutput.textContent = formatDecimal(value);
        lastResult = value;
        setStatus("計算結果を履歴に保存しました");
      } else {
        history.shift();
      }
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  function insertAtCursor(text) {
    const start = expressionInput.selectionStart ?? expressionInput.value.length;
    const end = expressionInput.selectionEnd ?? start;
    const value = expressionInput.value;
    expressionInput.value = value.slice(0, start) + text + value.slice(end);
    const cursor = start + text.length;
    expressionInput.focus();
    expressionInput.setSelectionRange(cursor, cursor);
    updatePreview();
  }
  async function pasteInternal() {
    if (!internalClipboard) { setStatus("アプリ内コピーは空です", true); return; }
    insertAtCursor(internalClipboard);
    setStatus("アプリ内コピーを貼り付けました");
  }
  async function pasteExternal() {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      setStatus("この環境では外部クリップボードを読み取れません。履歴のコピー機能を使ってください", true);
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (!text) { setStatus("外部クリップボードは空です", true); return; }
      insertAtCursor(text);
      setStatus("外部クリップボードから貼り付けました");
    } catch {
      setStatus("クリップボードの読み取りが許可されませんでした。Safariの貼り付け操作を確認してください", true);
    }
  }

  document.querySelectorAll("[data-insert]").forEach(button => {
    button.addEventListener("click", () => insertAtCursor(button.dataset.insert));
  });
  document.querySelector('[data-action="clear"]').addEventListener("click", () => {
    expressionInput.value = "";
    updatePreview();
    expressionInput.focus();
  });
  document.querySelector('[data-action="backspace"]').addEventListener("click", () => {
    const start = expressionInput.selectionStart ?? expressionInput.value.length;
    const end = expressionInput.selectionEnd ?? start;
    if (start !== end) insertAtCursor("");
    else if (start > 0) {
      expressionInput.setRangeText("", start - 1, start, "end");
      updatePreview();
    }
    expressionInput.focus();
  });
  document.querySelector('[data-action="equals"]').addEventListener("click", saveCalculation);
  expressionInput.addEventListener("input", updatePreview);
  $("pasteButton").addEventListener("click", pasteInternal);
  $("externalPasteButton").addEventListener("click", pasteExternal);
  $("clearHistoryButton").addEventListener("click", () => {
    if (!history.length) { setStatus("削除する履歴はありません"); return; }
    if (!window.confirm("すべての計算履歴を削除しますか？")) return;
    const previous = history;
    history = [];
    if (saveHistory()) { renderHistory(); setStatus("すべての履歴を削除しました"); }
    else history = previous;
  });

  $("backupButton").addEventListener("click", () => {
    const data = JSON.stringify({ format: "rekishi-calculator-backup", version: 2, exportedAt: new Date().toISOString(), history }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rekishi-calculator-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus("バックアップファイルを作成しました");
  });
  $("importFile").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || data.format !== "rekishi-calculator-backup" || !Array.isArray(data.history)) {
        throw new Error("このアプリのバックアップファイルではありません");
      }
      const imported = validateHistory(data.history);
      if (!imported.length && data.history.length) throw new Error("読み込める履歴がありません");
      const byId = new Map([...history, ...imported].map(item => [item.id, item]));
      history = [...byId.values()].sort((a,b) => b.createdAt - a.createdAt).slice(0, MAX_HISTORY);
      if (!saveHistory()) throw new Error("端末への保存に失敗しました");
      renderHistory();
      setStatus(`${imported.length}件の履歴を取り込みました`);
    } catch (error) {
      setStatus(error.message || "バックアップを読み込めませんでした", true);
    } finally {
      event.target.value = "";
    }
  });
  $("importButton").addEventListener("click", () => $("importFile").click());

  renderHistory();
  updatePreview();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {
        setStatus("オフライン機能の登録に失敗しました", true);
      });
    });
  }

  // テストから利用できるよう、計算関数のみを公開する（通常画面には影響しない）。
  window.RekishiCalculator = { calculate, formatDecimal, decimalToPlain };
})();
