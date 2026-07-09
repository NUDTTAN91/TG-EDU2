// 学生 我的作业 页面功能模块
document.addEventListener('DOMContentLoaded', function() {
    if (!Auth.requireRole('student')) return;

    // 填充侧边栏信息
    fillSidebarInfo();

    // Tab 切换
    document.querySelectorAll('.submit-tab').forEach(function(b) {
        b.addEventListener('click', function() {
            var t = this.getAttribute('data-tab');
            document.querySelectorAll('.submit-tab').forEach(function(x) { x.classList.remove('active'); });
            this.classList.add('active');
            document.querySelectorAll('.tab-panel').forEach(function(p) { p.style.display = 'none'; });
            document.getElementById('tab-' + t).style.display = '';
        });
    });

    // 加载课程数据
    loadCourses();

    // 上传区域事件绑定
    bindUploadEvents();
});

// HTML 转义防 XSS
function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

// 将后端CST时间字符串解析为正确的Date对象（追加+08:00时区标记）
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

// 全局缓存
var _cachedAssignments = [];
var _cachedSubmissions = [];
var _cachedCourses = [];
var _selectedAssignmentId = null;

// 填充侧边栏用户名、角色、院校
function fillSidebarInfo() {
    // 先立即填充用户名（从本地缓存）
    var nameEl = document.getElementById('sidebar-username');
    if (nameEl) nameEl.textContent = Auth.getDisplayName() || '学生';
    var roleEl = document.getElementById('sidebar-role');
    if (roleEl) roleEl.textContent = '学生';

    // 从后端获取完整用户信息
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
    }).catch(function(err) {
        console.warn('获取用户信息失败:', err);
    });
}

// 加载课程、作业、提交数据并渲染
function loadCourses() {
    var grid = document.getElementById('course-grid');
    var empty = document.getElementById('courses-empty');

    Promise.all([
        API.get('/courses/'),
        API.get('/assignments/'),
        API.get('/submissions/')
    ]).then(function(results) {
        var courses      = Array.isArray(results[0]) ? results[0] : (results[0] && results[0].items ? results[0].items : []);
        var assignments  = Array.isArray(results[1]) ? results[1] : (results[1] && results[1].items ? results[1].items : []);
        var submissions  = Array.isArray(results[2]) ? results[2] : (results[2] && results[2].items ? results[2].items : []);

        _cachedAssignments = assignments;
        _cachedSubmissions = submissions;
        _cachedCourses = courses;

        // 构建提交映射: assignment_id -> submission
        var subMap = {};
        submissions.forEach(function(s) { subMap[s.assignment_id] = s; });

        // 按课程分组作业
        var courseAssignments = {};
        assignments.forEach(function(a) {
            var cid = a.course_id;
            if (!courseAssignments[cid]) courseAssignments[cid] = [];
            courseAssignments[cid].push(a);
        });

        // 渲染作业通知
        try {
            renderNotifications(assignments, submissions, courses);
        } catch (e) {
            console.error('渲染作业通知失败:', e);
        }
        fillAssignmentSelect(assignments, submissions);

        // 渲染课程卡片（如果存在课程网格）
        if (grid) {
            if (!courses.length) {
                grid.style.display = 'none';
                if (empty) empty.style.display = '';
            } else {
                grid.innerHTML = '';

                courses.forEach(function(course) {
            var asgs = courseAssignments[course.id] || [];
            var pending = 0, submitted = 0;
            asgs.forEach(function(a) {
                if (subMap[a.id]) { submitted++; } else { pending++; }
            });

            // 课程图标映射
            var iconMap = {
                '数据结构': 'database', '算法': 'git-branch',
                '数学': 'sigma', '高数': 'sigma',
                '英语': 'globe', '写作': 'file-text',
                '物理': 'atom', '化学': 'flask-conical',
                '编程': 'code', '操作系统': 'monitor',
                '网络': 'network', '数据库': 'database'
            };
            var icon = 'book-open';
            var name = (course.name || '').toLowerCase();
            for (var key in iconMap) {
                if (name.indexOf(key) !== -1) { icon = iconMap[key]; break; }
            }

            // 课程卡片 wrapper（卡片 + 展开区域）
            var wrapper = document.createElement('div');
            wrapper.style.cssText = 'display:flex;flex-direction:column';

            // 卡片
            var card = document.createElement('div');
            card.className = 'c-card';
            card.setAttribute('data-course-id', course.id);
            card.innerHTML =
                '<div class="cc-emoji"><i data-lucide="' + icon + '"></i></div>' +
                '<div class="cc-name">' + escapeHtml(course.name) + '</div>' +
                '<div class="cc-desc">' + escapeHtml(course.description || '暂无描述') + '</div>' +
                '<div class="cc-stats">' +
                    '<span class="cc-stat">待交 ' + pending + '</span>' +
                    '<span class="cc-stat">已交 ' + submitted + '</span>' +
                '</div>';

            // 展开区域
            var asgPanel = document.createElement('div');
            asgPanel.className = 'c-assignments';
            asgPanel.setAttribute('data-course-id', course.id);

            if (asgs.length === 0) {
                asgPanel.innerHTML = '<div class="c-assignments-empty">该课程暂无作业</div>';
            } else {
                asgs.forEach(function(a) {
                    var sub = subMap[a.id];
                    var statusHtml = '';
                    if (sub) {
                        if (sub.grade !== null && sub.grade !== undefined) {
                            statusHtml =
                                '<span class="as-score">' + sub.grade + '/100</span>' +
                                '<span class="as-status st-done"><i data-lucide="check"></i> 已批改</span>';
                        } else {
                            statusHtml =
                                '<span class="as-status st-grading"><i data-lucide="refresh-cw"></i> 已提交</span>';
                        }
                    } else {
                        var isOverdue = a.deadline && parseCST(a.deadline) < cstNow();
                        if (isOverdue) {
                            statusHtml = '<span class="as-status st-late"><i data-lucide="alert-triangle"></i> 逾期</span>';
                        } else {
                            statusHtml = '<span class="as-status st-todo"><i data-lucide="clock"></i> 待提交</span>';
                        }
                    }

                    var deadlineText = a.deadline
                        ? parseCST(a.deadline).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
                        : '无截止时间';

                    var row = document.createElement('div');
                    row.className = 'as-row';
                    row.innerHTML =
                        '<div class="as-left"><span class="as-id">#' + a.id + '</span></div>' +
                        '<div class="as-main">' +
                            '<div class="as-title">' + escapeHtml(a.title) + '</div>' +
                            '<div class="as-sub"><span>' + escapeHtml(a.description || '') + '</span>' +
                            '<span>截止 ' + escapeHtml(deadlineText) + '</span></div>' +
                        '</div>' +
                        statusHtml;
                    asgPanel.appendChild(row);
                });
            }

            // 点击卡片展开/收起
            (function(c, p) {
                c.addEventListener('click', function() {
                    var isOpen = p.classList.contains('open');
                    // 先关闭所有已展开的
                    document.querySelectorAll('.c-assignments.open').forEach(function(el) {
                        el.classList.remove('open');
                    });
                    document.querySelectorAll('.c-card.expanded').forEach(function(el) {
                        el.classList.remove('expanded');
                    });
                    if (!isOpen) {
                        p.classList.add('open');
                        c.classList.add('expanded');
                        // 重新渲染图标
                        if (typeof lucide !== 'undefined') lucide.createIcons();
                    }
                });
            })(card, asgPanel);

            wrapper.appendChild(card);
            wrapper.appendChild(asgPanel);
            grid.appendChild(wrapper);
        });
        } // end else
        } // end if (grid)

        // 渲染所有 lucide 图标
        if (typeof lucide !== 'undefined') lucide.createIcons();

    }).catch(function(err) {
        console.error('加载课程数据失败:', err);
        if (grid) grid.innerHTML = '';
        if (empty) {
            empty.textContent = '加载失败，请刷新页面重试';
            empty.style.display = '';
        }
    });
}

// 填充上传区域作业下拉框
function fillAssignmentSelect(assignments, submissions) {
    var subMap = {};
    submissions.forEach(function(s) { subMap[s.assignment_id] = s; });
    var selectEl = document.getElementById('submit-assignment-select');
    if (!selectEl) return;
    selectEl.innerHTML = '<option value="">请先选择作业</option>';
    assignments.forEach(function(a) {
        if (!subMap[a.id]) {
            var isOverdue = a.deadline && parseCST(a.deadline) < cstNow();
            if (!isOverdue) {
                var opt = document.createElement('option');
                opt.value = a.id;
                opt.textContent = '#' + a.id + ' ' + a.title;
                selectEl.appendChild(opt);
            }
        }
    });
    if (selectEl.options.length === 2) selectEl.selectedIndex = 1;
}

// 格式化截止时间显示
function formatDeadline(deadline) {
    if (!deadline) return '无截止时间';
    var d = parseCST(deadline);
    var now = cstNow();
    var diff = d - now;

    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var deadlineDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    if (deadlineDay.getTime() === today.getTime()) {
        return '今天 ' + padZero(d.getHours()) + ':' + padZero(d.getMinutes());
    } else if (deadlineDay.getTime() === today.getTime() + 86400000) {
        return '明天 ' + padZero(d.getHours()) + ':' + padZero(d.getMinutes());
    } else if (diff < 0) {
        return '已过期 ' + (d.getMonth() + 1) + '/' + d.getDate();
    } else {
        return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + padZero(d.getHours()) + ':' + padZero(d.getMinutes());
    }
}

function padZero(n) { return n < 10 ? '0' + n : '' + n; }

// 绑定上传事件
function bindUploadEvents() {
    var fileInput = document.getElementById('courses-file-input');
    if (fileInput) {
        fileInput.addEventListener('change', function() {
            if (this.files && this.files[0]) {
                var chip = document.querySelector('.file-chip');
                if (chip) {
                    var nameEl = chip.querySelector('.file-chip-name');
                    var metaEl = chip.querySelector('.file-chip-meta');
                    var tagEl = chip.querySelector('.file-chip-tag');
                    if (nameEl) nameEl.textContent = this.files[0].name;
                    if (metaEl) metaEl.textContent = formatFileSize(this.files[0].size) + ' · 已暂存，等待提交';
                    if (tagEl) tagEl.textContent = 'Ready';
                    chip.style.display = '';
                }
            }
        });
    }

    // 作业选择变化时：更新上传区提示为该作业的 attachments 与大小上限
    var selectEl = document.getElementById('submit-assignment-select');
    if (selectEl) {
        selectEl.addEventListener('change', updateUploadHint);
        // 初始化一次，若预选中也能显示
        setTimeout(updateUploadHint, 0);
    }

    // 提交按钮（精确按 id，避免文本匹配）
    var submitBtn = document.getElementById('courses-submit-btn');
    if (submitBtn) {
        submitBtn.addEventListener('click', function(e) {
            e.preventDefault();
            handleSubmission();
        });
    }

    // 本地自测（未实现的占位按钮）
    var previewBtn = document.getElementById('courses-preview-btn');
    if (previewBtn) {
        previewBtn.addEventListener('click', function(e) {
            e.preventDefault();
            showToast('本地自测功能暂未开放', 'error');
        });
    }
}

// 根据当前选中的作业更新上传提示
function updateUploadHint() {
    var hint = document.getElementById('courses-upload-hint');
    if (!hint) return;
    var selectEl = document.getElementById('submit-assignment-select');
    var aid = selectEl ? parseInt(selectEl.value) : NaN;
    if (!aid) {
        hint.textContent = '选择上方作业后自动显示支持的格式与大小限制';
        return;
    }
    var a = null;
    for (var i = 0; i < _cachedAssignments.length; i++) {
        if (_cachedAssignments[i].id === aid) { a = _cachedAssignments[i]; break; }
    }
    if (!a) return;
    var exts = a.attachments || '.cpp,.c,.java,.py,.zip';
    var size = a.max_file_size_mb || 50;
    hint.textContent = '支持: ' + exts + ' · 单文件 ≤ ' + size + ' MB';
}

// 客户端预检：扩展名 + 大小
function validateFileForAssignment(file, assignment) {
    if (!file) return false;
    var maxMb = (assignment && assignment.max_file_size_mb) || 50;
    if (file.size > maxMb * 1024 * 1024) {
        showError('文件大小超过限制 (' + maxMb + ' MB)');
        return false;
    }
    var name = file.name || '';
    var dot = name.lastIndexOf('.');
    var ext = dot >= 0 ? name.substring(dot).toLowerCase() : '';
    var raw = (assignment && assignment.attachments) || '.cpp,.c,.java,.py,.zip';
    var allowed = raw.split(',').map(function(e) {
        e = e.trim().toLowerCase();
        return e && e.charAt(0) !== '.' ? '.' + e : e;
    }).filter(Boolean);
    if (allowed.indexOf(ext) === -1) {
        showError('不允许的文件格式: ' + (ext || '(缺少扩展名)'));
        return false;
    }
    return true;
}

// 处理提交
function handleSubmission() {
    var fileInput = document.getElementById('courses-file-input');
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
        showError('请先选择文件');
        return;
    }

    var selectEl = document.getElementById('submit-assignment-select');
    var assignmentId = selectEl ? parseInt(selectEl.value) : NaN;

    if (!assignmentId) {
        showError('请先选择要提交的作业');
        return;
    }

    // 取作业对象做预检
    var assignment = null;
    for (var i = 0; i < _cachedAssignments.length; i++) {
        if (_cachedAssignments[i].id === assignmentId) { assignment = _cachedAssignments[i]; break; }
    }
    if (!validateFileForAssignment(fileInput.files[0], assignment)) return;

    var formData = new FormData();
    formData.append('file', fileInput.files[0]);

    var btn = document.getElementById('courses-submit-btn');
    var originalText = btn ? btn.innerHTML : '';
    var progressWrap = document.getElementById('courses-progress-wrap');
    var progressBar = document.getElementById('courses-progress-bar');
    var progressText = document.getElementById('courses-progress-text');

    if (btn) {
        btn.innerHTML = '<i data-lucide="loader"></i> 上传中…';
        btn.disabled = true;
    }
    if (progressWrap) progressWrap.style.display = '';

    API.uploadWithProgress('/submissions/?assignment_id=' + assignmentId, formData, function(pct) {
        if (progressBar) progressBar.style.width = pct + '%';
        if (progressText) progressText.textContent = pct + '%';
    }).then(function(result) {
        showSuccess('提交成功！');
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
        fileInput.value = '';
        var chip = document.querySelector('.file-chip');
        if (chip) chip.style.display = 'none';
        if (progressWrap) progressWrap.style.display = 'none';
        if (progressBar) progressBar.style.width = '0%';
        if (progressText) progressText.textContent = '0%';
        if (typeof lucide !== 'undefined') lucide.createIcons();
        loadCourses();
    }).catch(function(err) {
        showError('提交失败: ' + (err.message || '未知错误'));
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
        if (progressWrap) progressWrap.style.display = 'none';
        if (progressBar) progressBar.style.width = '0%';
        if (progressText) progressText.textContent = '0%';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    });
}

// 上传指定作业的文件通用函数
function uploadFile(btn, assignmentId) {
    var fileInput = btn.parentNode.querySelector('input[type="file"]');
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
        showError('请先选择文件');
        return;
    }

    var assignment = null;
    for (var i = 0; i < _cachedAssignments.length; i++) {
        if (_cachedAssignments[i].id === assignmentId) { assignment = _cachedAssignments[i]; break; }
    }
    if (!validateFileForAssignment(fileInput.files[0], assignment)) return;

    var formData = new FormData();
    formData.append('file', fileInput.files[0]);

    btn.textContent = '上传中…';
    btn.disabled = true;

    API.uploadWithProgress('/submissions/?assignment_id=' + assignmentId, formData).then(function(result) {
        showSuccess('提交成功！');
        loadCourses();
    }).catch(function(err) {
        showError('提交失败: ' + (err.message || '未知错误'));
        btn.textContent = '提交';
        btn.disabled = false;
    });
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// 显示错误提示
function showError(msg) {
    showToast(msg, 'error');
}

// 显示成功提示
function showSuccess(msg) {
    showToast(msg, 'success');
}

// 通用 Toast 提示
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

// ===== 视图切换 =====
function switchView(view) {
    var gridEl = document.getElementById('assignment-notifications');
    var tableEl = document.getElementById('assignment-table-view');
    if (!gridEl || !tableEl) return;
    document.querySelectorAll('.view-toggle .view-btn').forEach(function(b) { b.classList.remove('active'); });
    var target = document.querySelector('.view-btn[data-view="' + view + '"]');
    if (target) target.classList.add('active');
    if (view === 'list') {
        gridEl.style.display = 'none';
        tableEl.style.display = '';
    } else {
        gridEl.style.display = '';
        tableEl.style.display = 'none';
    }
}

// ===== 作业通知卡片 =====

// 渲染作业通知卡片列表（宫格视图）及表格（列表视图）
function renderNotifications(assignments, submissions, courses) {
    var listEl = document.getElementById('assignment-notifications');
    var tableBody = document.getElementById('assignment-table-body');
    if (!listEl) return;

    var subMap = {};
    submissions.forEach(function(s) { subMap[s.assignment_id] = s; });

    var courseMap = {};
    courses.forEach(function(c) { courseMap[c.id] = c; });

    listEl.innerHTML = '';
    if (tableBody) tableBody.innerHTML = '';

    if (assignments.length === 0) {
        listEl.innerHTML = '<div class="empty-state"><i data-lucide="inbox" style="width:32px;height:32px;margin-bottom:8px;display:inline-block"></i> 暂无作业通知<div class="empty-empty">当前没有老师布置的作业</div></div>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    // 按 created_at 倒序排列
    var sorted = assignments.slice().sort(function(a, b) {
        return parseCST(b.created_at) - parseCST(a.created_at);
    });

    sorted.forEach(function(a) {
        var sub = subMap[a.id];
        var course = courseMap[a.course_id];
        var courseName = course ? course.name : '未知课程';

        // 状态（宫格卡片用）
        var statusClass = 'status-pending';
        var statusText = '待提交';
        var statusBg = 'rgba(210,153,27,.15)';
        var statusColor = '#d2991b';
        // 状态（列表表格用）
        var tagClass = 'tag tag-yellow';
        var tagText = '待提交';
        if (sub) {
            if (sub.grade !== null && sub.grade !== undefined) {
                statusClass = 'status-graded';
                statusText = '已批改 ' + sub.grade + '分';
                statusBg = 'rgba(63,185,80,.15)';
                statusColor = '#3fb950';
                tagClass = 'tag tag-green';
                tagText = '已批改';
            } else {
                statusClass = 'status-submitted';
                statusText = '已提交';
                statusBg = 'rgba(88,166,255,.15)';
                statusColor = '#58a6ff';
                tagClass = 'tag tag-blue';
                tagText = '已提交';
            }
        } else {
            var isOverdue = a.deadline && parseCST(a.deadline) < cstNow();
            if (isOverdue) {
                statusClass = 'status-overdue';
                statusText = '已逾期';
                statusBg = 'rgba(248,81,73,.15)';
                statusColor = '#f85149';
                tagClass = 'tag tag-red';
                tagText = '已逾期';
            }
        }

        var deadlineFull = a.deadline
            ? parseCST(a.deadline).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }).replace(/\//g, '-')
            : '无截止时间';
        var deadlineShort = a.deadline ? formatDeadline(a.deadline) : '无截止时间';
        var attachments = a.attachments || '.cpp,.c,.java,.py,.zip';

        // 计算发布时间
        var publishTime = '刚刚发布';
        if (a.created_at) {
            var diff = cstNow() - parseCST(a.created_at);
            if (diff < 60000) publishTime = '刚刚发布';
            else if (diff < 3600000) publishTime = Math.floor(diff / 60000) + ' 分钟前';
            else if (diff < 86400000) publishTime = Math.floor(diff / 3600000) + ' 小时前';
            else publishTime = Math.floor(diff / 86400000) + ' 天前';
        }

        // 获取课程教师名（如有）
        var teacherName = course && course.teacher_name ? course.teacher_name : '';

        // ===== 宫格卡片 =====
        var card = document.createElement('div');
        card.className = 'assignment-card';
        card.setAttribute('data-assignment-id', a.id);

        card.innerHTML =
            // 深色顶栏
            '<div class="assignment-card-header">' +
                '<span style="font-weight:700;font-size:.75rem;display:flex;align-items:center;gap:5px">' +
                    '<i data-lucide="book-open" style="width:14px;height:14px"></i> 作业通知</span>' +
                '<div style="display:flex;gap:6px;align-items:center">' +
                    '<span class="assignment-card-type">课后作业</span>' +
                    '<span class="assignment-card-status" style="background:' + statusBg + ';color:' + statusColor + '">' + statusText + '</span>' +
                '</div>' +
            '</div>' +
            // 卡片主体
            '<div class="assignment-card-body">' +
                '<div class="assignment-card-title">' + escapeHtml(a.title) + '</div>' +
                '<div class="assignment-card-meta">' +
                    '<span><i data-lucide="book-open" style="width:13px;height:13px;display:inline;vertical-align:-2px"></i> ' + escapeHtml(courseName) + '</span>' +
                    '<span><i data-lucide="target" style="width:13px;height:13px;display:inline;vertical-align:-2px"></i> 满分 100 分</span>' +
                    '<span><i data-lucide="clock" style="width:13px;height:13px;display:inline;vertical-align:-2px"></i> 截止：' + escapeHtml(deadlineFull) + '</span>' +
                '</div>' +
                '<div class="assignment-card-desc">' + escapeHtml(a.description || '暂无描述') + '</div>' +
                '<div style="font-size:.72rem;color:#aaa;margin-bottom:10px;display:flex;align-items:center;gap:4px">' +
                    '<i data-lucide="file-text" style="width:12px;height:12px;display:inline"></i> 接受文件格式：' + escapeHtml(attachments) +
                '</div>' +
            '</div>' +
            // 底部信息
            '<div class="assignment-card-footer">' +
                '<span>' + escapeHtml(teacherName) + '</span>' +
                '<span>' + publishTime + '</span>' +
            '</div>';

        // 整张卡片点击跳转到作业详情页
        card.addEventListener('click', function() {
            window.location.href = 'assignment-detail.html?id=' + a.id;
        });

        listEl.appendChild(card);

        // ===== 列表表格行 =====
        if (tableBody) {
            var fullScore = (a.max_score !== undefined && a.max_score !== null) ? a.max_score : 100;
            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td><strong>' + escapeHtml(a.title) + '</strong></td>' +
                '<td>' + escapeHtml(courseName) + '</td>' +
                '<td>' + fullScore + '</td>' +
                '<td>' + escapeHtml(deadlineFull) + '</td>' +
                '<td><span class="' + tagClass + '">' + tagText + '</span></td>' +
                '<td><button class="btn btn-secondary btn-view-assignment" data-id="' + a.id + '">查看</button></td>';
            tableBody.appendChild(tr);
        }
    });

    // 绑定列表表格"查看"按钮点击事件（跳转到作业详情页）
    if (tableBody) {
        tableBody.querySelectorAll('.btn-view-assignment').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var aid = parseInt(this.getAttribute('data-id'));
                window.location.href = 'assignment-detail.html?id=' + aid;
            });
        });
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// 点击通知卡片 / 查看 → 滚动到上传区域并选中作业
function selectNotification(assignmentId, assignment, submission) {
    _selectedAssignmentId = assignmentId;

    document.querySelectorAll('.assignment-card').forEach(function(c) { c.classList.remove('selected'); });
    var targetCard = document.querySelector('.assignment-card[data-assignment-id="' + assignmentId + '"]');
    if (targetCard) targetCard.classList.add('selected');

    var selectEl = document.getElementById('submit-assignment-select');
    if (selectEl) selectEl.value = assignmentId;

    if (submission) {
        var uploadSection = document.getElementById('upload-section');
        if (uploadSection) uploadSection.style.display = 'none';
        return;
    }

    var uploadSection = document.getElementById('upload-section');
    if (uploadSection) {
        uploadSection.style.display = '';
        uploadSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}
