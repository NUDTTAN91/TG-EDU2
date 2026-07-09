// 学生提交记录页面
var allRows = []; // {submission, assignment, course, status}
var lateSubmissionMap = {}; // 索引：submission_id / ('a-' + assignment_id) → late 记录
var currentLateSubmissionId = null; // 兼容旧模式（针对某 submission）
var currentLateAssignmentId = null; // 新模式（针对某 assignment）
var currentResubmitId = null; // 当前正在重新提交的 submission id

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

  // 重新提交：文件选择器 change 后触发上传
  var resubmitInput = document.getElementById('resubmit-file-input');
  if (resubmitInput) {
    resubmitInput.addEventListener('change', function() {
      var f = this.files && this.files[0];
      if (f && currentResubmitId) {
        doResubmit(currentResubmitId, f);
      }
      this.value = '';
    });
  }

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

    // 补交记录映射：分别按 submission_id 与 assignment_id 建索引
    lateSubmissionMap = {};
    lateList.forEach(function(l) {
      if (l.submission_id) lateSubmissionMap['s-' + l.submission_id] = l;
      if (l.assignment_id) lateSubmissionMap['a-' + l.assignment_id] = l;
    });

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

  var now = cstNow();
  var html = '';
  rows.forEach(function(row) {
    var a = row.assignment;
    var s = row.submission;
    var c = row.course;
    var status = row.status;

    var assignName = a ? escapeHtml(a.title) : '-';
    var courseName = c ? escapeHtml(c.name) : '-';
    var submitTime = s ? formatDate(s.submitted_at) : '-';

    // 文件列：已提交则渲染为下载链接（走鉴权 API）
    var fileCell;
    if (s) {
      var safeName = escapeHtml(s.file_name || '');
      fileCell = '<a href="javascript:void(0)" onclick="downloadSubmission(' + s.id + ')" ' +
                 'style="color:#58a6ff;text-decoration:underline">' + safeName + '</a>';
    } else {
      fileCell = '-';
    }

    // 状态标签
    var statusClass = 'status-' + status;
    var statusLabel = status === 'graded' ? '已批改' : (status === 'submitted' ? '已提交' : '逾期');
    var statusHtml = '<span class="status-tag ' + statusClass + '">' + statusLabel + '</span>';

    // 成绩
    var gradeText = (s && s.grade !== null && s.grade !== undefined) ? s.grade : '-';

    // 操作
    var actions = [];
    if (s) {
      // 未过 deadline → 可以重新提交（不论是否已批）
      var deadline = a && a.deadline ? parseCST(a.deadline) : null;
      var canResubmit = !deadline || deadline > now;
      if (canResubmit) {
        actions.push('<button class="btn btn-secondary" style="font-size:.72rem;padding:4px 12px;margin-right:4px" ' +
                     'onclick="triggerResubmit(' + s.id + ')">重新提交</button>');
      }
      // 已提交且逾期 → 若无 pending/approved 补交则显示"申请补交"
      if (status === 'overdue') {
        var lateForSub = lateSubmissionMap['s-' + s.id] || (a ? lateSubmissionMap['a-' + a.id] : null);
        if (lateForSub) {
          var lateLabel = lateForSub.status === 'approved' ? '已批准' :
                          (lateForSub.status === 'rejected' ? '已拒绝' : '待审批');
          actions.push('<span style="font-size:.75rem;color:#d2991b">补交' + lateLabel + '</span>');
        } else {
          actions.push('<button class="btn btn-secondary" style="font-size:.72rem;padding:4px 12px" ' +
                       'onclick="openLateModalForSubmission(' + s.id + ')">申请补交</button>');
        }
      }
    } else if (status === 'overdue' && a) {
      // 未提交且逾期 → 直接按 assignment 申请补交
      var lateForAssignment = lateSubmissionMap['a-' + a.id];
      if (lateForAssignment) {
        var alabel = lateForAssignment.status === 'approved' ? '已批准' :
                     (lateForAssignment.status === 'rejected' ? '已拒绝' : '待审批');
        actions.push('<span style="font-size:.75rem;color:#d2991b">补交' + alabel + '</span>');
      } else {
        actions.push('<button class="btn btn-secondary" style="font-size:.72rem;padding:4px 12px" ' +
                     'onclick="openLateModalForAssignment(' + a.id + ')">申请补交</button>');
      }
    }
    var actionHtml = actions.length ? actions.join('') : '-';

    html += '<tr>' +
      '<td>' + assignName + '</td>' +
      '<td>' + courseName + '</td>' +
      '<td>' + fileCell + '</td>' +
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

// ===== 下载 =====
function downloadSubmission(submissionId) {
  // 找到 file_name 作为下载文件名
  var name = 'submission';
  for (var i = 0; i < allRows.length; i++) {
    var s = allRows[i].submission;
    if (s && s.id === submissionId) { name = s.file_name || name; break; }
  }
  API.download('/submissions/' + submissionId + '/download', name).catch(function(err) {
    showToast('下载失败: ' + (err.message || '未知错误'), 'error');
  });
}

// ===== 重新提交 =====
function triggerResubmit(submissionId) {
  currentResubmitId = submissionId;
  var input = document.getElementById('resubmit-file-input');
  if (input) input.click();
}

function doResubmit(submissionId, file) {
  // 简单预检：文件大小 (统一按 50MB 兜底，具体限制由服务端校验)
  if (file.size > 100 * 1024 * 1024) {
    showToast('文件过大，请压缩后再上传', 'error');
    return;
  }
  var formData = new FormData();
  formData.append('file', file);
  showToast('正在上传...', 'success');
  API.uploadWithProgress('/submissions/' + submissionId, formData, null, 'PUT')
    .then(function() {
      showToast('重新提交成功', 'success');
      loadData();
    })
    .catch(function(err) {
      showToast('重新提交失败: ' + (err.message || '未知错误'), 'error');
    });
}

// ===== 补交申请 =====
function openLateModalForSubmission(submissionId) {
  currentLateSubmissionId = submissionId;
  currentLateAssignmentId = null;
  document.getElementById('late-title').textContent = '申请补交（针对已提交作业）';
  document.getElementById('late-reason').value = '';
  document.getElementById('late-error').style.display = 'none';
  openModal('late-overlay');
}

function openLateModalForAssignment(assignmentId) {
  currentLateAssignmentId = assignmentId;
  currentLateSubmissionId = null;
  document.getElementById('late-title').textContent = '申请补交';
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

  var payload = { reason: reason };
  if (currentLateSubmissionId) payload.submission_id = currentLateSubmissionId;
  if (currentLateAssignmentId) payload.assignment_id = currentLateAssignmentId;

  API.post('/late-submissions/', payload).then(function() {
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
