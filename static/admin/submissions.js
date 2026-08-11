// Admin Submissions — 批改作业页面（双栏布局）

// ===== Helpers =====
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    var s = String(text);
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return s.replace(/[&<>"']/g, function(m) { return map[m]; });
}

function parseCST(dateStr) {
    if (!dateStr) return new Date(NaN);
    var s = String(dateStr);
    if (s.length > 10 && s.indexOf('Z') === -1 && s.indexOf('+') === -1) s += '+08:00';
    return new Date(s);
}

function formatRelativeTime(dateStr) {
    if (!dateStr) return '未知时间';
    var d = parseCST(dateStr);
    if (isNaN(d.getTime())) return '未知时间';
    var now = parseCST(new Date().toISOString());
    var diff = Math.floor((now - d) / 1000);
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
    if (diff < 604800) return Math.floor(diff / 86400) + '天前';
    var y = d.getFullYear(), m = ('0' + (d.getMonth() + 1)).slice(-2), day = ('0' + d.getDate()).slice(-2);
    return y + '-' + m + '-' + day;
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    var d = parseCST(dateStr);
    if (isNaN(d.getTime())) return '-';
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}

var avatarColors = ['var(--sky)', 'var(--lime)', 'var(--yellow)', 'var(--pink)', 'var(--lavender)'];
function avatarColor(name) {
    var hash = 0;
    for (var i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return avatarColors[Math.abs(hash) % avatarColors.length];
}

function avatarHtmlFor(submission, size) {
    var name = submission.student_name || submission.username || '学生';
    var firstChar = name.charAt(0);
    var color = avatarColor(name);
    var avatar = submission.avatar;
    if (avatar) {
        // Ensure path starts with /
        if (avatar.charAt(0) !== '/' && avatar.indexOf('http') !== 0) avatar = '/' + avatar;
        var safeUrl = escapeHtml(avatar);
        var safeChar = escapeHtml(firstChar);
        return '<div class="s-avatar" style="background:transparent;padding:0;overflow:hidden">'
            + '<img src="' + safeUrl + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"'
            + ' onerror="this.style.display=\'none\';this.parentNode.innerHTML=\'<span>' + safeChar + '</span>\'">'
            + '</div>';
    }
    return '<div class="s-avatar" style="background:' + color + '">' + escapeHtml(firstChar) + '</div>';
}

function fileExtIcon(fileName) {
    var ext = (fileName || '').split('.').pop().toLowerCase();
    var map = { pdf: 'file-text', doc: 'file-text', docx: 'file-text', txt: 'file-text', zip: 'archive', rar: 'archive', '7z': 'archive', png: 'image', jpg: 'image', jpeg: 'image', py: 'file-code', java: 'file-code', cpp: 'file-code', c: 'file-code', js: 'file-code', html: 'file-code', css: 'file-code', xlsx: 'table', xls: 'table', pptx: 'presentation', ppt: 'presentation' };
    return map[ext] || 'file';
}

// ===== Data =====
var allSchools = [], allCourses = [], allAssignments = [], allSubmissions = [];
var schoolMap = {}, courseMap = {}, assignCourseMap = {};
var currentFilter = 'all'; // all / pending / graded
var currentSearch = '';
var currentSubIndex = -1;
var filteredList = [];

// ===== Data Loading =====
function loadAllData() {
    Promise.all([
        API.get('/submissions/').catch(function() { return []; }),
        API.get('/assignments/').catch(function() { return []; }),
        API.get('/courses/').catch(function() { return []; }),
        API.get('/schools/').catch(function() { return []; })
    ]).then(function(results) {
        allSubmissions = results[0] || [];
        allAssignments = results[1] || [];
        allCourses = results[2] || [];
        allSchools = results[3] || [];

        // Build maps
        allSchools.forEach(function(s) { schoolMap[s.id] = s.name || ('院校 ' + s.id); });
        allCourses.forEach(function(c) { courseMap[c.id] = { name: c.name, school_id: c.school_id }; });
        allAssignments.forEach(function(a) { assignCourseMap[a.id] = a.course_id; });

        populateSchoolFilter();
        applyFilters();
        maybePoll();
    });
}

// ===== Cascading Filters =====
function populateSchoolFilter() {
    var el = document.getElementById('schoolFilter');
    var html = '<option value="all">全部院校</option>';
    allSchools.forEach(function(s) {
        html += '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>';
    });
    el.innerHTML = html;
}

function populateCourseFilter(schoolId) {
    var el = document.getElementById('courseFilter');
    var html = '<option value="all">全部课程</option>';
    var courses = allCourses.filter(function(c) {
        if (schoolId && schoolId !== 'all') return String(c.school_id) === String(schoolId);
        return true;
    });
    courses.forEach(function(c) {
        html += '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
    });
    el.innerHTML = html;
}

function populateAssignFilter(courseId) {
    var el = document.getElementById('assignFilter');
    var html = '<option value="all">全部作业</option>';
    var assigns = allAssignments.filter(function(a) {
        if (courseId && courseId !== 'all') return String(a.course_id) === String(courseId);
        return true;
    });
    assigns.forEach(function(a) {
        html += '<option value="' + a.id + '">' + escapeHtml(a.title) + '</option>';
    });
    el.innerHTML = html;
}

function onSchoolChange() {
    var schoolId = document.getElementById('schoolFilter').value;
    populateCourseFilter(schoolId);
    populateAssignFilter('all');
    document.getElementById('courseFilter').value = 'all';
    document.getElementById('assignFilter').value = 'all';
    applyFilters();
}

function onCourseChange() {
    var courseId = document.getElementById('courseFilter').value;
    populateAssignFilter(courseId);
    document.getElementById('assignFilter').value = 'all';
    applyFilters();
}

function onAssignChange() {
    applyFilters();
}

// ===== Filtering & Rendering =====
function applyFilters(keepPanel) {
    var schoolId = document.getElementById('schoolFilter').value;
    var courseId = document.getElementById('courseFilter').value;
    var assignId = document.getElementById('assignFilter').value;

    // Build filtered list
    filteredList = allSubmissions.filter(function(s) {
        if (assignId && assignId !== 'all' && String(s.assignment_id) !== assignId) return false;
        if (courseId && courseId !== 'all') {
            var aCourseId = assignCourseMap[s.assignment_id];
            if (String(aCourseId) !== courseId) return false;
        }
        if (schoolId && schoolId !== 'all') {
            var aCourseId2 = assignCourseMap[s.assignment_id];
            var course = courseMap[aCourseId2];
            if (!course || String(course.school_id) !== schoolId) return false;
        }
        return true;
    });

    updateStats();
    renderStudentList();
    if (keepPanel) return;
    // Reset grade panel
    currentSubIndex = -1;
    document.getElementById('gradeEmpty').style.display = '';
    document.getElementById('gradePanel').style.display = 'none';
}

function updateStats() {
    var total = filteredList.length;
    var graded = filteredList.filter(function(s) { return s.grade !== null && s.grade !== undefined; }).length;
    var pending = total - graded;

    document.getElementById('stat-pending').textContent = pending;
    document.getElementById('stat-graded').textContent = graded;
    document.getElementById('stat-total').textContent = total;
    document.getElementById('progress-graded').textContent = graded;
    document.getElementById('progress-total').textContent = total;
}

function getVisibleList() {
    var list = filteredList.filter(function(s) {
        var isGraded = s.grade !== null && s.grade !== undefined;
        if (currentFilter === 'pending' && isGraded) return false;
        if (currentFilter === 'graded' && !isGraded) return false;
        if (currentSearch) {
            var name = (s.student_name || s.username || '').toLowerCase();
            if (name.indexOf(currentSearch.toLowerCase()) === -1) return false;
        }
        return true;
    });
    return list;
}

function renderStudentList() {
    var container = document.getElementById('studentItems');
    var list = getVisibleList();

    if (list.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:30px;color:#999;font-size:0.82rem">暂无提交数据</div>';
        return;
    }

    var html = '';
    list.forEach(function(s, i) {
        var isGraded = s.grade !== null && s.grade !== undefined;
        var name = s.student_name || s.username || ('学生 ' + s.student_id);
        var firstChar = name.charAt(0);
        var color = avatarColor(name);
        var aCourseId = assignCourseMap[s.assignment_id];
        var course = courseMap[aCourseId];
        var schoolName = course ? (schoolMap[course.school_id] || '') : '';
        var ext = (s.file_name || '').split('.').pop().toUpperCase();

        var statusBg = isGraded ? 'var(--lime)' : 'var(--yellow)';
        var statusText = isGraded ? '已批' : '待批';
        if (s.status === 'queued') { statusBg = '#ddd'; statusText = '排队中'; }
        else if (s.status === 'grading') { statusBg = 'var(--sky)'; statusText = 'AI 批改中'; }

        // Find index in filteredList for navigation
        var realIndex = filteredList.indexOf(s);
        var isActive = realIndex === currentSubIndex ? ' active' : '';

        html += '<div class="s-item' + isActive + '" data-idx="' + realIndex + '" onclick="selectStudent(' + realIndex + ')">'
            + avatarHtmlFor(s)
            + '<div class="s-info">'
            + '<div class="s-name">' + escapeHtml(name) + '</div>'
            + '<div class="s-meta">';
        if (schoolName) html += '<span class="s-school">' + escapeHtml(schoolName) + '</span>';
        html += escapeHtml(formatRelativeTime(s.submitted_at)) + ' · ' + escapeHtml(ext);
        html += '</div></div>'
            + '<div class="s-right">';
        if (isGraded) html += '<span class="s-score">' + s.grade + '</span>';
        html += '<span class="s-status" style="background:' + statusBg + '">' + statusText + '</span>';
        if (!isGraded && s.ai_suggested_grade !== null && s.ai_suggested_grade !== undefined) html += '<span class="s-status" style="background:var(--lavender)">AI ' + s.ai_suggested_grade + '</span>';
        if (isGraded && (s.graded_by === null || s.graded_by === undefined)) html += '<span class="s-status" style="background:var(--lavender)">AI</span>';
        html += '</div></div>';
    });

    container.innerHTML = html;
}

// ===== Student Selection & Grade Panel =====
function selectStudent(idx) {
    currentSubIndex = idx;
    var s = filteredList[idx];
    if (!s) return;

    // Highlight in list
    var items = document.querySelectorAll('.s-item');
    items.forEach(function(el) { el.classList.remove('active'); });
    var target = document.querySelector('.s-item[data-idx="' + idx + '"]');
    if (target) target.classList.add('active');

    // Show panel
    document.getElementById('gradeEmpty').style.display = 'none';
    document.getElementById('gradePanel').style.display = '';

    var name = s.student_name || s.username || ('学生 ' + s.student_id);
    var firstChar = name.charAt(0);
    var color = avatarColor(name);
    var aCourseId = assignCourseMap[s.assignment_id];
    var course = courseMap[aCourseId];
    var schoolName = course ? (schoolMap[course.school_id] || '') : '';
    var courseName = course ? course.name : '';

    // Avatar
    var avatarEl = document.getElementById('gradeAvatar');
    if (s.avatar) {
        var avatarUrl = s.avatar;
        if (avatarUrl.charAt(0) !== '/' && avatarUrl.indexOf('http') !== 0) avatarUrl = '/' + avatarUrl;
        avatarEl.style.background = 'transparent';
        avatarEl.style.padding = '0';
        avatarEl.style.overflow = 'hidden';
        avatarEl.innerHTML = '<img src="' + escapeHtml(avatarUrl) + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block" onerror="this.parentNode.style.background=\'' + color + '\';this.parentNode.innerHTML=\'' + escapeHtml(firstChar) + '\'">';
    } else {
        avatarEl.style.background = color;
        avatarEl.style.padding = '';
        avatarEl.textContent = firstChar;
    }

    // Name & meta
    document.getElementById('gradeName').textContent = name;
    var metaHtml = '';
    if (schoolName) metaHtml += '<span class="tag-sm" style="background:var(--sky)">' + escapeHtml(schoolName) + '</span>';
    if (courseName) metaHtml += '<span class="tag-sm" style="background:var(--yellow)">' + escapeHtml(courseName) + '</span>';
    metaHtml += '<span style="color:#bbb">提交于 ' + escapeHtml(formatRelativeTime(s.submitted_at)) + ' · ' + escapeHtml(s.file_name || '') + '</span>';
    document.getElementById('gradeMeta').innerHTML = metaHtml;

    // File preview
    var ext = (s.file_name || '').split('.').pop().toLowerCase();
    var iconName = fileExtIcon(s.file_name);
    document.querySelector('#filePreview .file-icon').innerHTML = '<i data-lucide="' + iconName + '"></i>';
    document.getElementById('fileName').textContent = s.file_name || '未知文件';
    document.getElementById('fileMeta').textContent = '提交于 ' + formatDateTime(s.submitted_at);

    // Click file preview: PDF/图片/文本 → 新标签页在线预览；其余 → 鉴权下载
    var fp = document.getElementById('filePreview');
    if (fp) {
        if (s.id) {
            fp.style.cursor = 'pointer';
            fp.onclick = function() {
                API.openSubmission(s.id, s.file_name || '').catch(function(err) {
                    alert('打开失败: ' + (err.message || '未知错误'));
                });
            };
        } else {
            fp.style.cursor = 'default';
            fp.onclick = null;
        }
    }

    // Score & feedback：已批用正式分；未批但有 AI 建议分时预填作参考
    var hasGrade = s.grade !== null && s.grade !== undefined;
    var hasAi = s.ai_suggested_grade !== null && s.ai_suggested_grade !== undefined;
    document.getElementById('scoreInput').value = hasGrade ? s.grade : (hasAi ? s.ai_suggested_grade : '');
    document.getElementById('commentInput').value = s.feedback || '';
    var hint = document.getElementById('aiSuggestHint');
    if (hint) {
      if (!hasGrade && hasAi) {
        hint.style.display = '';
        hint.textContent = 'AI 建议 ' + s.ai_suggested_grade + ' 分（仅参考，可修改；提交批改后才生效）';
      } else {
        hint.style.display = 'none';
        hint.textContent = '';
      }
    }

    // Re-render lucide icons in grade panel
    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    panelDirty = false;
}

function navigateStudent(dir) {
    var visibleList = getVisibleList();
    if (visibleList.length === 0) return;

    // Find current position in visible list
    var currentVisibleIdx = -1;
    for (var i = 0; i < visibleList.length; i++) {
        if (filteredList.indexOf(visibleList[i]) === currentSubIndex) {
            currentVisibleIdx = i;
            break;
        }
    }

    var nextVisibleIdx = currentVisibleIdx + dir;
    if (nextVisibleIdx < 0) nextVisibleIdx = visibleList.length - 1;
    if (nextVisibleIdx >= visibleList.length) nextVisibleIdx = 0;

    var nextSub = visibleList[nextVisibleIdx];
    var realIdx = filteredList.indexOf(nextSub);
    selectStudent(realIdx);

    // Scroll into view
    var target = document.querySelector('.s-item[data-idx="' + realIdx + '"]');
    if (target) target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ===== Quick Actions =====
function setScore(val) {
    document.getElementById('scoreInput').value = val;
    panelDirty = true;
}

function addComment(text) {
    var el = document.getElementById('commentInput');
    if (el.value && el.value.trim()) {
        el.value = el.value.trim() + '\n' + text;
    } else {
        el.value = text;
    }
    panelDirty = true;
}

function submitGrade() {
    if (currentSubIndex < 0) return;
    var s = filteredList[currentSubIndex];
    if (!s) return;

    var score = parseInt(document.getElementById('scoreInput').value);
    var feedback = document.getElementById('commentInput').value;

    if (isNaN(score) || score < 0 || score > 100) {
        alert('请输入 0-100 之间的整数成绩');
        return;
    }

    var btn = document.getElementById('submitGradeBtn');
    btn.disabled = true;
    btn.textContent = '提交中…';

    API.put('/submissions/' + s.id + '/grade', { grade: score, feedback: feedback })
        .then(function() {
            // Update local data
            s.grade = score;
            s.feedback = feedback;
            s.status = 'graded';
            s.graded_at = new Date().toISOString();

            // Re-render
            updateStats();
            renderStudentList();
            selectStudent(currentSubIndex);

            btn.disabled = false;
            btn.textContent = '提交批改 →';
        })
        .catch(function(err) {
            alert('提交失败：' + (err.message || '未知错误'));
            btn.disabled = false;
            btn.textContent = '提交批改 →';
        });
}

function skipStudent() {
    // Find next pending student
    var visibleList = getVisibleList();
    var currentVisibleIdx = -1;
    for (var i = 0; i < visibleList.length; i++) {
        if (filteredList.indexOf(visibleList[i]) === currentSubIndex) {
            currentVisibleIdx = i;
            break;
        }
    }

    // Look for next pending after current
    for (var j = 1; j <= visibleList.length; j++) {
        var nextIdx = (currentVisibleIdx + j) % visibleList.length;
        var nextSub = visibleList[nextIdx];
        if (nextSub.grade === null || nextSub.grade === undefined) {
            var realIdx = filteredList.indexOf(nextSub);
            selectStudent(realIdx);
            var target = document.querySelector('.s-item[data-idx="' + realIdx + '"]');
            if (target) target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            return;
        }
    }

    // No pending found, just go to next
    navigateStudent(1);
}

// ===== Filter Tabs =====
function filterStudents(btn, filter) {
    currentFilter = filter;
    document.querySelectorAll('.filter-tab').forEach(function(el) { el.classList.remove('active'); });
    btn.classList.add('active');
    renderStudentList();
}

// ===== AI 批改队列 =====
var panelDirty = false; // 教师正在编辑评语/分数时，轮询不覆盖面板

function toast(msg, type) {
    var existing = document.querySelector('.toast-msg');
    if (existing) existing.parentNode.removeChild(existing);
    var t = document.createElement('div');
    t.className = 'toast-msg';
    t.textContent = msg;
    t.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);' +
        'padding:10px 24px;border-radius:8px;font-size:.85rem;z-index:9999;' +
        'box-shadow:0 4px 12px rgba(0,0,0,.15);transition:opacity .3s;' +
        (type === 'error' ? 'background:#e07a5f;color:#fff;' : 'background:#3fb950;color:#fff;');
    document.body.appendChild(t);
    setTimeout(function () {
        t.style.opacity = '0';
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, 3000);
}

function aiEnqueue() {
    if (currentSubIndex < 0) { toast('请先选择一份提交', 'error'); return; }
    var s = filteredList[currentSubIndex];
    if (!s) return;
    API.post('/ai-grading/' + s.id + '/enqueue').then(function () {
        toast('已加入 AI 批改队列', 'success');
        silentReload();
    }).catch(function (err) {
        toast('入队失败: ' + (err.message || '未知错误'), 'error');
    });
}

function aiEnqueueAll() {
    API.post('/ai-grading/enqueue-pending').then(function (r) {
        toast(r.message || '已入队', 'success');
        silentReload();
    }).catch(function (err) {
        toast('入队失败: ' + (err.message || '未知错误'), 'error');
    });
}

var pollTimer = null;
function hasActiveAi() {
    return allSubmissions.some(function (s) { return s.status === 'queued' || s.status === 'grading'; });
}
function maybePoll() {
    if (hasActiveAi() && !pollTimer) {
        pollTimer = setInterval(silentReload, 5000);
    } else if (!hasActiveAi() && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}
function silentReload() {
    API.get('/submissions/').then(function (data) {
        var prev = currentSubIndex >= 0 ? filteredList[currentSubIndex] : null;
        var prevSnap = prev ? { status: prev.status, grade: prev.grade, feedback: prev.feedback } : null;
        allSubmissions = data || [];
        applyFilters(true);
        // 数据有变化且教师未正在编辑时，自动刷新批改面板（AI 批完立即显示）
        var cur = currentSubIndex >= 0 ? filteredList[currentSubIndex] : null;
        if (cur && prevSnap && !panelDirty) {
            if (prevSnap.status !== cur.status || prevSnap.grade !== cur.grade || prevSnap.feedback !== cur.feedback) {
                selectStudent(currentSubIndex);
            }
        }
        maybePoll();
    }).catch(function () {});
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', function() {
    if (!Auth.requireRole('admin')) return;

    // Cascading filter events
    document.getElementById('schoolFilter').addEventListener('change', onSchoolChange);
    document.getElementById('courseFilter').addEventListener('change', onCourseChange);
    document.getElementById('assignFilter').addEventListener('change', onAssignChange);

    // Search
    document.getElementById('studentSearch').addEventListener('input', function(e) {
        currentSearch = e.target.value;
        renderStudentList();
    });

    // 教师编辑分数/评语时标记 dirty，轮询不覆盖
    document.getElementById('scoreInput').addEventListener('input', function() { panelDirty = true; });
    document.getElementById('commentInput').addEventListener('input', function() { panelDirty = true; });

    // Ctrl+Enter shortcut
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            submitGrade();
        }
    });

    // Init course/assign filters
    populateCourseFilter('all');
    populateAssignFilter('all');

    loadAllData();
});
