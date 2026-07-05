// Admin Class Management — 班级管理页面

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
var allClasses = [], allCourses = [], allSchools = [], allStudents = [];
var schoolMap = {}, courseMap = {};

// ===== Modal Helpers =====
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function showError(elId, msg) { var el = document.getElementById(elId); if (el) { el.textContent = msg; el.style.display = 'block'; } }
function hideError(elId) { var el = document.getElementById(elId); if (el) { el.style.display = 'none'; el.textContent = ''; } }

document.addEventListener('click', function(e) {
    if (e.target.classList.contains('overlay')) e.target.classList.remove('open');
});

// ===== Data Loading =====
function loadAllData() {
    Promise.all([
        API.get('/classes/').catch(function() { return []; }),
        API.get('/courses/').catch(function() { return []; }),
        API.get('/schools/').catch(function() { return []; }),
        API.get('/admin/users').catch(function() { return []; })
    ]).then(function(results) {
        allClasses = results[0] || [];
        allCourses = results[1] || [];
        allSchools = results[2] || [];
        var allUsers = results[3] || [];

        allStudents = allUsers.filter(function(u) { return u.role === 'student'; });
        allSchools.forEach(function(s) { schoolMap[s.id] = s.name || ('院校 ' + s.id); });
        allCourses.forEach(function(c) { courseMap[c.id] = c.name || ('课程 ' + c.id); });

        populateFilters();
        renderClasses();
    });
}

function populateFilters() {
    var schoolHtml = '<option value="">全部院校</option>';
    allSchools.forEach(function(s) { schoolHtml += '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>'; });
    var el = document.getElementById('cl-filter-school');
    if (el) el.innerHTML = schoolHtml;

    var courseHtml = '<option value="">全部课程</option>';
    allCourses.forEach(function(c) { courseHtml += '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>'; });
    var el2 = document.getElementById('cl-filter-course');
    if (el2) el2.innerHTML = courseHtml;
}

// ===== Classes =====
function renderClasses() {
    var tbody = document.getElementById('classes-tbody');
    var schoolFilter = (document.getElementById('cl-filter-school') || {}).value || '';
    var courseFilter = (document.getElementById('cl-filter-course') || {}).value || '';
    var filtered = allClasses.filter(function(cl) {
        if (schoolFilter && String(cl.school_id) !== schoolFilter) return false;
        if (courseFilter && String(cl.course_id) !== courseFilter) return false;
        return true;
    });
    if (filtered.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">暂无班级</td></tr>'; return; }
    var html = '';
    filtered.forEach(function(cl) {
        html += '<tr>'
            + '<td><strong>' + escapeHtml(cl.name) + '</strong></td>'
            + '<td>' + escapeHtml(courseMap[cl.course_id] || '-') + '</td>'
            + '<td>' + escapeHtml(schoolMap[cl.school_id] || '-') + '</td>'
            + '<td>' + (cl.student_count || 0) + '</td>'
            + '<td>' + formatDate(cl.created_at) + '</td>'
            + '<td><button class="btn btn-secondary" onclick="openStudentsModal(' + cl.id + ')">学生</button> '
            + '<button class="btn btn-secondary" onclick="deleteClass(' + cl.id + ')" style="color:#e74c3c">删除</button></td>'
            + '</tr>';
    });
    tbody.innerHTML = html;
}

function openClassModal() {
    hideError('clm-error');
    var schoolHtml = '<option value="">请选择学校</option>';
    allSchools.forEach(function(s) { schoolHtml += '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>'; });
    document.getElementById('clm-school').innerHTML = schoolHtml;
    var courseHtml = '<option value="">不关联课程</option>';
    allCourses.forEach(function(c) { courseHtml += '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>'; });
    document.getElementById('clm-course').innerHTML = courseHtml;
    document.getElementById('clm-name').value = '';
    document.getElementById('class-modal-title').textContent = '添加班级';
    openModal('class-overlay');
}

function saveClass() {
    var name = document.getElementById('clm-name').value.trim();
    var schoolId = document.getElementById('clm-school').value;
    hideError('clm-error');
    if (!name) { showError('clm-error', '请输入班级名称'); return; }
    if (!schoolId) { showError('clm-error', '请选择所属学校'); return; }
    var payload = { name: name, school_id: parseInt(schoolId) };
    API.post('/classes/', payload).then(function(cls) {
        var courseId = document.getElementById('clm-course').value;
        if (courseId && cls && cls.id) {
            return API.put('/classes/' + cls.id, { name: name }).then(function() { return cls; });
        }
        return cls;
    }).then(function() {
        closeModal('class-overlay');
        loadAllData();
    }).catch(function(err) { showError('clm-error', err.message || '操作失败'); });
}

function deleteClass(id) {
    if (!confirm('确定删除该班级？此操作不可撤销。')) return;
    API.delete('/classes/' + id).then(function() {
        loadAllData();
    }).catch(function(err) { alert(err.message || '删除失败'); });
}

// ===== Students Management =====
var currentClassId = null;
function openStudentsModal(classId) {
    currentClassId = classId;
    var cls = allClasses.find(function(c) { return c.id === classId; });
    document.getElementById('students-modal-title').textContent = (cls ? cls.name : '班级') + ' — 学生管理';
    API.get('/classes/' + classId + '/students').then(function(students) {
        var html = '';
        if (!students || students.length === 0) {
            html = '<div class="empty-msg">暂无学生</div>';
        } else {
            html = '<table class="data-table"><thead><tr><th>姓名</th><th>用户名</th><th>操作</th></tr></thead><tbody>';
            students.forEach(function(s) {
                html += '<tr><td>' + escapeHtml(s.full_name || s.username) + '</td><td>' + escapeHtml(s.username) + '</td>'
                    + '<td><button class="btn btn-secondary" onclick="removeStudentFromClass(' + s.id + ')" style="color:#e74c3c;font-size:.78rem">移除</button></td></tr>';
            });
            html += '</tbody></table>';
        }
        document.getElementById('students-list').innerHTML = html;
    }).catch(function(err) {
        document.getElementById('students-list').innerHTML = '<div class="empty-msg">加载失败</div>';
    });
    var selectHtml = '<option value="">选择学生添加...</option>';
    allStudents.forEach(function(s) {
        selectHtml += '<option value="' + s.id + '">' + escapeHtml(s.full_name || s.username) + ' (' + escapeHtml(s.username) + ')</option>';
    });
    document.getElementById('stu-add-select').innerHTML = selectHtml;
    openModal('students-overlay');
}

function addStudentToClass() {
    var sel = document.getElementById('stu-add-select');
    var studentId = sel.value;
    if (!studentId || !currentClassId) return;
    API.post('/classes/' + currentClassId + '/students', { student_id: parseInt(studentId) }).then(function() {
        openStudentsModal(currentClassId);
        loadAllData();
    }).catch(function(err) { alert(err.message || '添加失败'); });
}

function removeStudentFromClass(studentId) {
    if (!currentClassId || !confirm('确定从该班级移除该学生？')) return;
    alert('暂不支持直接移除学生，请在院校管理页面操作。');
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', function() {
    if (!Auth.requireRole('admin')) return;

    ['cl-filter-school', 'cl-filter-course'].forEach(function(id) {
        var el = document.getElementById(id); if (el) el.addEventListener('change', renderClasses);
    });

    loadAllData();
});
