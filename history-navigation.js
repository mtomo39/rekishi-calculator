// Return to the calculator after using a history item, but keep the delete action in history.
document.querySelector('#history').addEventListener('click', event => {
  const action = event.target.closest('.history-actions button:not(.delete)');
  const historyEl = document.querySelector('#history');
  if (action && !historyEl.hidden) {
    document.querySelector('#historyToggle').click();
  }
});
