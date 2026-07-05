var selectedRole = 'student';

// 加载院校列表
(function loadSchools() {
  fetch('/api/schools/public/')
    .then(function(r) { return r.json(); })
    .then(function(schools) {
      var select = document.getElementById('schoolSelect');
      if (!select) return;
      schools.forEach(function(school) {
        var opt = document.createElement('option');
        opt.value = school.id;
        opt.textContent = school.name;
        select.appendChild(opt);
      });
    })
    .catch(function(err) {
      console.error('加载院校列表失败:', err);
    });
})();

function selectRole(el, role) {
  document.querySelectorAll('.role-card').forEach(function(c) { c.classList.remove('selected'); });
  el.classList.add('selected');
  selectedRole = role;
  var input = document.querySelector('input[placeholder*="学号"]');
  if (input) {
    if (role === 'admin') input.placeholder = '管理员账号';
    else input.placeholder = '学号 / 工号';
  }
}

function togglePw() {
  var inp = document.getElementById('pwInput');
  var btn = document.querySelector('.pw-toggle');
  if (inp.type === 'password') {
    inp.type = 'text';
    btn.textContent = '🙈';
  } else {
    inp.type = 'password';
    btn.textContent = '👁';
  }
}

function showLoginError(msg) {
  var el = document.getElementById('loginError');
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
  }
}

function hideLoginError() {
  var el = document.getElementById('loginError');
  if (el) {
    el.style.display = 'none';
  }
}

function handleLogin() {
  var usernameInput = document.getElementById('usernameInput');
  var pwInput = document.getElementById('pwInput');
  var btn = document.getElementById('loginBtn');

  if (!usernameInput || !pwInput) return;

  var username = usernameInput.value.trim();
  var password = pwInput.value;

  hideLoginError();

  if (!username) {
    showLoginError('请输入账号');
    usernameInput.focus();
    return;
  }
  if (!password) {
    showLoginError('请输入密码');
    pwInput.focus();
    return;
  }

  // Loading state
  btn.disabled = true;
  btn.textContent = '登录中…';

  Auth.login(username, password).then(function(data) {
    // 检查前端选择的身份是否与后端返回的角色匹配
    if (selectedRole && data.user.role !== selectedRole) {
      showLoginError('账号或密码错误');
      // 清除已保存的登录状态
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
      Auth.user = null;
      API.token = null;
      btn.disabled = false;
      btn.textContent = '登 录 →';
      return;
    }
    // 角色匹配成功
    btn.textContent = '✓ 登录成功';

    // 检查是否需要强制改密
    if (data.user.must_change_password) {
      Auth._showForceChangePassword(function() {
        // 改密成功后退出登录，要求重新登录
        Auth.logout();
      });
      return;
    }

    // 正常跳转
    var url = Auth.getDashboardUrl();
    setTimeout(function() {
      window.location.href = url;
    }, 400);
  }).catch(function(err) {
    btn.disabled = false;
    btn.textContent = '登 录 →';
    showLoginError(err.message || '登录失败，请重试');
  });
}

function handleSSO() {
  showLoginError('SSO 功能暂未开放');
}

// Mouse parallax on left cards
var leftPanel = document.querySelector('.left-panel');
if (leftPanel) {
  leftPanel.addEventListener('mousemove', function(e) {
    var rect = leftPanel.getBoundingClientRect();
    var x = (e.clientX - rect.left - rect.width / 2) / rect.width;
    var y = (e.clientY - rect.top - rect.height / 2) / rect.height;
    document.querySelectorAll('.mini-card').forEach(function(card, i) {
      var factor = (i + 1) * 5;
      card.style.translate = (x * factor) + 'px ' + (y * factor) + 'px';
    });
  });
  leftPanel.addEventListener('mouseleave', function() {
    document.querySelectorAll('.mini-card').forEach(function(card) {
      card.style.translate = '';
    });
  });
}
