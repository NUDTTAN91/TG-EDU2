// 解析后端CST时间字符串为正确的Date对象
function parseCST(dateStr) {
    if (!dateStr) return new Date(NaN);
    var s = String(dateStr);
    if (s.length > 10 && s.indexOf('Z') === -1 && s.indexOf('+') === -1) s += '+08:00';
    return new Date(s);
}

function cstNow() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
}

// 学生 作业详情 页面功能模块
document.addEventListener('DOMContentLoaded', function() {
    if (!Auth.requireRole('student')) return;

    fillSidebarInfo();

    var params = new URLSearchParams(window.location.search);
    var assignmentId = parseInt(params.get('id'));
    if (!assignmentId) {
        window.location.href = 'courses.html';
        return;
    }

    loadAssignmentDetail(assignmentId);
});

function loadAssignmentDetail(id) {
    Promise.all([
        API.get('/assignments/' + id),
        API.get('/submissions/'),
        API.get('/courses/')
    ]).then(function(results) {
        var assignment = results[0];
        var submissions = Array.isArray(results[1]) ? results[1] : (results[1] && results[1].items ? results[1].items : []);
        var courses = Array.isArray(results[2]) ? results[2] : (results[2] && results[2].items ? results[2].items : []);

        if (!assignment) {
            document.getElementById('assignment-detail-card').innerHTML = '<div style="padding:40px;text-align:center">作业不存在</div>';
            return;
        }

        // 找到课程名
        var courseMap = {};
        courses.forEach(function(c) { courseMap[c.id] = c; });
        var course = courseMap[assignment.course_id];
        var courseName = course ? course.name : '未知课程';

        // 找到当前学生的提交
        var mySubmission = submissions.find(function(s) { return s.assignment_id === id; });

        // 渲染面包屑
        var breadcrumbTitle = document.getElementById('breadcrumb-title');
        if (breadcrumbTitle) breadcrumbTitle.textContent = assignment.title;

        // 渲染详情卡片
        renderDetailCard(assignment, courseName, mySubmission);

        // 显示/隐藏提交区域
        if (!mySubmission) {
            var isOverdue = assignment.deadline && parseCST(assignment.deadline) < cstNow();
            if (!isOverdue) {
                document.getElementById('submit-section').style.display = '';
                // 更新文件格式提示
                var hint = document.getElementById('upload-hint');
                if (hint && assignment.attachments) {
                    hint.textContent = '支持: ' + assignment.attachments;
                }
                bindSubmitEvents(id, assignment);
            }
        }

        // 显示提交记录
        if (mySubmission) {
            renderSubmissionRecord(mySubmission);
        }

        if (typeof lucide !== 'undefined') lucide.createIcons();
    }).catch(function(err) {
        console.error('加载作业详情失败:', err);
        document.getElementById('assignment-detail-card').innerHTML = '<div style="padding:40px;text-align:center;color:#e07a5f">加载失败，请刷新重试</div>';
    });
}

function renderDetailCard(assignment, courseName, submission) {
    var card = document.getElementById('assignment-detail-card');
    var typeLabels = { homework: '课后作业', experiment: '实验报告', essay: '论文', project: '项目' };
    var typeName = typeLabels[assignment.type] || '课后作业';

    // 状态判断
    var statusClass = 'status-pending';
    var statusText = '待提交';
    if (submission) {
        if (submission.grade !== null && submission.grade !== undefined) {
            statusClass = 'status-graded';
            statusText = '已批改 ' + submission.grade + '分';
        } else {
            statusClass = 'status-submitted';
            statusText = '已提交';
        }
    } else if (assignment.deadline && parseCST(assignment.deadline) < cstNow()) {
        statusClass = 'status-overdue';
        statusText = '已逾期';
    }

    var deadlineText = assignment.deadline
        ? parseCST(assignment.deadline).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }).replace(/\//g, '-')
        : '无截止时间';

    // 发布时间格式化
    var createdText = formatRelativeTime(assignment.created_at);

    card.innerHTML =
        '<div class="detail-card-header">' +
            '<div class="detail-card-header-left">' +
                '<i data-lucide="bell" style="width:16px;height:16px"></i>' +
                '<span style="font-weight:600">作业通知</span>' +
            '</div>' +
            '<div style="display:flex;gap:6px;align-items:center">' +
                '<span class="detail-card-type">' + typeName + '</span>' +
                '<span class="detail-card-status ' + statusClass + '">' + statusText + '</span>' +
            '</div>' +
        '</div>' +
        '<div class="detail-card-body">' +
            '<div class="detail-card-title">' + escapeHtml(assignment.title) + '</div>' +
            '<div class="detail-card-meta">' +
                '<span><i data-lucide="book-open"></i> ' + escapeHtml(courseName) + '</span>' +
                '<span><i data-lucide="target"></i> 满分 100 分</span>' +
                '<span><i data-lucide="clock"></i> 截止：' + escapeHtml(deadlineText) + '</span>' +
            '</div>' +
            (assignment.description ? '<div class="detail-card-desc">' + escapeHtml(assignment.description) + '</div>' : '') +
            (assignment.attachments
                ? '<div class="detail-card-meta" style="margin-bottom:0">' +
                    '<span><i data-lucide="file-text"></i> 接受文件格式：' + escapeHtml(assignment.attachments) + '</span>' +
                  '</div>'
                : '') +
        '</div>' +
        '<div class="detail-card-footer">' +
            '<span style="display:flex;align-items:center;gap:4px"><i data-lucide="user" style="width:13px;height:13px"></i> 教师发布</span>' +
            '<span style="display:flex;align-items:center;gap:4px"><i data-lucide="calendar" style="width:13px;height:13px"></i> ' + createdText + '</span>' +
        '</div>';
}

function renderSubmissionRecord(submission) {
    var section = document.getElementById('submission-record');
    var body = document.getElementById('submission-record-body');
    section.style.display = '';

    var gradeHtml = '';
    if (submission.grade !== null && submission.grade !== undefined) {
        var gradeClass = submission.grade >= 80 ? 'grade-high' : (submission.grade >= 60 ? 'grade-mid' : 'grade-low');
        gradeHtml =
            '<div class="detail-record-item">' +
                '<i data-lucide="award" style="width:16px;height:16px"></i>' +
                '<span>成绩：<span class="' + gradeClass + '" style="font-size:1.1rem">' + submission.grade + '/100</span></span>' +
            '</div>';
        if (submission.feedback) {
            gradeHtml +=
                '<div class="detail-record-item">' +
                    '<i data-lucide="message-square" style="width:16px;height:16px"></i>' +
                    '<span>评语：' + escapeHtml(submission.feedback) + '</span>' +
                '</div>';
        }
    }

    body.innerHTML =
        '<div class="detail-record-item">' +
            '<i data-lucide="file" style="width:16px;height:16px"></i>' +
            '<span>提交文件：<strong>' + escapeHtml(submission.file_name || submission.file_path || '未知文件') + '</strong></span>' +
        '</div>' +
        '<div class="detail-record-item">' +
            '<i data-lucide="clock" style="width:16px;height:16px"></i>' +
            '<span>提交时间：' + parseCST(submission.submitted_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) + '</span>' +
        '</div>' +
        gradeHtml;
}

function bindSubmitEvents(assignmentId, assignment) {
    var fileInput = document.getElementById('detail-file-input');
    var submitBtn = document.getElementById('detail-submit-btn');

    submitBtn.addEventListener('click', function() {
        if (!fileInput.files || !fileInput.files[0]) {
            showToast('请先选择文件', 'error');
            return;
        }

        var formData = new FormData();
        formData.append('file', fileInput.files[0]);

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i data-lucide="loader" style="width:16px;height:16px"></i> 上传中...';

        API.upload('/submissions/?assignment_id=' + assignmentId, formData).then(function() {
            showToast('提交成功！', 'success');
            setTimeout(function() { location.reload(); }, 1000);
        }).catch(function(err) {
            showToast('提交失败: ' + (err.message || '未知错误'), 'error');
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i data-lucide="send" style="width:16px;height:16px"></i> 提交作业';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        });
    });
}

// ===== 辅助函数 =====

function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    var now = cstNow();
    var date = parseCST(dateStr);
    var diff = Math.floor((now - date) / 1000);
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
    return Math.floor(diff / 86400) + ' 天前';
}

function fillSidebarInfo() {
    var nameEl = document.getElementById('sidebar-username');
    if (nameEl) nameEl.textContent = Auth.getDisplayName() || '学生';
    var roleEl = document.getElementById('sidebar-role');
    if (roleEl) roleEl.textContent = '学生';

    API.get('/auth/me').then(function(user) {
        if (!user) return;
        if (nameEl) nameEl.textContent = Auth.getDisplayName() || user.username || '学生';
        if (user.school_id) {
            API.get('/schools/').then(function(schools) {
                var list = Array.isArray(schools) ? schools : (schools.items || []);
                var match = list.filter(function(s) { return s.id === user.school_id; })[0];
                var schoolEl = document.getElementById('sidebar-school');
                if (schoolEl && match) schoolEl.textContent = match.name;
            }).catch(function() {});
        }
    }).catch(function() {});
}

function showToast(msg, type) {
    var existing = document.querySelector('.toast-msg');
    if (existing) existing.parentNode.removeChild(existing);
    var toast = document.createElement('div');
    toast.className = 'toast-msg';
    toast.textContent = msg;
    toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);padding:10px 24px;border-radius:8px;font-size:.85rem;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.15);transition:opacity .3s;' + (type === 'error' ? 'background:#e07a5f;color:#fff' : 'background:#3fb950;color:#fff');
    document.body.appendChild(toast);
    setTimeout(function() { toast.style.opacity = '0'; setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300); }, 3000);
}
