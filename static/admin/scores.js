// Admin Scores — 成绩管理页面

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

function formatDate(dateStr) {
    if (!dateStr) return '-';
    var d = parseCST(dateStr);
    if (isNaN(d.getTime())) return '-';
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

// ===== Data =====
var allSchools = [], allCourses = [], allClasses = [], allAssignments = [], allSubmissions = [];
var schoolMap = {}, courseMap = {}, assignMap = {};
var filteredAssignments = [];
var filteredStudents = {};
var matrixData = {};

// ===== Data Loading =====
function loadAllData() {
    Promise.all([
        API.get('/submissions/').catch(function() { return []; }),
        API.get('/assignments/').catch(function() { return []; }),
        API.get('/courses/').catch(function() { return []; }),
        API.get('/schools/').catch(function() { return []; }),
        API.get('/classes/').catch(function() { return []; })
    ]).then(function(results) {
        allSubmissions = Array.isArray(results[0]) ? results[0] : (results[0].items || []);
        allAssignments = Array.isArray(results[1]) ? results[1] : (results[1].items || []);
        allCourses = Array.isArray(results[2]) ? results[2] : (results[2].items || []);
        allSchools = Array.isArray(results[3]) ? results[3] : (results[3].items || []);
        allClasses = Array.isArray(results[4]) ? results[4] : (results[4].items || []);

        // Build maps
        allSchools.forEach(function(s) { schoolMap[s.id] = s.name || ('院校 ' + s.id); });
        allCourses.forEach(function(c) { courseMap[c.id] = c; });
        allAssignments.forEach(function(a) { assignMap[a.id] = a; });

        populateSchoolFilter();
        populateCourseFilter();
        populateClassFilter();
        applyFilters();
    });
}

// ===== Cascading Filters =====
function populateSchoolFilter() {
    var el = document.getElementById('schoolSel');
    var html = '<option value="">请选择院校</option>';
    allSchools.forEach(function(s) {
        html += '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>';
    });
    el.innerHTML = html;
}

function populateCourseFilter() {
    var el = document.getElementById('courseSel');
    var schoolId = document.getElementById('schoolSel').value;
    var html = '<option value="">全部课程</option>';
    var courses = allCourses.filter(function(c) {
        if (schoolId) return String(c.school_id) === String(schoolId);
        return true;
    });
    courses.forEach(function(c) {
        html += '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
    });
    el.innerHTML = html;
}

function populateClassFilter() {
    var el = document.getElementById('classSel');
    var schoolId = document.getElementById('schoolSel').value;
    var courseId = document.getElementById('courseSel').value;
    var html = '<option value="">请选择班级</option>';
    var classes = allClasses.filter(function(c) {
        if (schoolId && String(c.school_id) !== String(schoolId)) return false;
        // 多对多：班级关联集合包含该课程才列入
        if (courseId && (c.course_ids || []).map(String).indexOf(String(courseId)) === -1) return false;
        return true;
    });
    classes.forEach(function(c) {
        html += '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
    });
    el.innerHTML = html;
}

function onSchoolChange() {
    populateCourseFilter();
    populateClassFilter();
    document.getElementById('courseSel').value = '';
    document.getElementById('classSel').value = '';
    applyFilters();
}

function onCourseChange() {
    populateClassFilter();
    document.getElementById('classSel').value = '';
    applyFilters();
}

function onClassChange() {
    applyFilters();
}

// ===== Apply Filters =====
function applyFilters() {
    var schoolId = document.getElementById('schoolSel').value;
    var courseId = document.getElementById('courseSel').value;
    var classId = document.getElementById('classSel').value;

    // 必须先选院校 + 班级才展示成绩：
    // 默认「全部」会把不同院校/班级的课程与提交混进同一张矩阵
    if (!schoolId || !classId) {
        filteredAssignments = [];
        filteredStudents = {};
        matrixData = {};
        renderSummary();
        renderTableView();
        renderCardView();
        return;
    }

    // Get relevant course IDs（限定在所选院校内）
    var courseIds = [];
    if (courseId) {
        courseIds = [parseInt(courseId)];
    } else {
        allCourses.forEach(function(c) {
            if (String(c.school_id) === String(schoolId)) courseIds.push(c.id);
        });
    }

    // Filter assignments by course
    // 再按班级定向收窄：只保留定向到所选班级的作业；无定向（旧数据）视为课程全班可见
    var selectedClassId = parseInt(classId, 10);
    filteredAssignments = allAssignments.filter(function(a) {
        if (courseIds.indexOf(a.course_id) === -1) return false;
        var t = a.class_ids || [];
        if (t.length === 0) return true;
        return t.map(Number).indexOf(selectedClassId) !== -1;
    }).sort(function(a, b) {
        return parseCST(a.created_at) - parseCST(b.created_at);
    });

    var assignIds = filteredAssignments.map(function(a) { return a.id; });

    // 以所选班级花名册为学生基准：未提交的学生也占一行（显示缺交/—），
    // 且非本班学生的提交不会串进本矩阵
    API.get('/classes/' + classId + '/students').then(function(roster) {
        filteredStudents = {};
        (roster || []).forEach(function(s) {
            filteredStudents[s.id] = {
                id: s.id,
                name: s.full_name || s.username || ('学生 ' + s.id)
            };
        });

        // Build matrix: student_id -> assignment_id -> submission data
        matrixData = {};
        allSubmissions.forEach(function(s) {
            if (assignIds.indexOf(s.assignment_id) === -1) return;
            if (!filteredStudents[s.student_id]) return;
            if (!matrixData[s.student_id]) matrixData[s.student_id] = {};
            matrixData[s.student_id][s.assignment_id] = s;
        });

        renderSummary();
        renderTableView();
        renderCardView();
    }).catch(function() {
        filteredStudents = {};
        matrixData = {};
        renderSummary();
        renderTableView();
        renderCardView();
    });
}

// ===== Statistics =====
function renderSummary() {
    var allGrades = [];
    for (var sid in matrixData) {
        for (var aid in matrixData[sid]) {
            var sub = matrixData[sid][aid];
            if (sub.grade !== null && sub.grade !== undefined) {
                allGrades.push(sub.grade);
            }
        }
    }

    if (allGrades.length === 0) {
        document.getElementById('sumAvg').textContent = '—';
        document.getElementById('sumMax').textContent = '—';
        document.getElementById('sumMin').textContent = '—';
        document.getElementById('sumPass').textContent = '—';
        return;
    }

    var sum = 0;
    var max = -Infinity;
    var min = Infinity;
    var pass = 0;
    allGrades.forEach(function(g) {
        sum += g;
        if (g > max) max = g;
        if (g < min) min = g;
        if (g >= 60) pass++;
    });

    var avg = (sum / allGrades.length).toFixed(1);
    document.getElementById('sumAvg').textContent = avg;
    document.getElementById('sumMax').textContent = max;
    document.getElementById('sumMin').textContent = min;
    document.getElementById('sumPass').textContent = Math.round(pass / allGrades.length * 100) + '%';
}

// ===== Table View =====
function isLateSubmission(sub) {
    if (!sub) return false;
    var assign = assignMap[sub.assignment_id];
    if (!assign || !assign.deadline) return false;
    var deadline = parseCST(assign.deadline);
    var submitted = parseCST(sub.submitted_at);
    return submitted > deadline;
}

function renderTableView() {
    var table = document.getElementById('scoreTable');
    var thead = table.querySelector('thead tr');
    var tbody = table.querySelector('tbody');

    // Build header
    var headerHtml = '<th class="student-col">学生</th>';
    filteredAssignments.forEach(function(a) {
        var title = a.title || '';
        var shortTitle = title.length > 20 ? title.substring(0, 20) + '…' : title;
        var dateStr = formatDate(a.deadline || a.created_at);
        headerHtml += '<th class="wrap">'
            + '<div class="th-tooltip">' + escapeHtml(title) + '</div>'
            + '<div class="th-inner"><span class="th-num">' + escapeHtml(dateStr) + '</span>'
            + '<span class="th-title">' + escapeHtml(shortTitle) + '</span></div></th>';
    });
    headerHtml += '<th class="total-col">总分</th>';
    thead.innerHTML = headerHtml;

    // Build body
    var bodyHtml = '';
    var studentIds = Object.keys(filteredStudents);

    if (studentIds.length === 0 || filteredAssignments.length === 0) {
        var colspan = filteredAssignments.length + 2;
        var hint = (!document.getElementById('schoolSel').value || !document.getElementById('classSel').value)
            ? '请先选择院校和班级，再查看成绩'
            : '暂无成绩数据';
        bodyHtml = '<tr><td colspan="' + colspan + '" style="text-align:center;padding:40px;color:#999;font-size:0.85rem">' + hint + '</td></tr>';
    } else {
        // 默认按总分从高到低排：先预算每人总分，
        // 未有任何成绩的学生排最后，同分按姓名（中文）稳定排序
        var rows = studentIds.map(function(sid) {
            var total = 0;
            var hasGrade = false;
            filteredAssignments.forEach(function(a) {
                var sub = matrixData[sid] ? matrixData[sid][a.id] : null;
                if (sub && sub.grade !== null && sub.grade !== undefined) {
                    total += sub.grade;
                    hasGrade = true;
                }
            });
            return { sid: sid, total: total, hasGrade: hasGrade };
        });
        rows.sort(function(x, y) {
            if (x.hasGrade !== y.hasGrade) return x.hasGrade ? -1 : 1;
            if (x.total !== y.total) return y.total - x.total;
            return String(filteredStudents[x.sid].name)
                .localeCompare(String(filteredStudents[y.sid].name), 'zh-Hans-CN');
        });

        rows.forEach(function(row) {
            var sid = row.sid;
            var student = filteredStudents[sid];
            var total = row.total;
            var hasGrade = row.hasGrade;

            bodyHtml += '<tr><td class="student-cell">' + escapeHtml(student.name) + '</td>';

            filteredAssignments.forEach(function(a) {
                var sub = matrixData[sid] ? matrixData[sid][a.id] : null;
                if (sub && sub.grade !== null && sub.grade !== undefined) {
                    var grade = sub.grade;
                    var late = isLateSubmission(sub);
                    var cls = grade >= 80 ? 'high' : (grade >= 60 ? 'mid' : 'low');
                    if (late) {
                        bodyHtml += '<td><span class="score-cell late">' + grade + '</span></td>';
                    } else {
                        bodyHtml += '<td><span class="score-cell ' + cls + '">' + grade + '</span></td>';
                    }
                } else if (sub) {
                    // Submitted but not graded
                    bodyHtml += '<td><span class="score-cell none">—</span></td>';
                } else {
                    // Not submitted - check if deadline passed
                    var assign = assignMap[a.id];
                    var deadline = assign ? parseCST(assign.deadline) : null;
                    var now = parseCST(new Date().toISOString());
                    if (deadline && now > deadline) {
                        bodyHtml += '<td><span class="score-cell miss">缺交</span></td>';
                    } else {
                        bodyHtml += '<td><span class="score-cell none">—</span></td>';
                    }
                }
            });

            bodyHtml += '<td class="total-cell">' + (hasGrade ? total : '—') + '</td></tr>';
        });
    }

    tbody.innerHTML = bodyHtml;
}

// ===== Card View =====
function renderCardView() {
    var container = document.getElementById('assignCards');
    var html = '';

    if (filteredAssignments.length === 0) {
        html = '<div style="text-align:center;padding:40px;color:#999;font-size:0.85rem">暂无作业数据</div>';
        container.innerHTML = html;
        return;
    }

    filteredAssignments.forEach(function(a, index) {
        var grades = [];
        var gradedCount = 0;
        var totalStudents = Object.keys(filteredStudents).length;

        for (var sid in matrixData) {
            var sub = matrixData[sid][a.id];
            if (sub && sub.grade !== null && sub.grade !== undefined) {
                grades.push(sub.grade);
                gradedCount++;
            }
        }

        var avg = grades.length > 0 ? Math.round(grades.reduce(function(s, g) { return s + g; }, 0) / grades.length) : null;
        var maxG = grades.length > 0 ? Math.max.apply(null, grades) : null;
        var minG = grades.length > 0 ? Math.min.apply(null, grades) : null;

        // Determine type from title keywords
        var typeText = '作业';
        var typeStyle = 'background:var(--sky)';
        var title = a.title || '';
        if (title.indexOf('实验') !== -1) { typeText = '实验报告'; typeStyle = 'background:var(--lime)'; }
        else if (title.indexOf('习题') !== -1 || title.indexOf('课后') !== -1) { typeText = '课后作业'; typeStyle = 'background:var(--sky)'; }
        else if (title.indexOf('论文') !== -1) { typeText = '论文'; typeStyle = 'background:var(--yellow)'; }
        else if (title.indexOf('期末') !== -1 || title.indexOf('项目') !== -1) { typeText = '项目'; typeStyle = 'background:var(--lavender)'; }
        else if (title.indexOf('期中') !== -1) { typeText = '期中'; typeStyle = 'background:var(--yellow)'; }

        var notFullyGraded = gradedCount < totalStudents;
        var opacityStyle = (notFullyGraded && gradedCount > 0) ? ' style="opacity:0.5"' : '';
        var badgeText = notFullyGraded ? '批改中' : typeText;
        var badgeStyle = notFullyGraded ? ' style="background:var(--yellow)"' : ' style="' + typeStyle + '"';

        var barPercent = totalStudents > 0 ? Math.round(gradedCount / totalStudents * 100) : 0;
        var barColor = barPercent === 100 ? 'var(--lime)' : 'var(--yellow)';
        if (avg !== null && barPercent === 100) {
            barColor = avg >= 80 ? 'var(--lime)' : 'var(--sky)';
        }

        html += '<div class="assign-card"' + opacityStyle + '>'
            + '<div class="ac-head"><div>'
            + '<div class="ac-num">作业 ' + (index + 1) + '</div>'
            + '<div class="ac-title">' + escapeHtml(title) + '</div>'
            + '</div><span class="ac-type"' + badgeStyle + '>' + badgeText + '</span></div>'
            + '<div class="ac-stats">'
            + '<div class="ac-stat"><div class="ac-stat-val">' + (avg !== null ? avg : '—') + '</div><div class="ac-stat-label">平均分</div></div>'
            + '<div class="ac-stat"><div class="ac-stat-val">' + (maxG !== null ? maxG : '—') + '</div><div class="ac-stat-label">最高</div></div>'
            + '<div class="ac-stat"><div class="ac-stat-val">' + (minG !== null ? minG : '—') + '</div><div class="ac-stat-label">最低</div></div>'
            + '<div class="ac-stat"><div class="ac-stat-val">' + gradedCount + '/' + totalStudents + '</div><div class="ac-stat-label">已批</div></div>'
            + '</div>'
            + '<div class="ac-bar"><div class="ac-bar-fill" style="width:' + barPercent + '%;background:' + barColor + '"></div></div>'
            + '</div>';
    });

    container.innerHTML = html;
}

// ===== View Switch =====
function switchView(view, btn) {
    document.querySelectorAll('.view-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    if (view === 'table') {
        document.getElementById('tableView').style.display = '';
        document.getElementById('tableView').classList.add('active');
        document.getElementById('cardView').style.display = 'none';
        document.getElementById('cardView').classList.remove('active');
    } else {
        document.getElementById('tableView').style.display = 'none';
        document.getElementById('tableView').classList.remove('active');
        document.getElementById('cardView').style.display = '';
        document.getElementById('cardView').classList.add('active');
    }
}

// ===== Export Excel (placeholder) =====
function exportExcel() {
    alert('导出 Excel 功能暂未实现，后续版本将支持。');
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', function() {
    if (!Auth.requireRole('admin')) return;

    document.getElementById('schoolSel').addEventListener('change', onSchoolChange);
    document.getElementById('courseSel').addEventListener('change', onCourseChange);
    document.getElementById('classSel').addEventListener('change', onClassChange);

    loadAllData();
});
