document.addEventListener('DOMContentLoaded', function() {
    if (!Auth.requireRole('admin')) return;

    var currentCategory = 'all';

    function loadLogs(category) {
        var url = '/admin/logs/?page=1&page_size=100';
        if (category && category !== 'all') {
            url += '&category=' + category;
        }

        API.get(url).then(function(logs) {
            renderLogs(logs);
        }).catch(function(err) {
            document.getElementById('log-list').innerHTML =
                '<div style="text-align:center;padding:60px 0;color:#e74c3c;"><p>加载失败，请刷新重试</p></div>';
        });
    }

    function renderLogs(logs) {
        var container = document.getElementById('log-list');
        // 列宽策略：除详情外各列用 .log-col-fit 收缩到内容宽，
        // 剩余宽度全部留给 .log-col-detail（详情），详情内自动换行
        var thFit = 'class="log-col-fit" style="padding:10px 12px;text-align:left;border-bottom:2px solid #eee;"';
        var thDetail = 'class="log-col-detail" style="padding:10px 12px;text-align:left;border-bottom:2px solid #eee;"';
        var tdFit = 'class="log-col-fit" style="padding:10px 12px;border-bottom:1px solid #f0f0f0;"';
        var tdDetail = 'class="log-col-detail" style="padding:10px 12px;border-bottom:1px solid #f0f0f0;"';
        if (!logs || logs.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:60px 20px;color:#999">'
                + '<div style="font-size:1rem;margin-bottom:6px">暂无操作日志数据</div>'
                + '</div>';
            return;
        }

        var html = '<table class="data-table" style="width:100%;border-collapse:collapse;">';
        html += '<thead><tr>';
        html += '<th ' + thFit + '>时间</th>';
        html += '<th ' + thFit + '>姓名</th>';
        html += '<th ' + thFit + '>班级</th>';
        html += '<th ' + thFit + '>学校</th>';
        html += '<th ' + thFit + '>操作类型</th>';
        html += '<th ' + thFit + '>操作人</th>';
        html += '<th ' + thDetail + '>详情</th>';
        html += '<th ' + thFit + '>IP地址</th>';
        html += '</tr></thead><tbody>';

        logs.forEach(function(log) {
            var categoryLabel = getCategoryLabel(log.category);
            // 超级管理员操作：优先用后端返回的操作者角色；
            // 后端镜像未重建（响应无 role 字段）时回退：本系统超管账号唯一，
            // 用当前登录超管的 username 比对。后端升级后该回退自动失效
            var roleKnown = !(log.role === null || log.role === undefined);
            var isAdmin = roleKnown
                ? log.role === 'admin'
                : (typeof Auth !== 'undefined' && Auth.user && Auth.user.role === 'admin'
                    && log.username === Auth.user.username);
            // AI 自动操作：AI worker 自身产生的日志（无操作人）；
            // 人工触发的入队日志仍归属触发者，不打 AI 标
            var isAiAuto = log.category === 'ai_grading'
                && (log.user_id === null || log.user_id === undefined);
            var rowClass = isAdmin ? 'log-row-admin' : (isAiAuto ? 'log-row-ai' : '');
            html += '<tr' + (rowClass ? ' class="' + rowClass + '"' : '') + '>';
            html += '<td ' + tdFit + '>' + formatDate(log.created_at) + '</td>';
            html += '<td ' + tdFit + '>' + escapeHtml(log.full_name || '-') + '</td>';
            html += '<td ' + tdFit + '>' + escapeHtml(log.class_name || '-') + '</td>';
            html += '<td ' + tdFit + '>' + escapeHtml(log.school_name || '-') + '</td>';
            html += '<td ' + tdFit + '><span class="log-tag log-' + log.category + '">' + categoryLabel + '</span>'
                + (isAiAuto ? '<span class="log-badge log-badge-ai">AI 自动</span>' : '') + '</td>';
            html += '<td ' + tdFit + '>' + escapeHtml(log.username || '-')
                + (isAdmin ? '<span class="log-badge log-badge-admin">超管</span>' : '') + '</td>';
            html += '<td ' + tdDetail + '>' + escapeHtml(log.detail || '-') + '</td>';
            html += '<td ' + tdFit + '>' + (log.ip_address || '-') + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    function getCategoryLabel(cat) {
        var map = {
            login: '登录',
            submission: '作业提交',
            password: '密码修改',
            ai_grading: 'AI 批改',
            user_management: '用户管理',
            system_settings: '系统设置',
            school_management: '院校管理'
        };
        return map[cat] || cat;
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
        // 显示到秒：同一分钟内的多条日志（如重交 + 自动 AI 入队）才能看出先后
        return d.getFullYear() + '-'
            + String(d.getMonth() + 1).padStart(2, '0') + '-'
            + String(d.getDate()).padStart(2, '0') + ' '
            + String(d.getHours()).padStart(2, '0') + ':'
            + String(d.getMinutes()).padStart(2, '0') + ':'
            + String(d.getSeconds()).padStart(2, '0');
    }

    // 过滤按钮事件
    var filterBtns = document.querySelectorAll('.log-filter-btn');
    filterBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            filterBtns.forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            currentCategory = btn.getAttribute('data-category') || 'all';
            loadLogs(currentCategory);
        });
    });

    // 初始加载
    loadLogs('all');
});
