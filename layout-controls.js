// Keep the calculator shell and result visible in history view so the history button
// remains available. Hide input controls, and hide Paste when there is no expression to paste into.
const calculatorPanel = document.querySelector('#calculator');
const historyButton = document.querySelector('#historyToggle');
const pasteButton = document.querySelector('#pasteBtn');

historyButton.addEventListener('click', () => {
  const showingHistory = historyButton.getAttribute('aria-expanded') === 'true';
  calculatorPanel.hidden = false;
  calculatorPanel.classList.toggle('history-view', showingHistory);
  pasteButton.hidden = showingHistory;
});
