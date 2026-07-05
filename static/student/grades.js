// 学生成绩查看页面
document.addEventListener('DOMContentLoaded', function() {
  if (!Auth.requireRole('student')) return;

  fillSidebarInfo();
  initGrades();

  // 课程筛选
  document.getElementById('filter-course').addEventListener('change', function() {
    _currentPage = 1;
    fetchGradedPage();
  });
});

// 全局状态
var _courseMap = {};
var _assignmentMap = {};
var _allGraded = [];   // 全部已批改数据（用于统计卡片 & 课程筛选下拉）
var _currentPage = 1;
var _pageSize = 20;
var _totalGraded = 0;

// 初始化
function initGrades() {
  Promise.all([
    API.get('/assignments/'),
    API.get('/courses/'),
    API.get('/submissions/')           // 全量（legacy 模式），仅用于统计
  ]).then(function(results) {
    var assignments = Array.isArray(results[0]) ? results[0] : [];
    var courses = Array.isArray(results[1]) ? results[1] : [];
    var submissions = Array.isArray(results[2]) ? results[2] : [];

    // 构建映射
    _assignmentMap = {};
    assignments.forEach(function(a) { _assignmentMap[a.id] = a; });
    _courseMap = {};
    courses.forEach(function(c) { _courseMap[c.id] = c; });

    // 提取已批改提交（关联作业 + 课程）
    _allGraded = [];
    submissions.forEach(function(sub) {
      if (sub.grade === null || sub.grade === undefined) return;
      var assignment = _assignmentMap[sub.assignment_id] || {};
      var course = _courseMap[assignment.course_id] || {};
      _allGraded.push({
        assignment_title: assignment.title || ('作业 #' + sub.assignment_id),
        course_name: course.name || '-',
        course_id: assignment.course_id || null,
        grade: sub.grade,
        feedback: sub.feedback || '',
        graded_at: sub.graded_at || sub.submitted_at
      });
    });

    renderStatsCards();
    renderCourseFilter();

    // 首次加载表格（分页）
    fetchGradedPage();

    // 触发动画
    setTimeout(function() {
      var anims = document.querySelectorAll('.anim');
      for (var i = 0; i < anims.length; i++) anims[i].classList.add('show');
    }, 50);
  }).catch(function(err) {
    console.error('加载成绩数据失败:', err);
    document.getElementById('grades-tbody').innerHTML =
      '<tr><td colspan="5" style="text-align:center;padding:40px;color:#f85149">加载失败，请刷新页面</td></tr>';
  });
}

// 获取分页数据用于表格渲染
function fetchGradedPage() {
  var courseFilter = document.getElementById('filter-course').value;

  // 如果有课程筛选，使用客户端分页（从 _allGraded 过滤）
  if (courseFilter) {
    var cid = parseInt(courseFilter, 10);
    var filtered = _allGraded.filter(function(g) { return g.course_id === cid; });
    _totalGraded = filtered.length;
    var totalPages = Math.ceil(filtered.length / _pageSize) || 1;
    if (_currentPage > totalPages) _currentPage = totalPages;
    var start = (_currentPage - 1) * _pageSize;
    var pageItems = filtered.slice(start, start + _pageSize);
    renderGradesTable(pageItems);
    renderPagination(totalPages);
    return;
  }

  // 无筛选时使用后端分页（仅已批改，按 graded_at 降序）
  // 因为后端不支持 graded 过滤，用客户端分页保证正确性
  var totalPages = Math.ceil(_allGraded.length / _pageSize) || 1;
  if (_currentPage > totalPages) _currentPage = totalPages;
  _totalGraded = _allGraded.length;
  var start = (_currentPage - 1) * _pageSize;
  var pageItems = _allGraded.slice(start, start + _pageSize);
  renderGradesTable(pageItems);
  renderPagination(totalPages);
}

// 渲染统计汇总卡片（基于全量已批改数据）
function renderStatsCards() {
  var container = document.getElementById('stats-cards');
  if (!_allGraded.length) {
    container.innerHTML =
      '<div class="stat-card"><div class="stat-label">平均分</div><div class="stat-value">-</div><div class="stat-sub">暂无已批改作业</div></div>' +
      '<div class="stat-card"><div class="stat-label">最高分</div><div class="stat-value">-</div><div class="stat-sub">-</div></div>' +
      '<div class="stat-card"><div class="stat-label">已批改</div><div class="stat-value">0</div><div class="stat-sub">共 0 项作业</div></div>';
    return;
  }

  var total = 0;
  var maxGrade = -1;
  var maxCourseName = '';
  _allGraded.forEach(function(g) {
    total += g.grade;
    if (g.grade > maxGrade) {
      maxGrade = g.grade;
      maxCourseName = g.course_name;
    }
  });
  var avg = Math.round(total / _allGraded.length);
  var totalAssignments = Object.keys(_assignmentMap).length;

  container.innerHTML =
    '<div class="stat-card">' +
      '<div class="stat-label">平均分</div>' +
      '<div class="stat-value">' + avg + '</div>' +
      '<div class="stat-sub">共 ' + _allGraded.length + ' 项已批改</div>' +
    '</div>' +
    '<div class="stat-card">' +
      '<div class="stat-label">最高分</div>' +
      '<div class="stat-value">' + maxGrade + '</div>' +
      '<div class="stat-sub">' + escapeHtml(maxCourseName) + '</div>' +
    '</div>' +
    '<div class="stat-card">' +
      '<div class="stat-label">已批改</div>' +
      '<div class="stat-value">' + _allGraded.length + '/' + totalAssignments + '</div>' +
      '<div class="stat-sub">共 ' + totalAssignments + ' 项作业</div>' +
    '</div>';
}

// 渲染课程筛选下拉
function renderCourseFilter() {
  var select = document.getElementById('filter-course');
  var seen = {};
  var courseOptions = [];
  _allGraded.forEach(function(g) {
    if (g.course_id && !seen[g.course_id]) {
      seen[g.course_id] = true;
      courseOptions.push({ id: g.course_id, name: g.course_name });
    }
  });

  select.innerHTML = '<option value="">全部课程</option>';
  courseOptions.forEach(function(c) {
    var opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    select.appendChild(opt);
  });
}

// 渲染成绩表格（当前页数据）
function renderGradesTable(data) {
  var tbody = document.getElementById('grades-tbody');

  if (!data || !data.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:#999">暂无成绩记录</td></tr>';
    return;
  }

  var html = '';
  data.forEach(function(g) {
    var gradeClass = gradeClassOf(g.grade);
    var feedback = g.feedback ? escapeHtml(g.feedback) : '-';
    html +=
      '<tr>' +
        '<td>' + escapeHtml(g.assignment_title) + '</td>' +
        '<td>' + escapeHtml(g.course_name) + '</td>' +
        '<td><span class="grade-score ' + gradeClass + '">' + g.grade + '</span></td>' +
        '<td><span class="grade-feedback" title="' + escapeHtml(g.feedback) + '">' + feedback + '</span></td>' +
        '<td>' + formatDate(g.graded_at) + '</td>' +
      '</tr>';
  });
  tbody.innerHTML = html;
}

// 渲染分页控件
function renderPagination(totalPages) {
  var container = document.getElementById('pagination');
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  var html = '';
  // 上一页
  html += '<button' + (_currentPage <= 1 ? ' disabled' : '') + ' data-page="' + (_currentPage - 1) + '">&laquo; 上一页</button>';

  // 页码按钮
  var pages = getVisiblePages(_currentPage, totalPages);
  pages.forEach(function(p) {
    if (p === '...') {
      html += '<span class="page-info">…</span>';
    } else {
      html += '<button' + (p === _currentPage ? ' class="active"' : '') + ' data-page="' + p + '">' + p + '</button>';
    }
  });

  // 下一页
  html += '<button' + (_currentPage >= totalPages ? ' disabled' : '') + ' data-page="' + (_currentPage + 1) + '">下一页 &raquo;</button>';

  // 信息
  html += '<span class="page-info">第 ' + _currentPage + '/' + totalPages + ' 页，共 ' + _totalGraded + ' 条</span>';

  container.innerHTML = html;

  // 绑定点击事件
  container.querySelectorAll('button[data-page]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      if (this.disabled) return;
      _currentPage = parseInt(this.getAttribute('data-page'), 10);
      fetchGradedPage();
    });
  });
}

// 计算可见页码（最多显示 7 个按钮）
function getVisiblePages(current, total) {
  if (total <= 7) {
    var arr = [];
    for (var i = 1; i <= total; i++) arr.push(i);
    return arr;
  }
  if (current <= 3) return [1, 2, 3, 4, '...', total];
  if (current >= total - 2) return [1, '...', total - 3, total - 2, total - 1, total];
  return [1, '...', current - 1, current, current + 1, '...', total];
}
