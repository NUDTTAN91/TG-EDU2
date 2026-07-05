// Admin Course Management — 课程管理页面

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    var str = String(text);
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return str.replace(/[&<>"']/g, function(m) { return map[m]; });
}

function parseCST(dateStr) {
    if (!dateStr) return new Date(NaN);
    var s = String(dateStr);
    if (s.length > 10 && s.indexOf('Z') === -1 && s.indexOf('+') === -1) s += '+08:00';
    return new Date(s);
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    var d = parseCST(dateStr);
    if (isNaN(d.getTime())) return '-';
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

// ===== Data =====
var allCourses = [], allClasses = [], allAssignments = [];
var allUsers = [], allSchools = [];
var teacherMap = {}, schoolMap = {};

// ===== Modal Helpers =====
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function showError(elId, msg) { var el = document.getElementById(elId); if (el) { el.textContent = msg; el.style.display = 'block'; } }
function hideError(elId) { var el = document.getElementById(elId); if (el) { el.style.display = 'none'; el.textContent = ''; } }

// Close modal on overlay click
document.addEventListener('click', function(e) {
    if (e.target.classList.contains('overlay')) e.target.classList.remove('open');
});

// ===== Data Loading =====
function loadAllData() {
    Promise.all([
        API.get('/courses/').catch(function() { return []; }),
        API.get('/classes/').catch(function() { return []; }),
        API.get('/assignments/').catch(function() { return []; }),
        API.get('/admin/users').catch(function() { return []; }),
        API.get('/schools/').catch(function() { return []; })
    ]).then(function(results) {
        allCourses = results[0] || [];
        allClasses = results[1] || [];
        allAssignments = results[2] || [];
        allUsers = results[3] || [];
        allSchools = results[4] || [];

        // Build maps
        allUsers.forEach(function(u) {
            if (u.role === 'teacher') teacherMap[u.id] = u.full_name || u.username || ('教师 ' + u.id);
        });
        allSchools.forEach(function(s) { schoolMap[s.id] = s.name || ('院校 ' + s.id); });

        populateFilters();
        renderCourses();
    });
}

function populateFilters() {
    var schoolHtml = '<option value="">全部院校</option>';
    allSchools.forEach(function(s) { schoolHtml += '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>'; });
    var el = document.getElementById('c-filter-school');
    if (el) el.innerHTML = schoolHtml;
}

// ===== Courses =====
function renderCourses() {
    var tbody = document.getElementById('courses-tbody');
    var schoolFilter = (document.getElementById('c-filter-school') || {}).value || '';
    var filtered = allCourses.filter(function(c) {
        if (schoolFilter && String(c.school_id) !== schoolFilter) return false;
        return true;
    });
    if (filtered.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">暂无课程数据</td></tr>'; return; }
    var html = '';
    filtered.forEach(function(c) {
        var classCount = allClasses.filter(function(cl) { return cl.course_id === c.id; }).length;
        var assignCount = allAssignments.filter(function(a) { return a.course_id === c.id; }).length;
        html += '<tr>'
            + '<td><strong>' + escapeHtml(c.name) + '</strong></td>'
            + '<td>' + escapeHtml(teacherMap[c.teacher_id] || '-') + '</td>'
            + '<td>' + escapeHtml(schoolMap[c.school_id] || '-') + '</td>'
            + '<td>' + classCount + '</td>'
            + '<td>' + assignCount + '</td>'
            + '<td>' + formatDate(c.created_at) + '</td>'
            + '<td><button class="btn btn-secondary" onclick="openCourseModal(' + c.id + ')">编辑</button> '
            + '<button class="btn btn-secondary" onclick="deleteCourse(' + c.id + ')" style="color:#e74c3c">删除</button></td>'
            + '</tr>';
    });
    tbody.innerHTML = html;
}

var editingCourseId = null;
function openCourseModal(courseId) {
    editingCourseId = courseId || null;
    hideError('cm-error');
    var schoolHtml = '<option value="">请选择学校</option>';
    allSchools.forEach(function(s) { schoolHtml += '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>'; });
    document.getElementById('cm-school').innerHTML = schoolHtml;
    var teacherHtml = '<option value="">请选择教师</option>';
    allUsers.filter(function(u) { return u.role === 'teacher'; }).forEach(function(u) {
        teacherHtml += '<option value="' + u.id + '">' + escapeHtml(u.full_name || u.username) + '</option>';
    });
    document.getElementById('cm-teacher').innerHTML = teacherHtml;
    if (courseId) {
        var c = allCourses.find(function(x) { return x.id === courseId; });
        if (c) {
            document.getElementById('course-modal-title').textContent = '编辑课程';
            document.getElementById('cm-name').value = c.name || '';
            document.getElementById('cm-school').value = c.school_id || '';
            document.getElementById('cm-teacher').value = c.teacher_id || '';
        }
    } else {
        document.getElementById('course-modal-title').textContent = '添加课程';
        document.getElementById('cm-name').value = '';
    }
    openModal('course-overlay');
}

function saveCourse() {
    var name = document.getElementById('cm-name').value.trim();
    var schoolId = document.getElementById('cm-school').value;
    var teacherId = document.getElementById('cm-teacher').value;
    hideError('cm-error');
    if (!name) { showError('cm-error', '请输入课程名称'); return; }
    if (!schoolId) { showError('cm-error', '请选择所属学校'); return; }
    var payload = { name: name, school_id: parseInt(schoolId) };
    if (teacherId) payload.teacher_id = parseInt(teacherId);
    var request = editingCourseId ? API.put('/courses/' + editingCourseId, payload) : API.post('/courses/', payload);
    request.then(function() {
        closeModal('course-overlay');
        loadAllData();
    }).catch(function(err) { showError('cm-error', err.message || '操作失败'); });
}

function deleteCourse(id) {
    if (!confirm('确定删除该课程？此操作不可撤销。')) return;
    API.delete('/courses/' + id).then(function() {
        loadAllData();
    }).catch(function(err) { alert(err.message || '删除失败'); });
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', function() {
    if (!Auth.requireRole('admin')) return;

    // Bind filter events
    var filterEl = document.getElementById('c-filter-school');
    if (filterEl) filterEl.addEventListener('change', renderCourses);

    // Load all data
    loadAllData();
});
