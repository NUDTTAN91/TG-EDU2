// 系统设置页：AI 批改设置（加载/保存/连通性测试）
document.addEventListener('DOMContentLoaded', function () {
    if (!Auth.requireRole('admin')) return;

    function toast(msg, type) {
        var existing = document.querySelector('.toast-msg');
        if (existing) existing.parentNode.removeChild(existing);
        var t = document.createElement('div');
        t.className = 'toast-msg';
        t.textContent = msg;
        t.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);' +
            'padding:10px 24px;border-radius:8px;font-size:.85rem;z-index:9999;' +
            'box-shadow:0 4px 12px rgba(0,0,0,.15);transition:opacity .3s;' +
            (type === 'error' ? 'background:#e07a5f;color:#fff;' : 'background:#3fb950;color:#fff;');
        document.body.appendChild(t);
        setTimeout(function () {
            t.style.opacity = '0';
            setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
        }, 3000);
    }

    var keyInput = document.getElementById('aiKeyInput');
    var eyeBtn = document.getElementById('aiKeyEyeBtn');
    var baseInput = document.getElementById('aiBaseUrlInput');
    var docSel = document.getElementById('aiDocModelSelect');
    var textSel = document.getElementById('aiTextModelSelect');
    var thinkToggle = document.getElementById('aiThinkingToggle');
    var testBtn = document.getElementById('aiTestBtn');
    var testResult = document.getElementById('aiTestResult');

    eyeBtn.addEventListener('click', function () {
        keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
        eyeBtn.textContent = keyInput.type === 'password' ? '显示' : '隐藏';
    });
    thinkToggle.addEventListener('click', function () {
        thinkToggle.classList.toggle('on');
    });

    function load() {
        API.get('/admin/settings/ai').then(function (d) {
            baseInput.value = d.base_url || '';
            docSel.value = d.doc_model || 'mimo-v2.5';
            textSel.value = d.text_model || 'mimo-v2.5-pro';
            thinkToggle.classList.toggle('on', !!d.thinking);
            keyInput.value = '';
            keyInput.placeholder = d.key_set ? ('已配置 ' + d.key_masked + '，留空保持') : '未配置';
        }).catch(function (err) {
            toast('加载 AI 设置失败：' + (err.message || err), 'error');
        });
    }

    document.getElementById('saveSettingsBtn').addEventListener('click', function () {
        API.put('/admin/settings/ai', {
            ai_base_url: baseInput.value.trim(),
            ai_api_key: keyInput.value,
            ai_doc_model: docSel.value,
            ai_text_model: textSel.value,
            ai_thinking: thinkToggle.classList.contains('on')
        }).then(function () {
            toast('AI 设置已保存', 'success');
            load();
        }).catch(function (err) {
            toast('保存失败：' + (err.message || err), 'error');
        });
    });

    testBtn.addEventListener('click', function () {
        testResult.textContent = '测试中…';
        API.post('/admin/settings/ai/test', {
            ai_base_url: baseInput.value.trim() || undefined,
            ai_api_key: keyInput.value || undefined,
            ai_doc_model: docSel.value,
            ai_text_model: textSel.value
        }).then(function (results) {
            testResult.innerHTML = (results || []).map(function (r) {
                return '<div>' + (r.ok ? '✓ ' : '✗ ') + r.model + '：' + r.detail + '</div>';
            }).join('');
        }).catch(function (err) {
            testResult.textContent = '测试失败：' + (err.message || err);
        });
    });

    load();
});
