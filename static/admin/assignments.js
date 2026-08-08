// Admin Assignment Management — 作业管理页面（级联选择：学校 → 班级 → 课程）

// ===== Tab Switching =====
function switchAssignTab(tab) {
    var btns = document.querySelectorAll('.tab-btn');
    btns.forEach(function(b) { b.classList.remove('active'); });
    if (tab === 'list') {
        // Reset edit state if switching back to list
        resetEditState();
        btns[0].classList.add('active');
        document.getElementById('createPanel').style.display = 'none';
        document.getElementById('listPanel').style.display = '';
        document.getElementById('publishActionBar').style.display = 'none';
        document.getElementById('topbarRightSpacer').style.display = '';
        loadAssignmentList();
    } else {
        btns[1].classList.add('active');
        document.getElementById('createPanel').style.display = '';
        document.getElementById('listPanel').style.display = 'none';
        document.getElementById('publishActionBar').style.display = '';
        document.getElementById('topbarRightSpacer').style.display = 'none';
    }
}

// ===== Edit State Management =====
function resetEditState() {
    if (!editingAssignmentId) return;
    editingAssignmentId = null;
    var btn = document.getElementById('publishBtn');
    btn.textContent = '发布作业 →';
    btn.onclick = handlePublish;
}

// ===== Helpers =====
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

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    var d = parseCST(dateStr);
    if (isNaN(d.getTime())) return '-';
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}

// ===== Data =====
var allSchools = [], allCourses = [], allClasses = [], allAssignments = [], allSubmissions = [];
var courseMap = {};
var typeLabels = { homework: '课后作业', experiment: '实验报告', essay: '论文', project: '项目' };
var currentType = 'homework';

// ===== Modal Helpers =====
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function showError(elId, msg) { var el = document.getElementById(elId); if (el) { el.textContent = msg; el.style.display = 'block'; } }
function hideError(elId) { var el = document.getElementById(elId); if (el) { el.style.display = 'none'; el.textContent = ''; } }

document.addEventListener('click', function(e) {
    if (e.target.classList.contains('overlay')) e.target.classList.remove('open');
});

// ===== Toast =====
function showToast(msg, isError) {
    var el = document.getElementById('publishStatus');
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.classList.add('show');
    setTimeout(function() { el.classList.remove('show'); }, 3000);
}

// ===== Data Loading =====
function loadAllData() {
    Promise.all([
        API.get('/schools/').catch(function(err) { console.error('Failed to load schools', err); return []; }),
        API.get('/courses/').catch(function(err) { console.error('Failed to load courses', err); return []; }),
        API.get('/classes/').catch(function(err) { console.error('Failed to load classes', err); return []; }),
        API.get('/assignments/').catch(function(err) { console.error('Failed to load assignments', err); return []; }),
        API.get('/submissions/').catch(function() { return []; })
    ]).then(function(results) {
        allSchools     = results[0] || [];
        allCourses     = results[1] || [];
        allClasses     = results[2] || [];
        allAssignments = results[3] || [];
        allSubmissions = results[4] || [];

        allCourses.forEach(function(c) { courseMap[c.id] = c.name || ('课程 ' + c.id); });

        populateSchoolSelect();
        populateCourseFilter();
        renderAssignments();
        updatePreview();
    });
}

function populateSchoolSelect() {
    var html = '<option value="">请选择学校</option>';
    allSchools.forEach(function(s) {
        html += '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>';
    });
    document.getElementById('schoolSelect').innerHTML = html;
}

function populateCourseFilter() {
    var html = '<option value="">全部课程</option>';
    allCourses.forEach(function(c) {
        html += '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
    });
    document.getElementById('a-filter-course').innerHTML = html;
}

// ===== Cascade: School → Class chips → Course =====

// 课程候选 = 该校全部课程并启用下拉。
// 班级与课程的关联（class.course_id）只作展示参考，不用于收窄候选：
// 作业最终只绑定 course_id，班级选择不参与提交；且新建课程在未关联
// 任何班级前（班级数 0）若按班级关联过滤会永远选不到
function fillSchoolCourses(schoolId) {
    var courseSelect = document.getElementById('courseSelect');
    var html = '<option value="">请选择课程</option>';
    allCourses.forEach(function(c) {
        if (String(c.school_id) !== String(schoolId)) return;
        html += '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
    });
    courseSelect.innerHTML = html;
    courseSelect.disabled = false;
}

function onSchoolChange() {
    var schoolId = document.getElementById('schoolSelect').value;
    var courseSelect = document.getElementById('courseSelect');

    // Reset course select
    courseSelect.innerHTML = '<option value="">请先选择班级</option>';
    courseSelect.disabled = true;

    if (!schoolId) {
        document.getElementById('classChips').innerHTML =
            '<span style="color:#999;font-size:.85rem;padding:8px">请先选择学校</span>';
        updatePreview();
        return;
    }

    // Filter classes belonging to this school
    var schoolClasses = allClasses.filter(function(cls) {
        return String(cls.school_id) === schoolId;
    });

    var container = document.getElementById('classChips');
    if (schoolClasses.length === 0) {
        // 无班级不再阻断布置作业：课程下拉仍可用（BUG-6）
        container.innerHTML = '<span style="color:#999;font-size:.85rem;padding:8px">该学校下暂无班级（仍可直接选择课程布置作业）</span>';
        fillSchoolCourses(schoolId);
        updatePreview();
        return;
    }

    var html = '';
    schoolClasses.forEach(function(cls) {
        var count = cls.student_count || 0;
        html += '<label class="chip" data-class-id="' + cls.id + '" data-course-ids="' + (cls.course_ids || []).join(',') + '" onclick="toggleChip(this)">'
            + '<input type="checkbox">'
            + '<span>' + escapeHtml(cls.name) + '</span>'
            + '<span class="chip-count">' + count + '人</span>'
            + '</label>';
    });
    html += '<button class="select-all" onclick="toggleAll()">全选 / 取消</button>';
    container.innerHTML = html;

    updatePreview();
}

function onClassSelectionChange() {
    var checkedChips = document.querySelectorAll('#classChips .chip.checked');
    var courseSelect = document.getElementById('courseSelect');
    var schoolId = document.getElementById('schoolSelect').value;

    if (checkedChips.length === 0) {
        courseSelect.innerHTML = '<option value="">请先选择班级</option>';
        courseSelect.disabled = true;
        updatePreview();
        return;
    }

    // 课程候选 = 已勾选班级所关联的课程（多对多取并集）
    var linked = {};
    checkedChips.forEach(function(chip) {
        (chip.getAttribute('data-course-ids') || '').split(',').forEach(function(x) {
            if (x !== '') linked[x] = true;
        });
    });
    var linkedIds = Object.keys(linked);

    if (linkedIds.length === 0) {
        // 勾选的班级尚未关联任何课程 → 回退该校全部课程（保证新课可布置）
        fillSchoolCourses(schoolId);
    } else {
        var html = '<option value="">请选择课程</option>';
        allCourses.forEach(function(c) {
            if (!linked[String(c.id)]) return;
            html += '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
        });
        courseSelect.innerHTML = html;
        courseSelect.disabled = false;
    }
    updatePreview();
}

// ===== Form: Type Selection =====
function selectType(el, type) {
    document.querySelectorAll('.type-card').forEach(function(c) { c.classList.remove('selected'); });
    el.classList.add('selected');
    currentType = type;
    document.getElementById('pvType').textContent = typeLabels[type] || type;
}

// ===== Form: Chip Toggle =====
function toggleChip(el) {
    setTimeout(function() {
        el.classList.toggle('checked', el.querySelector('input').checked);
        onClassSelectionChange();
    }, 0);
}

function toggleAll() {
    var chips = document.querySelectorAll('#classChips .chip');
    var allChecked = chips.length > 0 && Array.prototype.every.call(chips, function(c) { return c.classList.contains('checked'); });
    chips.forEach(function(c) {
        var input = c.querySelector('input');
        input.checked = !allChecked;
        c.classList.toggle('checked', !allChecked);
    });
    onClassSelectionChange();
}

// ===== Format Multi-Select =====
var formatNameMap = {'.pdf':'PDF','.docx':'Word','.doc':'Word(.doc)','.zip':'压缩包(.zip)','.rar':'压缩包(.rar)','.pptx':'PPT','.xlsx':'Excel','.txt':'文本','.cpp':'C++','.c':'C','.java':'Java','.py':'Python'};

function toggleFormatDropdown() {
    var dd = document.getElementById('formatDropdown');
    dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}

function updateFormatLabel() {
    var checked = document.querySelectorAll('#formatDropdown input[type="checkbox"]:checked');
    var names = [];
    checked.forEach(function(cb) { names.push(formatNameMap[cb.value] || cb.value); });
    document.getElementById('formatLabel').textContent = names.length > 0 ? names.join(', ') : '请选择文件格式';
    updatePreview();
}

function getSelectedFormats() {
    var checked = document.querySelectorAll('#formatDropdown input[type="checkbox"]:checked');
    var vals = [];
    checked.forEach(function(cb) { vals.push(cb.value); });
    return vals.join(',');
}

// Close format dropdown on outside click
document.addEventListener('click', function(e) {
    var fs = document.getElementById('formatSelect');
    if (fs && !fs.contains(e.target)) {
        var dd = document.getElementById('formatDropdown');
        if (dd) dd.style.display = 'none';
    }
});

// ===== Preview Update =====
function updatePreview() {
    var title = document.getElementById('titleInput').value;
    var courseEl = document.getElementById('courseSelect');
    var courseText = (courseEl.value === '' || courseEl.disabled)
        ? '请选择课程'
        : (courseEl.options[courseEl.selectedIndex] ? courseEl.options[courseEl.selectedIndex].text : '请选择课程');
    var desc = document.getElementById('descInput').value;
    var score = document.getElementById('scoreInput').value;
    var deadline = document.getElementById('deadlineInput').value;
    var format = getSelectedFormats();

    document.getElementById('pvTitle').textContent = title || '作业标题将显示在这里';
    document.getElementById('pvTitle').style.color = title ? 'var(--ink)' : '#ccc';
    document.getElementById('pvCourse').innerHTML = '<i data-lucide="book-open"></i> ' + courseText;
    document.getElementById('pvScore').innerHTML = '<i data-lucide="target"></i> ' + (score || '—') + ' 分';
    document.getElementById('pvDeadline').innerHTML = '<i data-lucide="clock"></i> ' + (deadline ? deadline.replace('T', ' ') : '待设定截止时间');
    document.getElementById('pvDesc').textContent = desc || '在这里输入作业描述，学生会看到这段文字。可以写明要求、注意事项、参考资料等。';
    document.getElementById('pvDesc').style.color = desc ? '#666' : '#bbb';
    document.getElementById('pvFormat').innerHTML = '<span class="preview-meta-item">' + escapeHtml(format || '不限') + '</span>';

    // Classes preview from checked chips
    var checked = document.querySelectorAll('#classChips .chip.checked span:nth-child(2)');
    var pvClasses = document.getElementById('pvClasses');
    pvClasses.innerHTML = Array.prototype.map.call(checked, function(c) {
        return '<span class="preview-class-tag">' + escapeHtml(c.textContent) + '</span>';
    }).join('') || '<span class="preview-class-tag" style="color:#ccc">未选择班级</span>';

    // Settings
    var toggleRows = document.querySelectorAll('.toggle-row');
    var pvSettings = document.getElementById('pvSettings');
    var settings = [];
    toggleRows.forEach(function(row) {
        var toggle = row.querySelector('.toggle');
        if (toggle && toggle.classList.contains('on')) {
            settings.push(row.querySelector('.toggle-label').textContent);
        }
    });
    pvSettings.innerHTML = settings.map(function(s) {
        return '<span class="preview-setting">' + escapeHtml(s) + '</span>';
    }).join('') || '<span class="preview-setting" style="opacity:0.4">无特殊设置</span>';

    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
}

// ===== Publish Assignment =====
function handlePublish() {
    // If in edit mode, delegate to saveEditAssignment
    if (editingAssignmentId) { saveEditAssignment(); return; }

    var title = document.getElementById('titleInput').value.trim();
    var courseId = document.getElementById('courseSelect').value;
    var desc = document.getElementById('descInput').value.trim();
    var deadline = document.getElementById('deadlineInput').value;
    var formatVal = getSelectedFormats();

    if (!title) { showToast('请输入作业标题', true); return; }
    if (!courseId) { showToast('请先选择学校、班级和课程', true); return; }

    var attachments = formatVal || 'pdf, docx, zip';
    var payload = {
        title: title,
        description: desc,
        course_id: parseInt(courseId),
        deadline: deadline ? deadline + ':00' : null,
        attachments: attachments,
        auto_ai_grade: document.getElementById('autoAiToggle').classList.contains('on')
    };

    var btn = document.getElementById('publishBtn');
    btn.textContent = '发布中…';
    btn.disabled = true;

    API.post('/assignments/', payload).then(function() {
        btn.textContent = '✓ 已发布';
        showToast('作业发布成功！', false);
        setTimeout(function() {
            resetCreateForm();
            btn.textContent = '发布作业 →';
            btn.disabled = false;
            loadAssignmentList();
        }, 1000);
    }).catch(function(err) {
        btn.textContent = '发布作业 →';
        btn.disabled = false;
        showToast(err.message || '发布失败，请重试', true);
    });
}

// ===== Existing Assignments List =====
function loadAssignmentList() {
    Promise.all([
        API.get('/assignments/').catch(function() { return []; }),
        API.get('/submissions/').catch(function() { return []; })
    ]).then(function(results) {
        allAssignments = results[0] || [];
        allSubmissions = results[1] || [];
        renderAssignments();
    });
}

function renderAssignments() {
    var tbody = document.getElementById('assignments-tbody');
    var courseFilter = (document.getElementById('a-filter-course') || {}).value || '';
    var filtered = allAssignments.filter(function(a) {
        if (courseFilter && String(a.course_id) !== courseFilter) return false;
        return true;
    });
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">暂无作业数据</td></tr>';
        return;
    }
    var html = '';
    filtered.forEach(function(a) {
        var subs = allSubmissions.filter(function(s) { return s.assignment_id === a.id; });
        var graded = subs.filter(function(s) { return s.grade !== null && s.grade !== undefined; }).length;
        html += '<tr>'
            + '<td><strong>' + escapeHtml(a.title) + '</strong></td>'
            + '<td>' + escapeHtml(courseMap[a.course_id] || '-') + '</td>'
            + '<td>' + formatDateTime(a.deadline) + '</td>'
            + '<td>' + subs.length + '</td>'
            + '<td>' + graded + '/' + subs.length + '</td>'
            + '<td>' + formatDate(a.created_at) + '</td>'
            + '<td><button class="btn btn-secondary" onclick="editAssignment(' + a.id + ')">编辑</button> '
            + '<button class="btn btn-secondary" onclick="deleteAssignment(' + a.id + ')" style="color:#e74c3c">删除</button></td>'
            + '</tr>';
    });
    tbody.innerHTML = html;
}

// ===== Edit Assignment (fill form + switch tab) =====
var editingAssignmentId = null;

function editAssignment(assignId) {
    var a = allAssignments.find(function(x) { return x.id === assignId; });
    if (!a) { showToast('找不到该作业数据', true); return; }

    editingAssignmentId = assignId;

    // Switch to create tab
    switchAssignTab('create');

    // Fill basic fields
    document.getElementById('titleInput').value = a.title || '';
    document.getElementById('descInput').value = a.description || '';
    document.getElementById('deadlineInput').value = a.deadline ? a.deadline.slice(0, 16) : '';

    // Fill file formats
    var formats = (a.attachments || '').split(',').map(function(f) { return f.trim(); });
    var checkboxes = document.querySelectorAll('#formatDropdown input[type="checkbox"]');
    checkboxes.forEach(function(cb) {
        cb.checked = formats.indexOf(cb.value) !== -1;
    });
    updateFormatLabel();

    // 回填自动批改开关
    document.getElementById('autoAiToggle').classList.toggle('on', !!a.auto_ai_grade);

    // Cascade: school → classes → course
    var course = allCourses.find(function(c) { return c.id === a.course_id; });
    var schoolId = course ? String(course.school_id || '') : '';

    if (schoolId) {
        document.getElementById('schoolSelect').value = schoolId;
        onSchoolChange(); // populates class chips

        // Wait a tick for DOM to update, then select classes belonging to this course
        setTimeout(function() {
            var chips = document.querySelectorAll('#classChips .chip');
            chips.forEach(function(chip) {
                var chipCourseIds = (chip.getAttribute('data-course-ids') || '').split(',');
                if (chipCourseIds.indexOf(String(a.course_id)) !== -1) {
                    var input = chip.querySelector('input');
                    if (input && !input.checked) {
                        input.checked = true;
                        chip.classList.add('checked');
                    }
                }
            });
            // 有勾选班级 → 按关联课程收窄候选；否则回退该校全部课程（未关联课程仍可编辑）
            var anyChecked = document.querySelectorAll('#classChips .chip.checked').length > 0;
            if (anyChecked) onClassSelectionChange(); else fillSchoolCourses(schoolId);
            // Now select the course
            document.getElementById('courseSelect').value = a.course_id || '';
            updatePreview();
        }, 50);
    }

    // Update publish button to "save edit" mode
    var btn = document.getElementById('publishBtn');
    btn.textContent = '保存修改 →';
    btn.onclick = function() { saveEditAssignment(); };

    // Scroll to top of form
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function saveEditAssignment() {
    var title = document.getElementById('titleInput').value.trim();
    var courseId = document.getElementById('courseSelect').value;
    var desc = document.getElementById('descInput').value.trim();
    var deadline = document.getElementById('deadlineInput').value;
    var formatVal = getSelectedFormats();

    if (!title) { showToast('请输入作业标题', true); return; }
    if (!courseId) { showToast('请先选择学校、班级和课程', true); return; }

    var attachments = formatVal || 'pdf, docx, zip';
    var payload = {
        title: title,
        description: desc,
        course_id: parseInt(courseId),
        deadline: deadline ? deadline + ':00' : null,
        attachments: attachments,
        auto_ai_grade: document.getElementById('autoAiToggle').classList.contains('on')
    };

    var btn = document.getElementById('publishBtn');
    btn.textContent = '保存中…';
    btn.disabled = true;

    API.put('/assignments/' + editingAssignmentId, payload).then(function() {
        btn.textContent = '✓ 已保存';
        showToast('作业已更新', false);
        setTimeout(function() {
            // Reset edit state
            editingAssignmentId = null;
            btn.textContent = '发布作业 →';
            btn.disabled = false;
            btn.onclick = handlePublish;
            // Clear form
            resetCreateForm();
            // Switch back to list
            switchAssignTab('list');
        }, 1000);
    }).catch(function(err) {
        btn.textContent = '保存修改 →';
        btn.disabled = false;
        showToast(err.message || '保存失败，请重试', true);
    });
}

function resetCreateForm() {
    document.getElementById('titleInput').value = '';
    document.getElementById('descInput').value = '';
    document.getElementById('deadlineInput').value = '';
    document.getElementById('scoreInput').value = '100';
    document.getElementById('schoolSelect').value = '';
    document.getElementById('courseSelect').innerHTML = '<option value="">请先选择班级</option>';
    document.getElementById('courseSelect').disabled = true;
    document.getElementById('classChips').innerHTML =
        '<span style="color:#999;font-size:.85rem;padding:8px">请先选择学校</span>';
    document.querySelectorAll('.type-card').forEach(function(c) { c.classList.remove('selected'); });
    document.querySelector('.type-card').classList.add('selected');
    currentType = 'homework';
    // Reset format checkboxes
    var checkboxes = document.querySelectorAll('#formatDropdown input[type="checkbox"]');
    checkboxes.forEach(function(cb) { cb.checked = false; });
    updateFormatLabel();
    // Reset toggles
    var toggles = document.querySelectorAll('.toggle-row .toggle');
    toggles.forEach(function(t, i) {
        // Second toggle (允许覆盖提交) defaults to on
        if (i === 1) { t.classList.add('on'); } else { t.classList.remove('on'); }
    });
    updatePreview();
}

function deleteAssignment(id) {
    if (!confirm('确定删除该作业？关联的提交记录也会被删除。')) return;
    API.delete('/assignments/' + id).then(function() {
        loadAssignmentList();
        showToast('作业已删除', false);
    }).catch(function(err) { showToast(err.message || '删除失败', true); });
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', function() {
    if (!Auth.requireRole('admin')) return;

    var authorEl = document.getElementById('pvAuthor');
    if (authorEl && Auth.user) {
        authorEl.textContent = Auth.user.username || '管理员';
    }

    var filterEl = document.getElementById('a-filter-course');
    if (filterEl) filterEl.addEventListener('change', renderAssignments);

    loadAllData();
});
