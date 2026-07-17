/* ===== Shared JavaScript Utilities ===== */

/**
 * Initialize scroll-reveal animation for all .anim elements
 */
function initScrollReveal() {
  document.querySelectorAll('.anim').forEach(function (el) {
    var io = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) { el.classList.add('show'); io.disconnect(); }
    }, { threshold: 0.1 });
    io.observe(el);
  });
}

/**
 * Get current date/time in CST (Asia/Shanghai, UTC+8)
 * Works correctly regardless of browser/system timezone.
 * @returns {Date}
 */
function getCSTDate() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
}

/**
 * Get time-based greeting string (CST)
 * @returns {string} greeting text
 */
function getTimeGreeting() {
  var h = getCSTDate().getHours();
  if (h < 6) return '夜深了';
  if (h < 12) return '早上好';
  if (h < 14) return '中午好';
  if (h >= 18) return '晚上好';
  return '下午好';
}

/**
 * Apply greeting to a DOM element
 * @param {string} selector - CSS selector for target element
 * @param {string} [name] - optional name to append
 */
function applyGreeting(selector, name) {
  var el = document.querySelector(selector);
  if (el) {
    el.innerHTML = '<span class="wave">👋</span> ' + getTimeGreeting() + (name ? '，' + name : '');
  }
}

/* ===== Theme Toggle ===== */

/**
 * Initialize theme from localStorage or system preference
 */
function initTheme() {
  var saved = localStorage.getItem('theme');
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
}

/**
 * Toggle between light and dark theme
 */
function toggleTheme() {
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('theme', 'dark');
  }
  updateThemeIcon();
}

/**
 * Update the toggle button icon based on current theme
 */
function updateThemeIcon() {
  var btn = document.getElementById('themeToggle');
  if (!btn) return;
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  btn.textContent = isDark ? '☀️' : '🌙';
  btn.title = isDark ? '切换到亮色模式' : '切换到暗色模式';
}

/**
 * Inject theme toggle button into the page
 */
function injectThemeToggle() {
  var btn = document.createElement('button');
  btn.id = 'themeToggle';
  btn.className = 'theme-toggle';
  btn.onclick = toggleTheme;
  document.body.appendChild(btn);
  updateThemeIcon();
}

/* ===== Sidebar User Info ===== */

/**
 * Populate sidebar username and role from Auth.user
 */
function initSidebarUser() {
  var el = document.getElementById('sidebar-username');
  if (!el) return;
  if (typeof Auth !== 'undefined' && Auth.user) {
    var user = Auth.user;
    var displayName = (user.role === 'admin') ? (user.username || '') : (user.full_name || user.username || '');
    el.textContent = displayName;
    // 动态设置角色标签
    var roleEl = document.getElementById('sidebar-role');
    if (roleEl) {
      var roleMap = {
        'admin': '超级管理员',
        'teacher': '教师',
        'student': '学生'
      };
      var roleText = roleMap[user.role] || user.role || '';
      roleEl.textContent = roleText;
    }
    // 替换侧边栏头像（替换 .user-avatar 内容，避免双图标问题）
    var avatarEl = document.querySelector('.user-avatar');
    if (avatarEl) {
      if (user.avatar) {
        avatarEl.innerHTML = '<img src="' + user.avatar + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" alt="avatar">';
      } else if (user.role === 'admin') {
        avatarEl.innerHTML = '<img src="/TeamIco.svg" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" alt="avatar">';
      } else {
        var letter = (user.username || '?')[0].toUpperCase();
        var color = user.role === 'teacher' ? '#7c3aed' : '#ea580c';
        avatarEl.innerHTML = '<div style="width:100%;height:100%;border-radius:50%;background:' + color + ';display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1.1rem;">' + letter + '</div>';
      }
    }
  }
}

/* ===== Admin Sidebar Adaptation for Teacher Pages ===== */

/**
 * When admin visits teacher pages, replace sidebar with admin navigation
 */
function initAdminOnTeacherPage() {
  if (typeof Auth === 'undefined' || !Auth.user || Auth.user.role !== 'admin') return;
  var sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  var currentPath = window.location.pathname;
  var page = currentPath.split('/').pop() || 'dashboard.html';

  function isActive(p) { return page === p ? ' active' : ''; }

  sidebar.innerHTML = ''
    + '<div class="sidebar-logo"><span class="icon-box" style="background:var(--pink)"><i data-lucide="pen-tool"></i></span> 作业提交</div>'
    + '<div class="sidebar-school">系统全局 · 所有院校</div>'
    + '<div class="sidebar-role"><span class="role-tag" style="background:var(--pink);color:#fff">超级管理员</span> 教学管理</div>'
    + '<div class="nav-section">平台管理</div>'
    + '<a class="side-link' + isActive('dashboard.html') + '" href="/admin/dashboard.html"><span class="ico"><i data-lucide="bar-chart-3"></i></span> 控制台</a>'
    + '<a class="side-link' + isActive('schools.html') + '" href="/admin/schools.html"><span class="ico"><i data-lucide="building-2"></i></span> 院校及班级管理</a>'
    + '<a class="side-link' + isActive('users.html') + '" href="/admin/users.html"><span class="ico"><i data-lucide="user"></i></span> 用户管理</a>'
    + '<a class="side-link' + isActive('courses.html') + '" href="/admin/courses.html"><span class="ico"><i data-lucide="book-open"></i></span> 课程管理</a>'
    + '<div class="nav-section">教学功能</div>'
    + '<a class="side-link' + isActive('assignments.html') + '" href="/admin/assignments.html"><span class="ico"><i data-lucide="pen-tool"></i></span> 作业管理</a>'
    + '<a class="side-link' + isActive('submissions.html') + '" href="/admin/submissions.html"><span class="ico"><i data-lucide="check-circle"></i></span> 批改作业</a>'
    + '<a class="side-link' + isActive('scores.html') + '" href="/admin/scores.html"><span class="ico"><i data-lucide="clipboard-list"></i></span> 成绩管理</a>'
    + '<div class="nav-section">系统</div>'
    + '<a class="side-link' + isActive('stats.html') + '" href="/admin/stats.html"><span class="ico"><i data-lucide="trending-up"></i></span> 数据统计</a>'
    + '<a class="side-link' + isActive('settings.html') + '" href="/admin/settings.html"><span class="ico"><i data-lucide="wrench"></i></span> 系统设置</a>'
    + '<a class="side-link' + isActive('logs.html') + '" href="/admin/logs.html"><span class="ico"><i data-lucide="clipboard-list"></i></span> 操作日志</a>'
    + '<div class="sidebar-bottom">'
    + '<div class="user-info">'
    + '<div class="user-avatar" style="background:var(--ink);color:#fff"><i data-lucide="shield"></i></div>'
    + '<div><div class="user-name" id="sidebar-username">' + (Auth.user.username || '管理员') + '</div><div class="user-role" id="sidebar-role">超级管理员</div></div>'
    + '</div>'
    + '<button class="logout-btn" onclick="Auth.logout()"><i data-lucide="log-out" style="width:16px;height:16px"></i> 退出登录</button>'
    + '</div>';

  // Re-render lucide icons for the new sidebar
  if (typeof lucide !== 'undefined' && lucide.createIcons) {
    lucide.createIcons();
  }
}

/* ===== Common Utilities ===== */

/**
 * Sidebar layout: top brand area and bottom user area are fixed, middle nav scrolls independently.
 * Dynamically wraps all content between the top block (.sidebar-role/.sidebar-school/.sidebar-logo)
 * and .sidebar-bottom into a .sidebar-nav container. Must run after initAdminOnTeacherPage
 * so that the rebuilt admin sidebar also gets wrapped.
 */
function initSidebarLayout() {
  var sidebar = document.getElementById('sidebar');
  if (!sidebar || sidebar.querySelector('.sidebar-nav')) return;
  var bottom = sidebar.querySelector('.sidebar-bottom');
  var top = sidebar.querySelector('.sidebar-role')
    || sidebar.querySelector('.sidebar-school')
    || sidebar.querySelector('.sidebar-logo');
  if (!bottom || !top) return;
  var nav = document.createElement('div');
  nav.className = 'sidebar-nav';
  var node = top.nextSibling;
  while (node && node !== bottom) {
    var next = node.nextSibling;
    nav.appendChild(node);
    node = next;
  }
  sidebar.insertBefore(nav, bottom);
}

/**
 * HTML-escape a string to prevent XSS
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

/**
 * Format an ISO date string to "YYYY-MM-DD HH:mm" using CST (Asia/Shanghai)
 * @param {string} dateStr
 * @returns {string}
 */
function formatDate(dateStr) {
  if (!dateStr) return '-';
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  var cst = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  var y = cst.getFullYear();
  var m = ('0' + (cst.getMonth() + 1)).slice(-2);
  var day = ('0' + cst.getDate()).slice(-2);
  var h = ('0' + cst.getHours()).slice(-2);
  var min = ('0' + cst.getMinutes()).slice(-2);
  return y + '-' + m + '-' + day + ' ' + h + ':' + min;
}

/**
 * Format an ISO date string to "YYYY-MM-DD" using CST (Asia/Shanghai)
 * @param {string} dateStr
 * @returns {string}
 */
function formatDateShort(dateStr) {
  if (!dateStr) return '-';
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  var cst = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  var y = cst.getFullYear();
  var m = ('0' + (cst.getMonth() + 1)).slice(-2);
  var day = ('0' + cst.getDate()).slice(-2);
  return y + '-' + m + '-' + day;
}

/**
 * Return CSS class for a numeric grade (>=80 green, >=60 yellow, <60 red)
 * @param {number} grade
 * @returns {string}
 */
function gradeClassOf(grade) {
  return grade >= 80 ? 'grade-high' : (grade >= 60 ? 'grade-mid' : 'grade-low');
}

/**
 * Fill sidebar user info (name, role, school) for the current logged-in user.
 * Works for all roles; reads from Auth.user or falls back to /auth/me API.
 */
function fillSidebarInfo() {
  // Fast path: use Auth.user if available
  if (typeof Auth !== 'undefined' && Auth.user) {
    var user = Auth.user;
    var roleMap = { admin: '超级管理员', teacher: '教师', student: '学生' };
    var displayName = (user.role === 'admin')
      ? (user.username || '管理员')
      : (user.full_name || user.username || '');
    var nameEl = document.getElementById('sidebar-username');
    if (nameEl) nameEl.textContent = displayName;
    var roleEl = document.getElementById('sidebar-role');
    if (roleEl) roleEl.textContent = roleMap[user.role] || user.role || '';
  }
  // Fallback / supplement: fetch from API for school info
  if (typeof API !== 'undefined') {
    API.get('/auth/me').then(function(user) {
      if (!user) return;
      // Fill name/role if not already set by Auth.user
      var nameEl = document.getElementById('sidebar-username');
      if (nameEl && !nameEl.textContent) {
        nameEl.textContent = user.full_name || user.username || '';
      }
      var roleEl = document.getElementById('sidebar-role');
      if (roleEl && !roleEl.textContent) {
        var roleMap = { admin: '超级管理员', teacher: '教师', student: '学生' };
        roleEl.textContent = roleMap[user.role] || user.role || '';
      }
      // Fill school name
      if (user.school_id) {
        API.get('/schools/').then(function(schools) {
          var list = Array.isArray(schools) ? schools : (schools.items || []);
          var match = list.filter(function(s) { return s.id === user.school_id; })[0];
          var schoolEl = document.getElementById('sidebar-school');
          if (schoolEl && match) schoolEl.textContent = match.name;
        });
      }
    }).catch(function(err) {
      console.warn('获取用户信息失败:', err);
    });
  }
}

// Auto-init on DOM ready
document.addEventListener('DOMContentLoaded', function () {
  initTheme();
  injectThemeToggle();
  initScrollReveal();
  initAdminOnTeacherPage();
  initSidebarLayout();
  initSidebarUser();
  lucide.createIcons();
});
