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
        if (!logs || logs.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:60px 20px;color:#999">'
                + '<div style="font-size:1rem;margin-bottom:6px">暂无操作日志数据</div>'
                + '</div>';
            return;
        }

        var html = '<table class="data-table" style="width:100%;border-collapse:collapse;">';
        html += '<thead><tr>';
        html += '<th style="padding:10px 12px;text-align:left;border-bottom:2px solid #eee;">时间</th>';
        html += '<th style="padding:10px 12px;text-align:left;border-bottom:2px solid #eee;">姓名</th>';
        html += '<th style="padding:10px 12px;text-align:left;border-bottom:2px solid #eee;">操作类型</th>';
        html += '<th style="padding:10px 12px;text-align:left;border-bottom:2px solid #eee;">操作人</th>';
        html += '<th style="padding:10px 12px;text-align:left;border-bottom:2px solid #eee;">详情</th>';
        html += '<th style="padding:10px 12px;text-align:left;border-bottom:2px solid #eee;">IP地址</th>';
        html += '</tr></thead><tbody>';

        logs.forEach(function(log) {
            var categoryLabel = getCategoryLabel(log.category);
            html += '<tr>';
            html += '<td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;white-space:nowrap;">' + formatDate(log.created_at) + '</td>';
            html += '<td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;">' + escapeHtml(log.full_name || '-') + '</td>';
            html += '<td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;"><span class="log-tag log-' + log.category + '">' + categoryLabel + '</span></td>';
            html += '<td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;">' + (log.username || '-') + '</td>';
            html += '<td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;">' + (log.detail || '-') + '</td>';
            html += '<td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;">' + (log.ip_address || '-') + '</td>';
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
        return d.getFullYear() + '-'
            + String(d.getMonth() + 1).padStart(2, '0') + '-'
            + String(d.getDate()).padStart(2, '0') + ' '
            + String(d.getHours()).padStart(2, '0') + ':'
            + String(d.getMinutes()).padStart(2, '0');
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
