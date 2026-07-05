// 学生 Dashboard 功能模块（简化版 - 仅统计）
document.addEventListener('DOMContentLoaded', function() {
  if (!Auth.requireRole('student')) return;

  // 显示用户名
  var displayName = Auth.getDisplayName();
  var nameEls = document.querySelectorAll('.user-name');
  for (var i = 0; i < nameEls.length; i++) {
    if (nameEls[i].closest('.sidebar')) {
      nameEls[i].textContent = displayName || '学生';
    }
  }

  // 替换 topbar 问候语中的硬编码名称
  applyGreeting('.topbar h1', displayName || '同学');

  // 填充侧边栏用户信息（院校、角色）
  API.get('/auth/me').then(function(user) {
    if (!user) return;
    var roleEl = document.getElementById('sidebar-role');
    if (roleEl) roleEl.textContent = '学生';
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
    var roleEl = document.getElementById('sidebar-role');
    if (roleEl) roleEl.textContent = '学生';
  });

  // 加载数据
  loadDashboardData();
});

// 加载 Dashboard 数据（仅统计）
function loadDashboardData() {
  Promise.all([
    API.get('/assignments/'),
    API.get('/submissions/'),
    API.get('/courses/')
  ]).then(function(results) {
    var assignments = results[0] || [];
    var submissions = results[1] || [];
    var courses = results[2] || [];

    // 如果 courses API 返回为空但有作业，逐个获取课程信息作为 fallback
    if (courses.length === 0 && assignments.length > 0) {
      var courseIds = [];
      var seen = {};
      assignments.forEach(function(a) {
        if (a.course_id && !seen[a.course_id]) {
          seen[a.course_id] = true;
          courseIds.push(a.course_id);
        }
      });
      var coursePromises = courseIds.map(function(cid) {
        return API.get('/courses/' + cid).catch(function() { return null; });
      });
      Promise.all(coursePromises).then(function(fetchedCourses) {
        var _cachedCourses = fetchedCourses.filter(function(c) { return c !== null; });
        updateHeroStats(assignments, submissions);
      });
    } else {
      updateHeroStats(assignments, submissions);
    }
  }).catch(function(err) {
    console.error('加载数据失败:', err);
    showError('加载作业数据失败，请刷新页面重试');
  });
}

// 更新 Hero 区域统计
function updateHeroStats(assignments, submissions) {
  var subMap = {};
  submissions.forEach(function(s) { subMap[s.assignment_id] = s; });

  var pending = 0;
  var submitted = 0;
  var graded = 0;
  assignments.forEach(function(a) {
    var sub = subMap[a.id];
    if (!sub) {
      pending++;
    } else {
      submitted++;
      if (sub.grade !== null && sub.grade !== undefined) {
        graded++;
      }
    }
  });

  // 更新 hero 描述
  var heroDesc = document.getElementById('hero-desc');
  if (heroDesc) {
    if (pending > 0) {
      heroDesc.innerHTML = '当前有 <b>' + pending + ' 项作业</b>待提交，已提交 <em>' + submitted + '</em> 项';
    } else if (assignments.length > 0) {
      heroDesc.innerHTML = '所有作业已提交，共 <b>' + submitted + '</b> 项';
    } else {
      heroDesc.innerHTML = '暂无作业安排，享受学习时光';
    }
  }

  // 更新 hero 统计卡片
  var heroStats = document.getElementById('hero-stats');
  if (heroStats) {
    var passRate = graded > 0 ? Math.round((graded / submitted) * 100) : 0;
    heroStats.innerHTML =
      '<div class="h-stat">' +
        '<div class="h-stat-icon" style="background:rgba(224,122,95,.1);color:#e07a5f"><i data-lucide="clipboard-list"></i></div>' +
        '<div class="h-stat-num">' + pending + '<small>项</small></div>' +
        '<div class="h-stat-label">待提交</div>' +
      '</div>' +
      '<div class="h-stat">' +
        '<div class="h-stat-icon" style="background:rgba(210,153,27,.1);color:#d2991b"><i data-lucide="upload"></i></div>' +
        '<div class="h-stat-num">' + submitted + '<small>项</small></div>' +
        '<div class="h-stat-label">已提交</div>' +
      '</div>' +
      '<div class="h-stat">' +
        '<div class="h-stat-icon" style="background:rgba(63,185,80,.1);color:#3fb950"><i data-lucide="check"></i></div>' +
        '<div class="h-stat-num">' + (submitted > 0 ? passRate : 0) + '<small>%</small></div>' +
        '<div class="h-stat-label">已批改</div>' +
      '</div>';

    // 重新渲染 lucide 图标
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }
}

// 显示错误提示
function showError(msg) {
  showToast(msg, 'error');
}

// 显示成功提示
function showSuccess(msg) {
  showToast(msg, 'success');
}

// 通用 Toast 提示
function showToast(msg, type) {
  var existing = document.querySelector('.toast-msg');
  if (existing) existing.parentNode.removeChild(existing);

  var toast = document.createElement('div');
  toast.className = 'toast-msg';
  toast.textContent = msg;
  toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);' +
    'padding:10px 24px;border-radius:8px;font-size:.85rem;z-index:9999;' +
    'box-shadow:0 4px 12px rgba(0,0,0,.15);transition:opacity .3s;' +
    (type === 'error' ? 'background:#e07a5f;color:#fff' : 'background:#3fb950;color:#fff');
  document.body.appendChild(toast);

  setTimeout(function() {
    toast.style.opacity = '0';
    setTimeout(function() {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, 3000);
}
