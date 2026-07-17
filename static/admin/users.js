// admin-users.js — 用户管理页面逻辑
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
        var y = d.getFullYear();
        var m = ('0' + (d.getMonth() + 1)).slice(-2);
        var day = ('0' + d.getDate()).slice(-2);
        return y + '-' + m + '-' + day;
    }

    function roleTag(role) {
        var map = {
            'admin':  { cls: 'tag-red',    text: '管理员' },
            'teacher': { cls: 'tag-blue',   text: '教师' },
            'student': { cls: 'tag-yellow', text: '学生' }
        };
        var info = map[role] || { cls: 'tag-blue', text: role || '未知' };
        return '<span class="tag ' + info.cls + '">' + escapeHtml(info.text) + '</span>';
    }

    var tbody = document.getElementById('users-tbody');
    var emptyRow = document.getElementById('users-empty');
    var schoolMap = {};

    function renderUsers(users) {
        tbody.innerHTML = '';
        if (!users || users.length === 0) {
            emptyRow.style.display = '';
            return;
        }
        emptyRow.style.display = 'none';
        users.forEach(function(u) {
            var schoolName = schoolMap[u.school_id] || (u.school_id ? '-' : '全局');
            var isAdmin = u.role === 'admin';
            var statusHtml = isAdmin
                ? '<span class="dot dot-green"></span> 活跃'
                : (u.is_active
                    ? '<span class="dot dot-green"></span> 活跃'
                    : '<span class="dot dot-yellow"></span> 禁用');
            var actionHtml;
            if (isAdmin) {
                actionHtml = '<span style="color:#999;font-size:0.85rem;">' + escapeHtml(u.username) + '</span>';
            } else {
                var toggleText = u.is_active ? '禁用' : '启用';
                var toggleColor = u.is_active ? '#e74c3c' : '#27ae60';
                actionHtml = '<button class="btn btn-secondary btn-toggle" data-id="' + u.id + '" style="color:' + toggleColor + '">' + toggleText + '</button>';
            }
            var displayName = escapeHtml(u.full_name || u.username);
            var avatarHtml;
            if (u.avatar) {
                avatarHtml = '<img src="' + escapeHtml(u.avatar) + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover;" alt="avatar">';
            } else if (isAdmin) {
                avatarHtml = '<img src="/TeamIco.svg" style="width:36px;height:36px;border-radius:50%;object-fit:cover;" alt="avatar">';
            } else {
                var name = u.full_name || u.username || '?';
                var firstLetter = escapeHtml(name.charAt(0).toUpperCase());
                avatarHtml = '<div style="width:36px;height:36px;border-radius:50%;background:#e0e0e0;display:flex;align-items:center;justify-content:center;font-weight:700;color:#666;font-size:0.9rem;">' + firstLetter + '</div>';
            }
            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td>' + avatarHtml + '</td>' +
                '<td>' + escapeHtml(u.username) + '</td>' +
                '<td><strong>' + displayName + '</strong></td>' +
                '<td>' + roleTag(u.role) + '</td>' +
                '<td>' + escapeHtml(schoolName) + '</td>' +
                '<td>' + escapeHtml(u.class_name || '-') + '</td>' +
                '<td>' + statusHtml + '</td>' +
                '<td>' + formatDate(u.created_at) + '</td>' +
                '<td>' + actionHtml + '</td>';
            tbody.appendChild(tr);
        });
        bindToggle();
    }

    function showError(msg) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#e74c3c;padding:24px;">' + escapeHtml(msg) + '</td></tr>';
    }

    // Filter state
    var allUsers = [];
    var filterSchool = '';
    var filterRole = '';
    var filterSearch = '';

    function applyFilters() {
        var filtered = allUsers.filter(function(u) {
            if (filterSchool && String(u.school_id) !== filterSchool) return false;
            if (filterRole && u.role !== filterRole) return false;
            if (filterSearch) {
                var q = filterSearch.toLowerCase();
                var name = (u.full_name || '').toLowerCase();
                var uname = (u.username || '').toLowerCase();
                if (name.indexOf(q) === -1 && uname.indexOf(q) === -1) return false;
            }
            return true;
        });
        renderUsers(filtered);
    }

    function loadUsers() {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:#999;">加载中…</td></tr>';
        Promise.all([
            API.get('/admin/users'),
            API.get('/schools/')
        ]).then(function(results) {
            allUsers = results[0] || [];
            var schools = results[1] || [];
            schoolMap = {};
            schools.forEach(function(s) { schoolMap[s.id] = s.name; });
            populateSchoolFilter(schools);
            populateModalSchools(schools);
            applyFilters();
        }).catch(function(err) {
            showError('加载用户列表失败：' + (err.message || '未知错误'));
        });
    }

    function populateSchoolFilter(schools) {
        var sel = document.getElementById('filter-school');
        if (!sel) return;
        sel.innerHTML = '<option value="">全部院校</option>';
        schools.forEach(function(s) {
            var opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            sel.appendChild(opt);
        });
    }

    // Filter event bindings
    var filterSchoolEl = document.getElementById('filter-school');
    var filterRoleEl = document.getElementById('filter-role');
    var filterSearchEl = document.getElementById('filter-search');

    if (filterSchoolEl) {
        filterSchoolEl.addEventListener('change', function() {
            filterSchool = this.value;
            applyFilters();
        });
    }
    if (filterRoleEl) {
        filterRoleEl.addEventListener('change', function() {
            filterRole = this.value;
            applyFilters();
        });
    }
    if (filterSearchEl) {
        filterSearchEl.addEventListener('input', function() {
            filterSearch = this.value.trim();
            applyFilters();
        });
    }

    function bindToggle() {
        var btns = tbody.querySelectorAll('.btn-toggle');
        btns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                var id = btn.getAttribute('data-id');
                btn.disabled = true;
                var origText = btn.textContent;
                btn.textContent = '处理中…';
                API.put('/admin/users/' + id + '/toggle').then(function() {
                    loadUsers();
                }).catch(function(err) {
                    alert('操作失败：' + (err.message || '未知错误'));
                    btn.disabled = false;
                    btn.textContent = origText;
                });
            });
        });
    }

    // --- Add User Modal ---
    var modalOverlay = document.getElementById('user-modal-overlay');
    var modalUsername = document.getElementById('user-modal-username');
    var modalFullname = document.getElementById('user-modal-fullname');
    var modalRole = document.getElementById('user-modal-role');
    var modalSchool = document.getElementById('user-modal-school');
    var schoolRow = document.getElementById('user-school-row');
    var modalClass = document.getElementById('user-modal-class');
    var classRow = document.getElementById('user-class-row');
    var modalSaveBtn = document.getElementById('user-modal-save');
    var modalCancelBtn = document.getElementById('user-modal-cancel');
    var addBtn = document.getElementById('add-user-btn');
    var schoolOptions = [];

    function openUserModal() {
        modalUsername.value = '';
        modalFullname.value = '';
        modalRole.value = '';
        modalSchool.value = '';
        modalClass.value = '';
        schoolRow.style.display = 'none';
        classRow.style.display = 'none';
        modalOverlay.style.display = 'flex';
    }

    function closeUserModal() {
        modalOverlay.style.display = 'none';
    }

    function populateModalSchools(schools) {
        schoolOptions = schools || [];
        modalSchool.innerHTML = '<option value="">请选择院校</option>';
        schoolOptions.forEach(function(s) {
            var opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            modalSchool.appendChild(opt);
        });
    }

    // Show/hide school and class selectors based on role
    modalRole.addEventListener('change', function() {
        var role = modalRole.value;
        if (role === 'student') {
            schoolRow.style.display = '';
            classRow.style.display = '';
        } else if (role === 'teacher') {
            schoolRow.style.display = '';
            classRow.style.display = 'none';
            modalClass.value = '';
        } else {
            schoolRow.style.display = 'none';
            classRow.style.display = 'none';
            modalSchool.value = '';
            modalClass.value = '';
        }
    });

    // Load classes when school changes (only for students)
    modalSchool.addEventListener('change', function() {
        var schoolId = modalSchool.value;
        modalClass.value = '';
        modalClass.innerHTML = '<option value="">请选择班级</option>';
        if (schoolId && modalRole.value === 'student') {
            API.get('/classes/?school_id=' + schoolId).then(function(classes) {
                (classes || []).forEach(function(cls) {
                    var opt = document.createElement('option');
                    opt.value = cls.id;
                    opt.textContent = cls.name;
                    modalClass.appendChild(opt);
                });
            });
        }
    });

    addBtn.addEventListener('click', function() {
        // Ensure school options are loaded
        if (schoolOptions.length === 0) {
            API.get('/schools/').then(function(schools) {
                populateModalSchools(schools);
                openUserModal();
            }).catch(function() {
                openUserModal();
            });
        } else {
            openUserModal();
        }
    });

    modalCancelBtn.addEventListener('click', closeUserModal);
    modalOverlay.addEventListener('click', function(e) {
        if (e.target === modalOverlay) closeUserModal();
    });

    modalSaveBtn.addEventListener('click', function() {
        var username = modalUsername.value.trim();
        var full_name = modalFullname.value.trim();
        var role = modalRole.value;
        var school_id = modalSchool.value;
        var class_id = modalClass.value;

        if (!username) { alert('请输入账号'); return; }
        if (!full_name) { alert('请输入姓名'); return; }
        if (!role) { alert('请选择角色'); return; }
        if ((role === 'teacher' || role === 'student') && !school_id) {
            alert('请选择所属院校'); return;
        }
        if (role === 'student' && !class_id) {
            alert('请选择所属班级'); return;
        }

        var payload = { username: username, full_name: full_name, role: role };
        if (school_id) payload.school_id = Number(school_id);
        if (class_id) payload.class_id = Number(class_id);

        modalSaveBtn.disabled = true;
        modalSaveBtn.textContent = '创建中…';
        API.post('/admin/users', payload).then(function() {
            closeUserModal();
            loadUsers();
        }).catch(function(err) {
            alert('创建用户失败：' + (err.message || '未知错误'));
        }).then(function() {
            modalSaveBtn.disabled = false;
            modalSaveBtn.textContent = '创建';
        });
    });

    // Preload school options for modal on page load
    API.get('/schools/').then(function(schools) {
        populateModalSchools(schools);
    }).catch(function() {});

    // ============================================================
    // 批量导入用户（xlsx）
    // ============================================================
    var importOverlay      = document.getElementById('import-modal-overlay');
    var importFileInput    = document.getElementById('import-modal-file');
    var importSubmitBtn    = document.getElementById('import-modal-submit');
    var importCancelBtn    = document.getElementById('import-modal-cancel');
    var importOpenBtn      = document.getElementById('import-users-btn');
    var importDlTplBtn     = document.getElementById('import-download-tpl-btn');
    var importErrorEl      = document.getElementById('import-error');
    var importResultEl     = document.getElementById('import-result');
    var importSummaryEl    = document.getElementById('import-result-summary');
    var importSkippedWrap  = document.getElementById('import-result-skipped-wrap');
    var importSkippedList  = document.getElementById('import-result-skipped');

    function resetImportModal() {
        importFileInput.value = '';
        importErrorEl.style.display = 'none';
        importErrorEl.textContent = '';
        importResultEl.style.display = 'none';
        importSkippedWrap.style.display = 'none';
        importSkippedList.innerHTML = '';
        importSummaryEl.textContent = '';
        importSubmitBtn.disabled = false;
        importSubmitBtn.textContent = '开始导入';
    }

    function openImportModal() {
        resetImportModal();
        importOverlay.style.display = 'flex';
    }

    function closeImportModal() {
        importOverlay.style.display = 'none';
    }

    function showImportError(msg) {
        importErrorEl.textContent = msg;
        importErrorEl.style.display = 'block';
    }

    if (importOpenBtn) importOpenBtn.addEventListener('click', openImportModal);
    if (importCancelBtn) importCancelBtn.addEventListener('click', closeImportModal);
    if (importOverlay) importOverlay.addEventListener('click', function(e) {
        if (e.target === importOverlay) closeImportModal();
    });

    if (importDlTplBtn) {
        importDlTplBtn.addEventListener('click', function() {
            importDlTplBtn.disabled = true;
            var origText = importDlTplBtn.innerHTML;
            importDlTplBtn.textContent = '下载中…';
            API.download('/admin/import-users/template', 'user-import-template.xlsx')
                .catch(function(err) {
                    showImportError('下载模板失败：' + (err.message || '未知错误'));
                })
                .then(function() {
                    importDlTplBtn.disabled = false;
                    importDlTplBtn.innerHTML = origText;
                    if (typeof lucide !== 'undefined') lucide.createIcons();
                });
        });
    }

    if (importSubmitBtn) {
        importSubmitBtn.addEventListener('click', function() {
            importErrorEl.style.display = 'none';
            importResultEl.style.display = 'none';

            var file = importFileInput.files && importFileInput.files[0];
            if (!file) { showImportError('请选择 xlsx 文件'); return; }
            if (!/\.xlsx$/i.test(file.name)) { showImportError('仅支持 .xlsx 格式'); return; }
            if (file.size > 2 * 1024 * 1024) { showImportError('文件过大，上限 2 MB'); return; }

            var fd = new FormData();
            fd.append('file', file);

            importSubmitBtn.disabled = true;
            importSubmitBtn.textContent = '导入中…';
            API.upload('/admin/import-users', fd).then(function(report) {
                var s  = (report && report.created_students) || 0;
                var t  = (report && report.created_teachers) || 0;
                var cs = (report && report.created_schools)  || 0;
                var cc = (report && report.created_classes)  || 0;
                var skipped = (report && report.skipped) || [];
                var parts = ['学生 ' + s + ' 人', '教师 ' + t + ' 人'];
                if (cs) parts.push('新建学校 ' + cs + ' 个');
                if (cc) parts.push('新建班级 ' + cc + ' 个');
                if (skipped.length) parts.push('跳过 ' + skipped.length + ' 行');
                importSummaryEl.textContent = '导入完成：' + parts.join('、');
                importResultEl.style.display = 'block';

                if (skipped.length) {
                    var html = '';
                    skipped.forEach(function(item) {
                        html += '• 第 ' + escapeHtml(String(item.row || '?')) + ' 行' +
                                (item.username ? '（' + escapeHtml(item.username) + '）' : '') +
                                '：' + escapeHtml(item.reason || '未知原因') + '<br>';
                    });
                    importSkippedList.innerHTML = html;
                    importSkippedWrap.style.display = 'block';
                } else {
                    importSkippedWrap.style.display = 'none';
                }

                importSubmitBtn.disabled = false;
                importSubmitBtn.textContent = '开始导入';

                // 刷新列表（保留弹窗展示报告让用户看）
                loadUsers();
                // 可能有新学校产生，刷新院校下拉缓存
                API.get('/schools/').then(function(schools) {
                    populateModalSchools(schools);
                }).catch(function() {});
            }).catch(function(err) {
                showImportError('导入失败：' + (err.message || '未知错误'));
                importSubmitBtn.disabled = false;
                importSubmitBtn.textContent = '开始导入';
            });
        });
    }

    loadUsers();
})();
