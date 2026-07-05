// 认证管理模块
var Auth = {
    user: (function() {
        try {
            return JSON.parse(localStorage.getItem('user') || 'null');
        } catch (e) { return null; }
    })(),

    getToken: function() {
        return localStorage.getItem('access_token');
    },

    login: function(username, password) {
        var self = this;
        return API.post('/auth/login', {
            username: username,
            password: password
        }).then(function(data) {
            self.token = data.access_token;
            self.user = data.user;
            localStorage.setItem('access_token', data.access_token);
            localStorage.setItem('user', JSON.stringify(data.user));
            API.token = data.access_token;
            return data;
        });
    },

    logout: function() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('user');
        this.user = null;
        API.token = null;
        window.location.href = '/login.html';
    },

    requireAuth: function() {
        var token = this.getToken();
        if (!token || !this.user) {
            window.location.href = '/login.html';
            return false;
        }
        // 检查是否需要强制改密
        if (this.user.must_change_password) {
            this._showForceChangePassword();
        }
        return true;
    },

    requireRole: function() {
        var roles = Array.prototype.slice.call(arguments);
        if (!this.requireAuth()) return false;
        if (roles.length > 0 && roles.indexOf(this.user.role) === -1) {
            // admin 继承 teacher 权限：如果请求的角色包含 teacher，admin 也可访问
            if (this.user.role === 'admin' && roles.indexOf('teacher') !== -1) {
                return true;
            }
            // 角色不匹配，跳转到对应的 dashboard
            var dashMap = {
                'admin': '/admin/dashboard.html',
                'teacher': '/teacher/dashboard.html',
                'student': '/student/dashboard.html'
            };
            window.location.href = dashMap[this.user.role] || '/login.html';
            return false;
        }
        return true;
    },

    getDashboardUrl: function() {
        if (!this.user) return '/login.html';
        var map = {
            'admin': '/admin/dashboard.html',
            'teacher': '/teacher/dashboard.html',
            'student': '/student/dashboard.html'
        };
        return map[this.user.role] || '/login.html';
    },

    // 获取用户显示名
    getDisplayName: function() {
        if (!this.user) return '';
        if (this.user.role === 'admin') return this.user.username || '';
        return this.user.full_name || this.user.username || '';
    },

    // 强制修改密码弹窗
    // onSuccess: 可选回调，改密成功后执行（默认：移除弹窗）
    _showForceChangePassword: function(onSuccess) {
        // 防止重复注入
        if (document.getElementById('force-cp-overlay')) return;

        // 计算默认头像文字：取 full_name 或 username 的第一个字符
        var displayName = (Auth.user && (Auth.user.full_name || Auth.user.username)) || '?';
        var initialChar = displayName.charAt(0);

        var overlay = document.createElement('div');
        overlay.id = 'force-cp-overlay';
        overlay.innerHTML =
            '<div class="fcp-mask"></div>' +
            '<div class="fcp-dialog">' +
                '<h2 class="fcp-title">首次登录，请修改密码</h2>' +
                '<p class="fcp-desc">为保障账号安全，请先修改初始密码后继续使用系统。</p>' +
                '<div class="fcp-avatar-area">' +
                    '<div class="fcp-avatar-wrapper" id="fcpAvatarWrapper">' +
                        '<img class="fcp-avatar-img" id="fcpAvatarImg" src="" style="display:none">' +
                        '<div class="fcp-avatar-default" id="fcpAvatarDefault">' + initialChar + '</div>' +
                        '<div class="fcp-avatar-camera"><i data-lucide="camera"></i></div>' +
                        '<input type="file" id="fcpAvatarInput" accept="image/jpeg,image/png,image/gif,image/webp" style="display:none">' +
                    '</div>' +
                    '<p class="fcp-avatar-hint">点击更换头像</p>' +
                '</div>' +
                '<form id="fcpForm" onsubmit="return false;">' +
                    '<div class="fcp-field">' +
                        '<label class="fcp-label">新密码 <span style="color:red">*</span></label>' +
                        '<input type="password" class="fcp-input" id="fcpNewPw" placeholder="至少8位，含大小写字母和数字" autocomplete="new-password">' +
                    '</div>' +
                    '<div class="fcp-field">' +
                        '<label class="fcp-label">确认新密码 <span style="color:red">*</span></label>' +
                        '<input type="password" class="fcp-input" id="fcpConfirmPw" placeholder="再次输入新密码" autocomplete="new-password">' +
                    '</div>' +
                    '<div class="fcp-error" id="fcpError"></div>' +
                    '<button type="submit" class="fcp-submit" id="fcpSubmitBtn">确认修改</button>' +
                '</form>' +
            '</div>';
        document.body.appendChild(overlay);

        // 注入样式
        if (!document.getElementById('fcp-styles')) {
            var style = document.createElement('style');
            style.id = 'fcp-styles';
            style.textContent =
                '#force-cp-overlay{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;}' +
                '.fcp-mask{position:absolute;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);}' +
                '.fcp-dialog{position:relative;z-index:1;width:400px;max-width:92vw;background:#fff;border:3px solid #1d1d1d;border-radius:14px;box-shadow:5px 5px 0 #1d1d1d;padding:32px 28px 28px;max-height:90vh;overflow-y:auto;}' +
                '.fcp-title{font-size:1.25rem;font-weight:700;margin-bottom:6px;color:#1d1d1d;}' +
                '.fcp-desc{font-size:.85rem;color:#666;margin-bottom:18px;line-height:1.5;}' +
                '.fcp-avatar-area{text-align:center;margin-bottom:18px;}' +
                '.fcp-avatar-wrapper{position:relative;display:inline-block;cursor:pointer;width:80px;height:80px;}' +
                '.fcp-avatar-img,.fcp-avatar-default{width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid #1d1d1d;}' +
                '.fcp-avatar-default{display:flex;align-items:center;justify-content:center;background:#7ec8ff;color:#fff;font-size:2rem;font-weight:700;}' +
                '.fcp-avatar-camera{position:absolute;bottom:0;right:0;width:26px;height:26px;border-radius:50%;background:#1d1d1d;display:flex;align-items:center;justify-content:center;border:2px solid #fff;}' +
                '.fcp-avatar-camera i{width:14px;height:14px;color:#fff;}' +
                '.fcp-avatar-hint{font-size:.75rem;color:#999;margin-top:6px;}' +
                '.fcp-field{margin-bottom:14px;}' +
                '.fcp-label{display:block;font-size:.8rem;font-weight:600;margin-bottom:5px;color:#1d1d1d;}' +
                '.fcp-input{width:100%;padding:10px 12px;font-size:.9rem;border:2px solid #ddd;border-radius:10px;background:#fafaf7;color:#1d1d1d;outline:none;transition:border-color .2s;}' +
                '.fcp-input:focus{border-color:#7ec8ff;}' +
                '.fcp-error{color:#d4432e;font-size:.82rem;min-height:20px;margin-bottom:6px;}' +
                '.fcp-submit{width:100%;padding:12px;font-size:.95rem;font-weight:700;border:3px solid #1d1d1d;border-radius:10px;background:#ffe156;color:#1d1d1d;cursor:pointer;box-shadow:3px 3px 0 #1d1d1d;transition:all .15s;}' +
                '.fcp-submit:hover{transform:translate(-1px,-1px);box-shadow:5px 5px 0 #1d1d1d;}' +
                '.fcp-submit:active{transform:translate(1px,1px);box-shadow:none;}' +
                '.fcp-submit:disabled{opacity:.6;cursor:not-allowed;transform:none;box-shadow:3px 3px 0 #1d1d1d;}' +
                '[data-theme="dark"] .fcp-dialog{background:#1e1e1e;border-color:#555;box-shadow:5px 5px 0 #555;}' +
                '[data-theme="dark"] .fcp-title{color:#f0f0f0;}' +
                '[data-theme="dark"] .fcp-desc{color:#aaa;}' +
                '[data-theme="dark"] .fcp-avatar-default{background:#4a7fb5;}' +
                '[data-theme="dark"] .fcp-avatar-camera{background:#555;border-color:#333;}' +
                '[data-theme="dark"] .fcp-avatar-hint{color:#777;}' +
                '[data-theme="dark"] .fcp-label{color:#f0f0f0;}' +
                '[data-theme="dark"] .fcp-input{background:#2a2a2a;color:#f0f0f0;border-color:#555;}' +
                '[data-theme="dark"] .fcp-submit{background:#ffe156;color:#1d1d1d;border-color:#555;box-shadow:3px 3px 0 #555;}' +
                '[data-theme="dark"] .fcp-submit:hover{box-shadow:5px 5px 0 #555;}';
            document.head.appendChild(style);
        }

        // 如果用户已有头像，显示它
        if (Auth.user && Auth.user.avatar) {
            var imgEl = document.getElementById('fcpAvatarImg');
            var defEl = document.getElementById('fcpAvatarDefault');
            imgEl.src = Auth.user.avatar;
            imgEl.style.display = 'block';
            defEl.style.display = 'none';
        }

        // 渲染 lucide 图标
        if (typeof lucide !== 'undefined' && lucide.createIcons) {
            lucide.createIcons();
        }

        // 绑定头像点击事件
        var avatarWrapper = document.getElementById('fcpAvatarWrapper');
        var avatarInput = document.getElementById('fcpAvatarInput');
        avatarWrapper.addEventListener('click', function() {
            avatarInput.click();
        });

        avatarInput.addEventListener('change', function() {
            var file = this.files && this.files[0];
            if (!file) return;

            // 验证文件类型
            var allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
            if (allowedTypes.indexOf(file.type) === -1) {
                alert('仅支持 jpg/png/gif/webp 格式的图片');
                this.value = '';
                return;
            }

            // 验证文件大小（2MB）
            if (file.size > 2 * 1024 * 1024) {
                alert('图片大小不能超过 2MB');
                this.value = '';
                return;
            }

            // 本地预览
            var reader = new FileReader();
            reader.onload = function(e) {
                var imgEl = document.getElementById('fcpAvatarImg');
                var defEl = document.getElementById('fcpAvatarDefault');
                imgEl.src = e.target.result;
                imgEl.style.display = 'block';
                defEl.style.display = 'none';
            };
            reader.readAsDataURL(file);

            // 上传到服务器
            var formData = new FormData();
            formData.append('file', file);
            API.upload('/auth/upload-avatar', formData).then(function(data) {
                if (Auth.user) {
                    Auth.user.avatar = data.avatar_url;
                    localStorage.setItem('user', JSON.stringify(Auth.user));
                }
            }).catch(function(err) {
                alert(err.message || '头像上传失败，请重试');
            });

            this.value = '';
        });

        // 绑定表单提交，使用传入的回调
        var form = document.getElementById('fcpForm');
        form.addEventListener('submit', function() {
            Auth._submitForceChangePassword(onSuccess);
        });
    },

    // 提交强制改密（内部方法）
    _submitForceChangePassword: function(onSuccess) {
        var newPw = document.getElementById('fcpNewPw').value;
        var confirmPw = document.getElementById('fcpConfirmPw').value;
        var errEl = document.getElementById('fcpError');
        var btn = document.getElementById('fcpSubmitBtn');

        errEl.textContent = '';

        if (!newPw) { errEl.textContent = '请输入新密码'; return; }
        if (newPw.length < 8) { errEl.textContent = '新密码至少 8 位'; return; }
        if (!/[a-z]/.test(newPw)) { errEl.textContent = '新密码必须包含小写字母'; return; }
        if (!/[A-Z]/.test(newPw)) { errEl.textContent = '新密码必须包含大写字母'; return; }
        if (!/[0-9]/.test(newPw)) { errEl.textContent = '新密码必须包含数字'; return; }
        if (!confirmPw) { errEl.textContent = '请确认新密码'; return; }
        if (newPw !== confirmPw) { errEl.textContent = '两次输入的新密码不一致'; return; }

        btn.disabled = true;
        btn.textContent = '修改中…';

        API.post('/auth/change-password', {
            old_password: "123456",
            new_password: newPw
        }).then(function() {
            // 刷新用户信息
            return API.get('/auth/me');
        }).then(function(userData) {
            // 改密成功后退出登录，要求用新密码重新登录
            Auth.logout();
        }).catch(function(err) {
            btn.disabled = false;
            btn.textContent = '确认修改';
            errEl.textContent = err.message || '修改失败，请重试';
        });
    }
};
