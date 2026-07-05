// Admin Dashboard 功能模块
document.addEventListener('DOMContentLoaded', function() {
  if (!Auth.requireRole('admin')) return;

  // 加载所有数据
  loadAllData();
});

// HTML 转义防 XSS
function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

// 将后端CST时间字符串解析为正确的Date对象
function parseCST(dateStr) {
  if (!dateStr) return new Date(NaN);
  var s = String(dateStr);
  if (s.length > 10 && s.indexOf('Z') === -1 && s.indexOf('+') === -1) s += '+08:00';
  return new Date(s);
}

// 获取当前CST时间
function cstNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
}

// 格式化数字，添加千分位逗号
function formatNumber(num) {
  if (num === undefined || num === null) return '0';
  return Number(num).toLocaleString();
}

// 计算相对时间
function timeAgo(dateStr) {
  if (!dateStr) return '未知时间';
  var now = cstNow();
  var date = parseCST(dateStr);
  var diff = Math.floor((now - date) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  if (diff < 2592000) return Math.floor(diff / 86400) + ' 天前';
  return date.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

// 获取本月初的日期 (CST)
function getMonthStart() {
  var now = cstNow();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

// 获取本周一的日期 (CST)
function getWeekStart() {
  var now = cstNow();
  var day = now.getDay();
  var diff = day === 0 ? 6 : day - 1;
  var start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
  start.setHours(0, 0, 0, 0);
  return start;
}

// 判断日期是否在本月 (CST)
function isThisMonth(dateStr) {
  if (!dateStr) return false;
  var d = parseCST(dateStr);
  var now = cstNow();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

// 判断日期是否在本周 (CST)
function isThisWeek(dateStr) {
  if (!dateStr) return false;
  var d = parseCST(dateStr);
  return d >= getWeekStart();
}

// 主加载函数，并行获取所有数据
function loadAllData() {
  var statsPromise = API.get('/admin/stats').catch(function(err) {
    console.error('加载统计数据失败:', err);
    return null;
  });

  var schoolsPromise = API.get('/schools/').catch(function(err) {
    console.error('加载院校列表失败:', err);
    return [];
  });

  var usersPromise = API.get('/admin/users').catch(function(err) {
    console.error('加载用户列表失败:', err);
    return [];
  });

  var coursesPromise = API.get('/courses/').catch(function(err) {
    console.error('加载课程列表失败:', err);
    return [];
  });

  var assignmentsPromise = API.get('/assignments/').catch(function(err) {
    console.error('加载作业列表失败:', err);
    return [];
  });

  var submissionsPromise = API.get('/submissions/').catch(function(err) {
    console.error('加载提交列表失败:', err);
    return [];
  });

  Promise.all([statsPromise, schoolsPromise, usersPromise, coursesPromise, assignmentsPromise, submissionsPromise])
    .then(function(results) {
      var stats = results[0] || {};
      var schools = results[1] || [];
      var users = results[2] || [];
      var courses = results[3] || [];
      var assignments = results[4] || [];
      var submissions = results[5] || [];

      // 更新统计卡片主数字
      updateStatCards(stats);
      // 更新统计卡片副标题
      updateSubtitles(stats, schools, users, assignments, submissions);
      // 渲染院校列表
      renderSchoolList(schools, users, courses);
      // 渲染最近动态
      renderActivity(users, submissions);
      // 渲染本月提交量柱状图
      renderBarChart(schools, submissions);
      // 渲染用户角色分布饼图
      renderPieChart(stats);
    });
}

// 更新统计卡片主数字
function updateStatCards(stats) {
  var fields = {
    'total_schools': stats.total_schools,
    'total_teachers': stats.total_teachers,
    'total_students': stats.total_students,
    'total_assignments': stats.total_assignments,
    'total_submissions': stats.total_submissions
  };

  Object.keys(fields).forEach(function(key) {
    var el = document.querySelector('[data-stat="' + key + '"]');
    if (el) {
      el.textContent = formatNumber(fields[key] !== undefined ? fields[key] : 0);
    }
  });
}

// 更新统计卡片副标题
function updateSubtitles(stats, schools, users, assignments, submissions) {
  // 入驻院校：X 所
  var subSchools = document.getElementById('sub-schools');
  if (subSchools) {
    var schoolCount = Array.isArray(schools) ? schools.length : 0;
    subSchools.textContent = schoolCount + ' 所';
  }

  // 教师用户：本月新增 X
  var subTeachers = document.getElementById('sub-teachers');
  if (subTeachers) {
    var newTeachers = 0;
    if (Array.isArray(users)) {
      for (var i = 0; i < users.length; i++) {
        if (users[i].role === 'teacher' && users[i].created_at && isThisMonth(users[i].created_at)) {
          newTeachers++;
        }
      }
    }
    subTeachers.textContent = '本月新增 ' + newTeachers;
  }

  // 学生用户：活跃 X
  var subStudents = document.getElementById('sub-students');
  if (subStudents) {
    var activeStudents = 0;
    if (Array.isArray(users)) {
      for (var i = 0; i < users.length; i++) {
        if (users[i].role === 'student' && users[i].is_active) {
          activeStudents++;
        }
      }
    }
    subStudents.textContent = '活跃 ' + formatNumber(activeStudents);
  }

  // 累计作业：本学期 X
  var subAssignments = document.getElementById('sub-assignments');
  if (subAssignments) {
    var assignmentCount = Array.isArray(assignments) ? assignments.length : 0;
    subAssignments.textContent = '本学期 ' + formatNumber(assignmentCount);
  }

  // 累计提交：本周 +X
  var subSubmissions = document.getElementById('sub-submissions');
  if (subSubmissions) {
    var weekSubmissions = 0;
    if (Array.isArray(submissions)) {
      for (var i = 0; i < submissions.length; i++) {
        if (submissions[i].submitted_at && isThisWeek(submissions[i].submitted_at)) {
          weekSubmissions++;
        }
      }
    }
    subSubmissions.textContent = '本周 +' + formatNumber(weekSubmissions);
  }
}

// 渲染院校列表
function renderSchoolList(schools, users, courses) {
  var container = document.getElementById('school-list-container');
  if (!container) return;

  if (!Array.isArray(schools) || schools.length === 0) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#aaa;font-size:.84rem">暂无院校数据</div>';
    return;
  }

  var iconColors = [
    'rgba(108,182,255,.12)',
    'rgba(240,201,41,.12)',
    'rgba(126,201,74,.12)',
    'rgba(180,165,245,.12)',
    'rgba(255,107,157,.12)'
  ];

  var iconNames = ['building-2', 'landmark', 'building', 'graduation-cap', 'school'];
  var html = '';

  for (var i = 0; i < schools.length; i++) {
    var school = schools[i];
    var schoolId = school.id;

    // 统计该院校的教师数
    var teacherCount = 0;
    if (Array.isArray(users)) {
      for (var j = 0; j < users.length; j++) {
        if (users[j].school_id === schoolId && users[j].role === 'teacher') teacherCount++;
      }
    }

    // 统计该院校的课程数
    var courseCount = 0;
    if (Array.isArray(courses)) {
      for (var k = 0; k < courses.length; k++) {
        if (courses[k].school_id === schoolId) courseCount++;
      }
    }

    // 统计该院校的学生数
    var studentCount = 0;
    if (Array.isArray(users)) {
      for (var m = 0; m < users.length; m++) {
        if (users[m].school_id === schoolId && users[m].role === 'student') studentCount++;
      }
    }

    var colorIdx = i % iconColors.length;
    var iconIdx = i % iconNames.length;
    var statusClass = school.is_active !== false ? 'sc-active' : 'sc-pending';
    var statusText = school.is_active !== false ? '运行中' : '试运行';

    html += '<div class="sc-item">' +
      '<div class="sc-icon" style="background:' + iconColors[colorIdx] + '"><i data-lucide="' + iconNames[iconIdx] + '"></i></div>' +
      '<div class="sc-info">' +
        '<div class="sc-name">' + escapeHtml(school.name) + '</div>' +
        '<div class="sc-meta">' + teacherCount + ' 位教师 · ' + courseCount + ' 门课程 · ' + formatNumber(studentCount) + '+ 学生</div>' +
      '</div>' +
      '<span class="sc-status ' + statusClass + '">' + statusText + '</span>' +
    '</div>';
  }

  container.innerHTML = html;

  // 重新渲染 lucide 图标
  if (typeof lucide !== 'undefined' && lucide.createIcons) {
    lucide.createIcons();
  }
}

// 渲染最近动态
function renderActivity(users, submissions) {
  var container = document.getElementById('activity-container');
  if (!container) return;

  var activities = [];

  // 从提交记录中获取最近动态
  if (Array.isArray(submissions)) {
    var sortedSubs = submissions.slice().sort(function(a, b) {
      return parseCST(b.submitted_at || 0) - parseCST(a.submitted_at || 0);
    });
    for (var i = 0; i < Math.min(sortedSubs.length, 3); i++) {
      var sub = sortedSubs[i];
      activities.push({
        text: '学生提交了作业 <strong>#' + (sub.assignment_id || '') + '</strong>',
        time: timeAgo(sub.submitted_at),
        color: 'var(--lime)',
        sortDate: parseCST(sub.submitted_at || 0)
      });
    }
  }

  // 从用户列表获取最近创建的用户
  if (Array.isArray(users)) {
    var sortedUsers = users.slice().sort(function(a, b) {
      return parseCST(b.created_at || 0) - parseCST(a.created_at || 0);
    });
    for (var j = 0; j < Math.min(sortedUsers.length, 3); j++) {
      var user = sortedUsers[j];
      var roleText = user.role === 'teacher' ? '教师' : (user.role === 'student' ? '学生' : '管理员');
      activities.push({
        text: '新增' + roleText + '账号 <strong>' + escapeHtml(user.full_name || user.username || '') + '</strong>',
        time: timeAgo(user.created_at),
        color: user.role === 'teacher' ? 'var(--sky)' : 'var(--yellow)',
        sortDate: parseCST(user.created_at || 0)
      });
    }
  }

  if (activities.length === 0) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#aaa;font-size:.84rem">暂无动态</div>';
    return;
  }

  // 按时间排序
  activities.sort(function(a, b) {
    return b.sortDate - a.sortDate;
  });

  // 只显示最近 5 条
  var displayActivities = activities.slice(0, 5);
  var html = '';

  for (var k = 0; k < displayActivities.length; k++) {
    var act = displayActivities[k];
    html += '<div class="fd-item">' +
      '<span class="fd-dot" style="background:' + act.color + '"></span>' +
      '<div>' +
        '<div class="fd-text">' + act.text + '</div>' +
        '<div class="fd-time">' + escapeHtml(act.time) + '</div>' +
      '</div>' +
    '</div>';
  }

  container.innerHTML = html;
}

// 渲染本月提交量柱状图
function renderBarChart(schools, submissions) {
  var container = document.getElementById('bar-chart-container');
  if (!container) return;

  if (!Array.isArray(schools) || schools.length === 0) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#aaa;font-size:.84rem;width:100%">暂无数据</div>';
    return;
  }

  var barColors = ['var(--sky)', 'var(--yellow)', 'var(--lime)', 'var(--lavender)', 'var(--pink)'];

  // 统计本月各院校提交量
  var schoolSubCounts = {};
  var maxCount = 0;

  for (var i = 0; i < schools.length; i++) {
    schoolSubCounts[schools[i].id] = 0;
  }

  if (Array.isArray(submissions)) {
    for (var j = 0; j < submissions.length; j++) {
      var sub = submissions[j];
      if (sub.submitted_at && isThisMonth(sub.submitted_at)) {
        // 通过 assignment_id 找到对应 course，再找到 school_id
        // 简化处理：如果有 school_id 直接用，否则跳过
        if (sub.school_id && schoolSubCounts.hasOwnProperty(sub.school_id)) {
          schoolSubCounts[sub.school_id]++;
        }
      }
    }
  }

  // 如果所有院校提交都为0，尝试显示空状态
  var hasData = false;
  for (var sid in schoolSubCounts) {
    if (schoolSubCounts[sid] > 0) {
      hasData = true;
      break;
    }
  }

  if (!hasData) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#aaa;font-size:.84rem;width:100%">本月暂无提交数据</div>';
    return;
  }

  // 找最大值用于计算高度百分比
  for (var id in schoolSubCounts) {
    if (schoolSubCounts[id] > maxCount) maxCount = schoolSubCounts[id];
  }

  var html = '';
  for (var k = 0; k < schools.length; k++) {
    var school = schools[k];
    var count = schoolSubCounts[school.id] || 0;
    var heightPercent = maxCount > 0 ? Math.max(5, Math.round((count / maxCount) * 100)) : 5;
    var color = barColors[k % barColors.length];
    var label = school.name.length > 4 ? school.name.substring(0, 4) : school.name;

    html += '<div class="bar" style="height:' + heightPercent + '%;background:' + color + '">' +
      '<span class="bar-val">' + count + '</span>' +
      '<span class="bar-label">' + escapeHtml(label) + '</span>' +
    '</div>';
  }

  container.innerHTML = html;
}

// 渲染用户角色分布饼图
function renderPieChart(stats) {
  var container = document.getElementById('pie-chart-container');
  if (!container) return;

  var teachers = stats.total_teachers || 0;
  var students = stats.total_students || 0;
  var total = teachers + students;

  if (total === 0) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#aaa;font-size:.84rem;width:100%">暂无数据</div>';
    return;
  }

  var teacherPercent = Math.round((teachers / total) * 100);
  var studentPercent = 100 - teacherPercent;

  var gradient = 'conic-gradient(var(--sky) 0 ' + teacherPercent + '%, var(--yellow) ' + teacherPercent + '% 100%)';

  var html = '<div class="pie-visual" style="background:' + gradient + '"></div>' +
    '<div class="pie-legend">' +
      '<div><span style="background:var(--sky)"></span> 教师 · ' + formatNumber(teachers) + '人 (' + teacherPercent + '%)</div>' +
      '<div><span style="background:var(--yellow)"></span> 学生 · ' + formatNumber(students) + '人 (' + studentPercent + '%)</div>' +
    '</div>';

  container.innerHTML = html;
}
