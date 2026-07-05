// 学生提交记录页面
var allRows = []; // {submission, assignment, course, status}
var lateSubmissionMap = {}; // submission_id -> late submission record
var currentLateSubmissionId = null;

function parseCST(dateStr) {
  if (!dateStr) return new Date(NaN);
  var s = String(dateStr);
  if (s.length > 10 && s.indexOf('Z') === -1 && s.indexOf('+') === -1) s += '+08:00';
  return new Date(s);
}
function cstNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
}

document.addEventListener('DOMContentLoaded', function() {
  if (!Auth.requireRole('student')) return;

  fillSidebarInfo();

  // 筛选事件
  document.getElementById('filter-course').addEventListener('change', applyFilters);
  document.getElementById('filter-status').addEventListener('change', applyFilters);

  loadData();
});

// 加载数据
function loadData() {
  Promise.all([
    API.get('/submissions/'),
    API.get('/assignments/'),
    API.get('/courses/'),
    API.get('/late-submissions/')
  ]).then(function(results) {
    var submissions = results[0] || [];
    var assignments = results[1] || [];
    var courses = results[2] || [];
    var lateList = results[3] || [];

    // 构建映射
    var assignmentMap = {};
    assignments.forEach(function(a) { assignmentMap[a.id] = a; });

    var courseMap = {};
    courses.forEach(function(c) { courseMap[c.id] = c; });

    // 已提交的作业ID
    var submittedIds = {};
    submissions.forEach(function(s) { submittedIds[s.assignment_id] = true; });

    // 补交记录映射
    lateSubmissionMap = {};
    lateList.forEach(function(l) { lateSubmissionMap[l.submission_id] = l; });

    // 构建行数据
    allRows = [];

    // 已提交的记录
    submissions.forEach(function(s) {
      var assignment = assignmentMap[s.assignment_id];
      var course = assignment ? courseMap[assignment.course_id] : null;
      var status = getSubmissionStatus(s, assignment);
      allRows.push({
        submission: s,
        assignment: assignment,
        course: course,
        status: status
      });
    });

    // 未提交但已逾期的作业
    assignments.forEach(function(a) {
      if (!submittedIds[a.id] && a.deadline && parseCST(a.deadline) < cstNow()) {
        var course = courseMap[a.course_id];
        allRows.push({
          submission: null,
          assignment: a,
          course: course,
          status: 'overdue'
        });
      }
    });

    // 填充课程筛选
    populateCourseFilter(courses);

    // 渲染表格
    renderTable(allRows);

    // 显示动画
    var anims = document.querySelectorAll('.anim');
    anims.forEach(function(el) { el.classList.add('show'); });
  }).catch(function(err) {
    console.error('加载数据失败:', err);
    var tbody = document.getElementById('submissions-tbody');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#999">加载失败，请刷新重试</td></tr>';
  });
}

// 状态判断
function getSubmissionStatus(submission, assignment) {
  if (submission.grade !== null && submission.grade !== undefined) {
    return 'graded';
  }
  if (assignment && assignment.deadline && parseCST(assignment.deadline) < cstNow()) {
    return 'overdue';
  }
  return 'submitted';
}

// 填充课程筛选下拉
function populateCourseFilter(courses) {
  var select = document.getElementById('filter-course');
  // 保留第一个"全部课程"选项
  var usedCourseIds = {};
  allRows.forEach(function(row) {
    if (row.course) usedCourseIds[row.course.id] = row.course.name;
  });

  for (var id in usedCourseIds) {
    var opt = document.createElement('option');
    opt.value = id;
    opt.textContent = usedCourseIds[id];
    select.appendChild(opt);
  }
}

// 渲染表格
function renderTable(rows) {
  var tbody = document.getElementById('submissions-tbody');

  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#999">暂无提交记录</td></tr>';
    return;
  }

  var html = '';
  rows.forEach(function(row) {
    var a = row.assignment;
    var s = row.submission;
    var c = row.course;
    var status = row.status;

    var assignName = a ? escapeHtml(a.title) : '-';
    var courseName = c ? escapeHtml(c.name) : '-';
    var fileName = s ? escapeHtml(s.file_name) : '-';
    var submitTime = s ? formatDate(s.submitted_at) : '-';

    // 状态标签
    var statusClass = 'status-' + status;
    var statusLabel = status === 'graded' ? '已批改' : (status === 'submitted' ? '已提交' : '逾期');
    var statusHtml = '<span class="status-tag ' + statusClass + '">' + statusLabel + '</span>';

    // 成绩
    var gradeText = (s && s.grade !== null && s.grade !== undefined) ? s.grade : '-';

    // 操作
    var actionHtml = '';
    if (status === 'overdue' && !s) {
      // 未提交的逾期作业，不能申请补交（需要已有提交记录）
      actionHtml = '<span style="color:#999;font-size:.75rem">需先提交</span>';
    } else if (status === 'overdue' && s) {
      // 已提交但逾期的记录，检查是否已有补交申请
      var late = lateSubmissionMap[s.id];
      if (late) {
        var lateLabel = late.status === 'approved' ? '已批准' : (late.status === 'rejected' ? '已拒绝' : '待审批');
        actionHtml = '<span style="font-size:.75rem;color:#d2991b">补交' + lateLabel + '</span>';
      } else {
        actionHtml = '<button class="btn btn-secondary" style="font-size:.72rem;padding:4px 12px" onclick="openLateModal(' + s.id + ')">申请补交</button>';
      }
    } else {
      actionHtml = '-';
    }

    html += '<tr>' +
      '<td>' + assignName + '</td>' +
      '<td>' + courseName + '</td>' +
      '<td>' + fileName + '</td>' +
      '<td>' + submitTime + '</td>' +
      '<td>' + statusHtml + '</td>' +
      '<td>' + gradeText + '</td>' +
      '<td>' + actionHtml + '</td>' +
      '</tr>';
  });

  tbody.innerHTML = html;
}

// 应用筛选
function applyFilters() {
  var courseId = document.getElementById('filter-course').value;
  var statusFilter = document.getElementById('filter-status').value;

  var filtered = allRows.filter(function(row) {
    if (courseId && row.course && row.course.id !== parseInt(courseId)) return false;
    if (statusFilter && row.status !== statusFilter) return false;
    return true;
  });

  renderTable(filtered);
}

// 补交弹窗
function openLateModal(submissionId) {
  currentLateSubmissionId = submissionId;
  document.getElementById('late-reason').value = '';
  document.getElementById('late-error').style.display = 'none';
  openModal('late-overlay');
}

function submitLateRequest() {
  var reason = document.getElementById('late-reason').value.trim();
  var errorEl = document.getElementById('late-error');

  if (!reason) {
    errorEl.textContent = '请填写补交理由';
    errorEl.style.display = 'block';
    return;
  }

  errorEl.style.display = 'none';
  var btn = document.getElementById('late-submit-btn');
  btn.disabled = true;
  btn.textContent = '提交中...';

  API.post('/late-submissions/', {
    submission_id: currentLateSubmissionId,
    reason: reason
  }).then(function() {
    closeModal('late-overlay');
    btn.disabled = false;
    btn.textContent = '提交申请';
    showToast('补交申请已提交', 'success');
    loadData();
  }).catch(function(err) {
    btn.disabled = false;
    btn.textContent = '提交申请';
    var msg = (err && err.message) ? err.message : '提交失败，请重试';
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
  });
}

// 填充侧边栏信息
function fillSidebarInfo() {
  var displayName = Auth.getDisplayName();
  var nameEl = document.getElementById('sidebar-username');
  if (nameEl) nameEl.textContent = displayName || '学生';

  var roleEl = document.getElementById('sidebar-role');
  if (roleEl) roleEl.textContent = '学生';

  API.get('/auth/me').then(function(user) {
    if (!user) return;
    if (nameEl) nameEl.textContent = user.full_name || user.username || '学生';
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

// 弹窗控制
function openModal(id) {
  var el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  var el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

// 工具函数
function formatDate(dateStr) {
  if (!dateStr) return '-';
  var d = parseCST(dateStr);
  var y = d.getFullYear();
  var m = ('0' + (d.getMonth() + 1)).slice(-2);
  var day = ('0' + d.getDate()).slice(-2);
  var h = ('0' + d.getHours()).slice(-2);
  var min = ('0' + d.getMinutes()).slice(-2);
  return y + '-' + m + '-' + day + ' ' + h + ':' + min;
}

function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

// Toast 提示
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
