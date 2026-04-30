const typeLabels = { homework: '课后作业', experiment: '实验报告', essay: '论文', project: '项目' };
let currentType = 'homework';

function selectType(el, type) {
  document.querySelectorAll('.type-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  currentType = type;
  document.getElementById('pvType').textContent = typeLabels[type] || type;
}

function toggleChip(el) {
  setTimeout(() => {
    el.classList.toggle('checked', el.querySelector('input').checked);
    updatePreview();
  }, 0);
}

function toggleAll() {
  const chips = document.querySelectorAll('.chip');
  const allChecked = [...chips].every(c => c.classList.contains('checked'));
  chips.forEach(c => {
    const input = c.querySelector('input');
    input.checked = !allChecked;
    c.classList.toggle('checked', !allChecked);
  });
  updatePreview();
}

function updatePreview() {
  const title = document.getElementById('titleInput').value;
  const course = document.getElementById('courseSelect').value;
  const desc = document.getElementById('descInput').value;
  const score = document.getElementById('scoreInput').value;
  const deadline = document.getElementById('deadlineInput').value;
  const format = document.getElementById('formatInput').value;

  document.getElementById('pvTitle').textContent = title || '作业标题将显示在这里';
  document.getElementById('pvTitle').style.color = title ? 'var(--ink)' : '#ccc';
  document.getElementById('pvCourse').textContent = '📚 ' + course;
  document.getElementById('pvScore').textContent = '💯 ' + (score || '—') + ' 分';
  document.getElementById('pvDeadline').textContent = deadline ? '⏰ ' + deadline.replace('T', ' ') : '⏰ 待设定截止时间';
  document.getElementById('pvDesc').textContent = desc || '在这里输入作业描述，学生会看到这段文字。可以写明要求、注意事项、参考资料等。';
  document.getElementById('pvDesc').style.color = desc ? '#666' : '#bbb';
  document.getElementById('pvFormat').innerHTML = '<span class="preview-meta-item">' + (format || '不限') + '</span>';

  // Classes
  const checked = document.querySelectorAll('.chip.checked span:nth-child(2)');
  const pvClasses = document.getElementById('pvClasses');
  pvClasses.innerHTML = [...checked].map(c => '<span class="preview-class-tag">' + c.textContent + '</span>').join('') || '<span class="preview-class-tag" style="color:#ccc">未选择班级</span>';

  // Settings
  const toggles = document.querySelectorAll('.toggle-row');
  const pvSettings = document.getElementById('pvSettings');
  const settings = [];
  toggles.forEach(row => {
    const toggle = row.querySelector('.toggle');
    if (toggle && toggle.classList.contains('on')) {
      settings.push(row.querySelector('.toggle-label').textContent);
    }
  });
  pvSettings.innerHTML = settings.map(s => '<span class="preview-setting">' + s + '</span>').join('') || '<span class="preview-setting" style="opacity:0.4">无特殊设置</span>';
}

function handlePublish() {
  const btn = document.getElementById('publishBtn');
  btn.textContent = '发布中…';
  btn.style.background = 'var(--lime)';
  setTimeout(() => {
    btn.textContent = '✓ 已发布';
    btn.disabled = true;
  }, 1000);
}

