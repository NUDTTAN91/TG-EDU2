let selectedRole = 'student';

function selectRole(el, role) {
  document.querySelectorAll('.role-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  selectedRole = role;
  // Change placeholder text
  const input = document.querySelector('input[placeholder*="学号"]');
  if (input) {
    if (role === 'admin') input.placeholder = '管理员账号';
    else input.placeholder = '学号 / 工号';
  }
}

function togglePw() {
  const inp = document.getElementById('pwInput');
  const btn = document.querySelector('.pw-toggle');
  if (inp.type === 'password') {
    inp.type = 'text';
    btn.textContent = '🙈';
  } else {
    inp.type = 'password';
    btn.textContent = '👁';
  }
}

function handleLogin() {
  const school = document.getElementById('schoolSelect').value;
  if (!school) {
    document.getElementById('schoolSelect').style.borderColor = 'var(--pink)';
    document.getElementById('schoolSelect').style.boxShadow = '3px 3px 0 var(--pink)';
    setTimeout(() => {
      document.getElementById('schoolSelect').style.borderColor = '';
      document.getElementById('schoolSelect').style.boxShadow = '';
    }, 1500);
    return;
  }
  const btn = document.querySelector('.login-btn');
  btn.textContent = '登录中…';
  btn.style.background = 'var(--lime)';
  const dashboards = { student: 'dashboard.html', teacher: 'dashboard-teacher.html', admin: 'dashboard-admin.html' };
  setTimeout(() => {
    btn.textContent = '✓ 登录成功';
    setTimeout(() => { location.href = dashboards[selectedRole] || 'dashboard.html'; }, 600);
  }, 1200);
}

function handleSSO() {
  const btn = document.querySelector('.sso-btn');
  btn.textContent = '正在跳转到认证页面…';
  btn.style.background = 'var(--sky)';
  setTimeout(() => {
    const dashboards = { student: 'dashboard.html', teacher: 'dashboard-teacher.html', admin: 'dashboard-admin.html' };
    location.href = dashboards[selectedRole] || 'dashboard.html';
  }, 1500);
}

// Mouse parallax on left cards
const leftPanel = document.querySelector('.left-panel');
if (leftPanel) {
  leftPanel.addEventListener('mousemove', (e) => {
    const rect = leftPanel.getBoundingClientRect();
    const x = (e.clientX - rect.left - rect.width / 2) / rect.width;
    const y = (e.clientY - rect.top - rect.height / 2) / rect.height;
    document.querySelectorAll('.mini-card').forEach((card, i) => {
      const factor = (i + 1) * 5;
      card.style.translate = `${x * factor}px ${y * factor}px`;
    });
  });
  leftPanel.addEventListener('mouseleave', () => {
    document.querySelectorAll('.mini-card').forEach(card => {
      card.style.translate = '';
    });
  });
}
