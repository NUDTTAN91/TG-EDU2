function filterStudents(btn, type) {
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.s-item').forEach(item => {
    if (type === 'all') item.style.display = '';
    else item.style.display = item.dataset.status === type ? '' : 'none';
  });
}

function setScore(val) {
  document.getElementById('scoreInput').value = val;
}

function addComment(text) {
  const ta = document.getElementById('commentInput');
  ta.value = ta.value ? ta.value + '\n' + text : text;
}

function submitGrade() {
  const btn = document.getElementById('submitGrade');
  btn.textContent = '✓ 已保存';
  btn.style.background = 'var(--lime)';
  setTimeout(() => { btn.textContent = '提交批改 →'; btn.style.background = ''; }, 2000);
}

function skipStudent() {
  // Visual feedback
  const items = document.querySelectorAll('.s-item:not([style*="display: none"])');
  let found = false;
  items.forEach(item => {
    if (item.classList.contains('active') && !found) {
      item.classList.remove('active');
      found = true;
    } else if (found && !item.classList.contains('active')) {
      item.classList.add('active');
      found = false;
    }
  });
}

// Keyboard shortcut
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'Enter') submitGrade();
});

// Student item click
document.querySelectorAll('.s-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.s-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
  });
});

function updateFilterStats() {
  // In a real app, this would cascade-filter the dropdowns
}
