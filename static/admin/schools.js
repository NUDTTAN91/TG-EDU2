// schools.js — 院校及班级管理页面逻辑
(function() {
    if (!Auth.requireRole('admin')) return;

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
        if (isNaN(d.getTime())) return escapeHtml(dateStr);
        return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    }

    // ===== Tab 切换 =====
    var tabBtns = document.querySelectorAll('.tab-btn');
    var panels = {
        schools: document.getElementById('panel-schools'),
        classes: document.getElementById('panel-classes')
    };
    var addBtns = {
        schools: document.getElementById('add-school-btn'),
        classes: document.getElementById('add-class-btn')
    };
    var tabLoaded = { schools: false, classes: false };
    var tabLoaders = { schools: loadSchools, classes: loadClasses };

    function switchTab(tab) {
        tabBtns.forEach(function(b) { b.classList.remove('active'); });
        document.querySelector('.tab-btn[data-tab="' + tab + '"]').classList.add('active');
        Object.keys(panels).forEach(function(k) { panels[k].classList.remove('active'); panels[k].style.display = 'none'; });
        panels[tab].classList.add('active'); panels[tab].style.display = '';
        Object.keys(addBtns).forEach(function(k) { addBtns[k].style.display = 'none'; });
        if (addBtns[tab]) addBtns[tab].style.display = '';
        if (!tabLoaded[tab]) { tabLoaded[tab] = true; tabLoaders[tab](); }
    }

    tabBtns.forEach(function(btn) {
        btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
    });

    // ===== 院校表格 =====
    var schoolsTable = document.getElementById('schools-table');
    var schoolsWrapper = document.getElementById('schools-panel-wrapper');
    var schoolsTbody = document.getElementById('schools-tbody');
    var schoolsEmpty = document.getElementById('schools-empty');

    function renderSchools(schools, studentCounts) {
        if (!schools || schools.length === 0) {
            schoolsWrapper.style.display = 'none';
            schoolsTbody.innerHTML = '';
            schoolsEmpty.style.display = 'flex';
            return;
        }
        schoolsEmpty.style.display = 'none';
        schoolsWrapper.style.display = '';
        schoolsTbody.innerHTML = schools.map(function(school) {
            var count = studentCounts[school.id] || 0;
            return '<tr>' +
                '<td>' + escapeHtml(school.name) + '</td>' +
                '<td>' + count + '</td>' +
                '<td>' +
                    '<button class="btn btn-secondary btn-sm btn-view-school" data-id="' + school.id + '">查看</button> ' +
                    '<button class="btn btn-secondary btn-sm btn-edit-school" data-id="' + school.id + '" data-name="' + escapeHtml(school.name) + '">编辑</button> ' +
                    '<button class="btn btn-danger btn-sm btn-del-school" data-id="' + school.id + '" data-name="' + escapeHtml(school.name) + '">删除</button>' +
                '</td></tr>';
        }).join('');
        bindSchoolActions();
    }

    function bindSchoolActions() {
        schoolsTbody.querySelectorAll('.btn-view-school').forEach(function(btn) {
            btn.addEventListener('click', function() { window.location.href = 'courses.html?school_id=' + btn.getAttribute('data-id'); });
        });
        schoolsTbody.querySelectorAll('.btn-edit-school').forEach(function(btn) {
            btn.addEventListener('click', function() { openEditSchoolModal(Number(btn.getAttribute('data-id')), btn.getAttribute('data-name')); });
        });
        schoolsTbody.querySelectorAll('.btn-del-school').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var name = btn.getAttribute('data-name');
                if (!confirm('确定要删除院校「' + name + '」吗？此操作不可撤销。')) return;
                btn.disabled = true; btn.textContent = '删除中…';
                API.delete('/schools/' + btn.getAttribute('data-id')).then(function() { loadSchools(); })
                    .catch(function(err) { alert('删除失败：' + (err.message || '未知错误')); btn.disabled = false; btn.textContent = '删除'; });
            });
        });
    }

    function loadSchools() {
        schoolsTbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:24px;color:#999;">加载中…</td></tr>';
        schoolsWrapper.style.display = '';
        schoolsEmpty.style.display = 'none';
        Promise.all([API.get('/schools/'), API.get('/admin/users')]).then(function(results) {
            var schools = results[0] || [];
            var users = results[1] || [];
            var studentCounts = {};
            schools.forEach(function(s) { studentCounts[s.id] = 0; });
            users.forEach(function(u) { if (u.role === 'student' && u.school_id && studentCounts.hasOwnProperty(u.school_id)) studentCounts[u.school_id]++; });
            renderSchools(schools, studentCounts);
        }).catch(function(err) {
            schoolsTbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#e74c3c;padding:24px;">' + escapeHtml('加载院校列表失败：' + (err.message || '未知错误')) + '</td></tr>';
        });
    }

    // ===== 添加院校弹窗 =====
    var schoolModalOverlay = document.getElementById('school-modal-overlay');
    var schoolNameInput = document.getElementById('school-modal-name');
    var schoolSaveBtn = document.getElementById('school-modal-save');
    var schoolCancelBtn = document.getElementById('school-modal-cancel');

    function openAddSchoolModal() { schoolNameInput.value = ''; schoolModalOverlay.style.display = 'flex'; }
    function closeAddSchoolModal() { schoolModalOverlay.style.display = 'none'; }
    document.getElementById('add-school-btn').addEventListener('click', openAddSchoolModal);
    schoolCancelBtn.addEventListener('click', closeAddSchoolModal);
    schoolModalOverlay.addEventListener('click', function(e) { if (e.target === schoolModalOverlay) closeAddSchoolModal(); });
    schoolSaveBtn.addEventListener('click', function() {
        var name = schoolNameInput.value.trim();
        if (!name) { alert('请输入院校名称'); return; }
        schoolSaveBtn.disabled = true; schoolSaveBtn.textContent = '提交中…';
        API.post('/schools/', { name: name }).then(function() { closeAddSchoolModal(); loadSchools(); })
            .catch(function(err) { alert('添加失败：' + (err.message || '未知错误')); })
            .then(function() { schoolSaveBtn.disabled = false; schoolSaveBtn.textContent = '提交'; });
    });

    // ===== 编辑院校弹窗 =====
    var editSchoolOverlay = document.getElementById('edit-school-modal-overlay');
    var editSchoolNameInput = document.getElementById('edit-school-modal-name');
    var editSchoolSaveBtn = document.getElementById('edit-school-modal-save');
    var editSchoolCancelBtn = document.getElementById('edit-school-modal-cancel');
    var editingSchoolId = null;

    function openEditSchoolModal(id, name) { editingSchoolId = id; editSchoolNameInput.value = name || ''; editSchoolOverlay.style.display = 'flex'; }
    function closeEditSchoolModal() { editSchoolOverlay.style.display = 'none'; editingSchoolId = null; }
    editSchoolCancelBtn.addEventListener('click', closeEditSchoolModal);
    editSchoolOverlay.addEventListener('click', function(e) { if (e.target === editSchoolOverlay) closeEditSchoolModal(); });
    editSchoolSaveBtn.addEventListener('click', function() {
        var name = editSchoolNameInput.value.trim();
        if (!name) { alert('请输入院校名称'); return; }
        editSchoolSaveBtn.disabled = true; editSchoolSaveBtn.textContent = '保存中…';
        API.put('/schools/' + editingSchoolId, { name: name }).then(function() { closeEditSchoolModal(); loadSchools(); })
            .catch(function(err) { alert('保存失败：' + (err.message || '未知错误')); })
            .then(function() { editSchoolSaveBtn.disabled = false; editSchoolSaveBtn.textContent = '保存'; });
    });

    // ===== 共享数据 =====
    var allSchools = [];
    var allClasses = [];
    var schoolMap = {};

    function loadSharedData() {
        return Promise.all([API.get('/schools/'), API.get('/classes/')]).then(function(results) {
            allSchools = results[0] || [];
            allClasses = results[1] || [];
            schoolMap = {};
            allSchools.forEach(function(s) { schoolMap[s.id] = s.name; });
        });
    }

    // ===== 班级表格 =====
    var classesTable = document.getElementById('classes-table');
    var classesWrapper = document.getElementById('classes-panel-wrapper');
    var classesTbody = document.getElementById('classes-tbody');
    var classesEmpty = document.getElementById('classes-empty');
    var filterSchool = document.getElementById('filter-school');

    function renderClasses(classes) {
        if (!classes || classes.length === 0) {
            classesWrapper.style.display = 'none';
            classesTbody.innerHTML = '';
            classesEmpty.style.display = 'flex';
            return;
        }
        classesEmpty.style.display = 'none';
        classesWrapper.style.display = '';
        classesTbody.innerHTML = classes.map(function(cls) {
            var schoolName = schoolMap[cls.school_id] || '-';
            var count = cls.student_count != null ? cls.student_count : '-';
            var date = formatDate(cls.created_at);
            return '<tr>' +
                '<td>' + escapeHtml(cls.name) + '</td>' +
                '<td>' + escapeHtml(schoolName) + '</td>' +
                '<td>' + count + '</td>' +
                '<td>' + date + '</td>' +
                '<td>' +
                    '<button class="btn btn-secondary btn-sm btn-view-students" data-id="' + cls.id + '" data-name="' + escapeHtml(cls.name) + '">查看学生</button> ' +
                    '<button class="btn btn-secondary btn-sm btn-edit-class" data-id="' + cls.id + '" data-name="' + escapeHtml(cls.name) + '">编辑</button> ' +
                    '<button class="btn btn-danger btn-sm btn-del-class" data-id="' + cls.id + '" data-name="' + escapeHtml(cls.name) + '">删除</button>' +
                '</td></tr>';
        }).join('');
        bindClassActions();
    }

    function filterClasses() {
        var schoolId = filterSchool.value;
        var filtered = allClasses;
        if (schoolId) {
            filtered = filtered.filter(function(c) {
                return String(c.school_id) === schoolId;
            });
        }
        renderClasses(filtered);
    }

    filterSchool.addEventListener('change', filterClasses);

    function bindClassActions() {
        classesTbody.querySelectorAll('.btn-view-students').forEach(function(btn) {
            btn.addEventListener('click', function() { openStudentsModal(btn.getAttribute('data-id'), btn.getAttribute('data-name')); });
        });
        classesTbody.querySelectorAll('.btn-edit-class').forEach(function(btn) {
            btn.addEventListener('click', function() { openEditClassModal(Number(btn.getAttribute('data-id')), btn.getAttribute('data-name')); });
        });
        classesTbody.querySelectorAll('.btn-del-class').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var name = btn.getAttribute('data-name');
                if (!confirm('确定要删除班级「' + name + '」吗？此操作不可撤销。')) return;
                btn.disabled = true; btn.textContent = '删除中…';
                API.delete('/classes/' + btn.getAttribute('data-id')).then(function() { loadClasses(); })
                    .catch(function(err) { alert('删除失败：' + (err.message || '未知错误')); btn.disabled = false; btn.textContent = '删除'; });
            });
        });
    }

    function loadClasses() {
        classesTbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:#999;">加载中…</td></tr>';
        classesWrapper.style.display = '';
        classesEmpty.style.display = 'none';
        loadSharedData().then(function() {
            return API.get('/classes/');
        }).then(function(classes) {
            allClasses = classes || [];
            // Populate filters
            var cs = filterSchool.value;
            filterSchool.innerHTML = '<option value="">全部院校</option>';
            allSchools.forEach(function(s) { var o = document.createElement('option'); o.value = s.id; o.textContent = s.name; filterSchool.appendChild(o); });
            filterSchool.value = cs;
            filterClasses();
        }).catch(function(err) {
            classesTbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#e74c3c;padding:24px;">' + escapeHtml('加载班级列表失败：' + (err.message || '未知错误')) + '</td></tr>';
        });
    }

    // ===== 添加班级弹窗 =====
    var classModalOverlay = document.getElementById('class-modal-overlay');
    var classNameInput = document.getElementById('class-modal-name');
    var classSchoolSelect = document.getElementById('class-modal-school');
    var classSaveBtn = document.getElementById('class-modal-save');
    var classCancelBtn = document.getElementById('class-modal-cancel');

    function openClassModal() {
        classNameInput.value = '';
        classSchoolSelect.innerHTML = '<option value="">加载中…</option>';
        classModalOverlay.style.display = 'flex';
        API.get('/schools/').then(function(schools) {
            schools = schools || [];
            classSchoolSelect.innerHTML = '<option value="">请选择学校</option>';
            if (schools.length === 0) { classSchoolSelect.innerHTML = '<option value="">请先创建学校</option>'; return; }
            schools.forEach(function(s) { var o = document.createElement('option'); o.value = s.id; o.textContent = s.name; classSchoolSelect.appendChild(o); });
        }).catch(function() { classSchoolSelect.innerHTML = '<option value="">加载学校失败</option>'; });
    }
    function closeClassModal() { classModalOverlay.style.display = 'none'; }
    document.getElementById('add-class-btn').addEventListener('click', openClassModal);
    classCancelBtn.addEventListener('click', closeClassModal);
    classModalOverlay.addEventListener('click', function(e) { if (e.target === classModalOverlay) closeClassModal(); });
    classSaveBtn.addEventListener('click', function() {
        var name = classNameInput.value.trim(); var schoolId = classSchoolSelect.value;
        if (!schoolId) { alert('请选择所属学校'); return; }
        if (!name) { alert('请输入班级名称'); return; }
        classSaveBtn.disabled = true; classSaveBtn.textContent = '提交中…';
        API.post('/classes/', { name: name, school_id: parseInt(schoolId) }).then(function() { closeClassModal(); loadClasses(); })
            .catch(function(err) { alert('添加失败：' + (err.message || '未知错误')); })
            .then(function() { classSaveBtn.disabled = false; classSaveBtn.textContent = '提交'; });
    });

    // ===== 编辑班级弹窗 =====
    var editClassOverlay = document.getElementById('edit-class-modal-overlay');
    var editClassNameInput = document.getElementById('edit-class-modal-name');
    var editClassSaveBtn = document.getElementById('edit-class-modal-save');
    var editClassCancelBtn = document.getElementById('edit-class-modal-cancel');
    var editingClassId = null;

    function openEditClassModal(id, name) { editingClassId = id; editClassNameInput.value = name || ''; editClassOverlay.style.display = 'flex'; }
    function closeEditClassModal() { editClassOverlay.style.display = 'none'; editingClassId = null; }
    editClassCancelBtn.addEventListener('click', closeEditClassModal);
    editClassOverlay.addEventListener('click', function(e) { if (e.target === editClassOverlay) closeEditClassModal(); });
    editClassSaveBtn.addEventListener('click', function() {
        var name = editClassNameInput.value.trim();
        if (!name) { alert('请输入班级名称'); return; }
        editClassSaveBtn.disabled = true; editClassSaveBtn.textContent = '保存中…';
        API.put('/classes/' + editingClassId, { name: name }).then(function() { closeEditClassModal(); loadClasses(); })
            .catch(function(err) { alert('保存失败：' + (err.message || '未知错误')); })
            .then(function() { editClassSaveBtn.disabled = false; editClassSaveBtn.textContent = '保存'; });
    });

    // ===== 查看学生弹窗 =====
    var studentsModalOverlay = document.getElementById('students-modal-overlay');
    var studentsModalTitle = document.getElementById('students-modal-title');
    var studentsModalTbody = document.getElementById('students-modal-tbody');
    var studentsModalClose = document.getElementById('students-modal-close');

    function openStudentsModal(classId, className) {
        studentsModalTitle.textContent = className + ' — 学生列表';
        studentsModalTbody.innerHTML = '<tr><td colspan="2" style="text-align:center;padding:16px;color:#999;">加载中…</td></tr>';
        studentsModalOverlay.style.display = 'flex';
        API.get('/classes/' + classId + '/students').then(function(students) {
            students = students || [];
            if (students.length === 0) { studentsModalTbody.innerHTML = '<tr><td colspan="2" style="text-align:center;padding:16px;color:#999;">该班级暂无学生</td></tr>'; return; }
            studentsModalTbody.innerHTML = '';
            students.forEach(function(s) {
                var tr = document.createElement('tr');
                tr.innerHTML = '<td>' + escapeHtml(s.username || s.account || '-') + '</td><td>' + escapeHtml(s.full_name || s.name || '-') + '</td>';
                studentsModalTbody.appendChild(tr);
            });
        }).catch(function(err) {
            studentsModalTbody.innerHTML = '<tr><td colspan="2" style="text-align:center;padding:16px;color:#e74c3c;">加载失败：' + escapeHtml(err.message || '未知错误') + '</td></tr>';
        });
    }
    function closeStudentsModal() { studentsModalOverlay.style.display = 'none'; }
    studentsModalClose.addEventListener('click', closeStudentsModal);
    studentsModalOverlay.addEventListener('click', function(e) { if (e.target === studentsModalOverlay) closeStudentsModal(); });

    // ===== 初始化 =====
    tabLoaded.schools = true;
    loadSchools();
})();
