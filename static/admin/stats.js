// Admin Stats — 数据统计页面（真实API数据）

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

document.addEventListener('DOMContentLoaded', function() {
    if (!Auth.requireRole('admin')) return;

    var barColors = ['var(--sky)', 'var(--yellow)', 'var(--lime)', 'var(--lavender)', 'var(--pink)', '#888'];

    function formatNumber(n) {
        if (n === null || n === undefined) return '0';
        return Number(n).toLocaleString();
    }

    // --- KPI Cards ---
    function renderKPI(stats) {
        var elSubmissions = document.getElementById('kpi-submissions');
        var elUsers = document.getElementById('kpi-users');
        var elClasses = document.getElementById('kpi-classes');
        var elRate = document.getElementById('kpi-rate');

        if (elSubmissions) elSubmissions.textContent = formatNumber(stats.total_submissions);
        if (elUsers) elUsers.textContent = formatNumber(stats.total_users);
        if (elClasses) elClasses.textContent = formatNumber(stats.total_courses);

        if (elRate) {
            var totalStudents = stats.total_students || 0;
            var totalAssignments = stats.total_assignments || 0;
            var totalSubmissions = stats.total_submissions || 0;
            if (totalStudents > 0 && totalAssignments > 0) {
                var rate = ((totalSubmissions / (totalStudents * totalAssignments)) * 100).toFixed(1);
                elRate.textContent = rate + '%';
            } else {
                elRate.textContent = 'N/A';
            }
        }
    }

    // --- Bar Chart: 各院校提交量 ---
    function renderBarChart(submissions, schools) {
        var container = document.getElementById('bar-chart-container');
        if (!container) return;

        if (!submissions || submissions.length === 0 || !schools || schools.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:30px;color:#999">暂无数据</div>';
            return;
        }

        // Map school_id -> name
        var schoolNameMap = {};
        schools.forEach(function(s) {
            schoolNameMap[s.id] = s.name || ('院校 ' + s.id);
        });

        // Need to map submission -> assignment -> course -> school
        // Since submissions don't have school_id directly, we need assignments and courses
        // But we only have submissions and schools here. Let's count by what we have.
        // Actually we need courses to map assignment->school. Let's do a simplified approach:
        // Count submissions per school via assignments->courses->school
        // We'll fetch assignments and courses as well (done in main loader)

        // For now, this will be called with pre-computed data
        // container is set by caller
    }

    function renderSchoolBarChart(schoolSubmissionCounts, schools) {
        var container = document.getElementById('bar-chart-container');
        if (!container) return;

        if (!schools || schools.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:30px;color:#999">暂无数据</div>';
            return;
        }

        var items = [];
        var maxVal = 0;
        schools.forEach(function(s) {
            var count = schoolSubmissionCounts[s.id] || 0;
            items.push({ name: s.name || ('院校 ' + s.id), count: count });
            if (count > maxVal) maxVal = count;
        });

        if (maxVal === 0) {
            container.innerHTML = '<div style="text-align:center;padding:30px;color:#999">暂无数据</div>';
            return;
        }

        var html = '';
        items.forEach(function(item, i) {
            var pct = maxVal > 0 ? Math.max(5, (item.count / maxVal) * 100) : 5;
            var color = barColors[i % barColors.length];
            html += '<div class="bar" style="height:' + pct + '%;background:' + color + '">'
                + '<span class="bar-val">' + item.count + '</span>'
                + '<span class="bar-label">' + escapeHtml(item.name) + '</span>'
                + '</div>';
        });
        container.innerHTML = html;
    }

    // --- Trend Chart: 提交趋势（按周） ---
    function renderTrendChart(submissions) {
        var container = document.getElementById('trend-chart-container');
        if (!container) return;

        if (!submissions || submissions.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:20px;color:#999">暂无数据</div>';
            return;
        }

        // Group by week
        var weekMap = {};
        submissions.forEach(function(s) {
            if (!s.submitted_at) return;
            var d = parseCST(s.submitted_at);
            if (isNaN(d.getTime())) return;
            // Get ISO week
            var oneJan = new Date(d.getFullYear(), 0, 1);
            var weekNum = Math.ceil(((d - oneJan) / 86400000 + oneJan.getDay() + 1) / 7);
            var key = d.getFullYear() + '-W' + weekNum;
            weekMap[key] = (weekMap[key] || 0) + 1;
        });

        var keys = Object.keys(weekMap).sort();
        // Take last 6 weeks
        var recentKeys = keys.slice(-6);

        if (recentKeys.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:20px;color:#999">暂无数据</div>';
            return;
        }

        var maxVal = 0;
        recentKeys.forEach(function(k) {
            if (weekMap[k] > maxVal) maxVal = weekMap[k];
        });

        var html = '';
        recentKeys.forEach(function(k, i) {
            var count = weekMap[k];
            var pct = maxVal > 0 ? Math.max(3, (count / maxVal) * 100) : 3;
            var label = k.split('-W')[1] ? '第' + k.split('-W')[1] + '周' : k;
            var color = (i === recentKeys.length - 1) ? 'var(--lime)' : 'var(--sky)';
            html += '<div style="display:flex;align-items:center;gap:10px;font-size:0.8rem">'
                + '<span style="min-width:50px;color:#999">' + escapeHtml(label) + '</span>'
                + '<div style="flex:1;height:20px;background:#f5f3ed;border-radius:4px;overflow:hidden;border:1.5px solid var(--ink)">'
                + '<div style="width:' + pct + '%;height:100%;background:' + color + ';border-radius:3px"></div>'
                + '</div>'
                + '<span style="font-weight:700;min-width:30px">' + count + '</span>'
                + '</div>';
        });
        container.innerHTML = html;
    }

    // --- Detail Table ---
    function renderDetailTable(schools, users, courses, submissions, assignments) {
        var tbody = document.getElementById('stats-detail-tbody');
        if (!tbody) return;

        if (!schools || schools.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#999">暂无数据</td></tr>';
            return;
        }

        // Build maps
        var assignmentCourseMap = {};
        (assignments || []).forEach(function(a) {
            assignmentCourseMap[a.id] = a.course_id;
        });

        var courseSchoolMap = {};
        (courses || []).forEach(function(c) {
            courseSchoolMap[c.id] = c.school_id;
        });

        // Per-school stats
        var schoolStats = {};
        schools.forEach(function(s) {
            schoolStats[s.id] = { teachers: 0, students: 0, courses: 0, submissions: 0, onTime: 0 };
        });

        (users || []).forEach(function(u) {
            if (u.school_id && schoolStats[u.school_id]) {
                if (u.role === 'teacher') schoolStats[u.school_id].teachers++;
                if (u.role === 'student') schoolStats[u.school_id].students++;
            }
        });

        (courses || []).forEach(function(c) {
            if (c.school_id && schoolStats[c.school_id]) {
                schoolStats[c.school_id].courses++;
            }
        });

        (submissions || []).forEach(function(sub) {
            var courseId = assignmentCourseMap[sub.assignment_id];
            var schoolId = courseSchoolMap ? courseSchoolMap[courseId] : null;
            if (schoolId && schoolStats[schoolId]) {
                schoolStats[schoolId].submissions++;
                if (sub.status === 'submitted' || sub.status === 'graded') {
                    schoolStats[schoolId].onTime++;
                }
            }
        });

        var html = '';
        schools.forEach(function(s) {
            var st = schoolStats[s.id] || { teachers: 0, students: 0, courses: 0, submissions: 0, onTime: 0 };
            var onTimeRate = st.submissions > 0 ? Math.round((st.onTime / st.submissions) * 100) + '%' : 'N/A';
            var activeRate = st.students > 0 ? Math.round((st.submissions / Math.max(st.students, 1)) * 100) + '%' : 'N/A';

            html += '<tr>'
                + '<td><strong>' + escapeHtml(s.name) + '</strong></td>'
                + '<td>' + st.teachers + '</td>'
                + '<td>' + st.students + '</td>'
                + '<td>' + st.courses + '</td>'
                + '<td>' + st.submissions + '</td>'
                + '<td>' + onTimeRate + '</td>'
                + '<td>' + activeRate + '</td>'
                + '</tr>';
        });

        tbody.innerHTML = html || '<tr><td colspan="7" style="text-align:center;padding:30px;color:#999">暂无数据</td></tr>';
    }

    // --- Main: Load all data ---
    Promise.all([
        API.get('/admin/stats'),
        API.get('/schools/'),
        API.get('/admin/users'),
        API.get('/courses/'),
        API.get('/submissions/'),
        API.get('/assignments/')
    ]).then(function(results) {
        var stats = results[0] || {};
        var schools = results[1] || [];
        var users = results[2] || [];
        var courses = results[3] || [];
        var submissions = results[4] || [];
        var assignments = results[5] || [];

        // KPI
        renderKPI(stats);

        // Build school submission counts for bar chart
        var assignmentCourseMap = {};
        assignments.forEach(function(a) {
            assignmentCourseMap[a.id] = a.course_id;
        });
        var courseSchoolMap = {};
        courses.forEach(function(c) {
            courseSchoolMap[c.id] = c.school_id;
        });

        var schoolSubmissionCounts = {};
        schools.forEach(function(s) { schoolSubmissionCounts[s.id] = 0; });
        submissions.forEach(function(sub) {
            var courseId = assignmentCourseMap[sub.assignment_id];
            var schoolId = courseSchoolMap[courseId];
            if (schoolId && schoolSubmissionCounts.hasOwnProperty(schoolId)) {
                schoolSubmissionCounts[schoolId]++;
            }
        });

        renderSchoolBarChart(schoolSubmissionCounts, schools);
        renderTrendChart(submissions);
        renderDetailTable(schools, users, courses, submissions, assignments);
    }).catch(function(err) {
        console.error('加载统计数据失败:', err);
        var containers = ['kpi-submissions', 'kpi-users', 'kpi-classes', 'kpi-rate',
                          'bar-chart-container', 'trend-chart-container', 'stats-detail-tbody'];
        containers.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) {
                if (el.tagName === 'TBODY') {
                    el.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#e74c3c">加载失败</td></tr>';
                } else {
                    el.textContent = '加载失败';
                }
            }
        });
    });
});
