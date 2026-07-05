// 教师布置作业功能模块

function parseCST(dateStr) {
  if (!dateStr) return new Date(NaN);
  var s = String(dateStr);
  if (s.length > 10 && s.indexOf('Z') === -1 && s.indexOf('+') === -1) s += '+08:00';
  return new Date(s);
}
function cstNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
}

document.addEventListener('DOMContentLoaded', function() {
  if (!Auth.requireRole('teacher')) return;

  var typeLabels = { homework: '课后作业', experiment: '实验报告', essay: '论文', project: '项目' };
  var currentType = 'homework';
  var coursesList = [];

  // HTML 转义防 XSS
  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // 加载课程列表
  function loadCourses() {
    API.get('/courses/').then(function(data) {
      coursesList = data || [];
      populateCourseSelect();
    }).catch(function(err) {
      console.error('加载课程列表失败:', err);
    });
  }

  // 填充课程下拉框
  function populateCourseSelect() {
    var select = document.getElementById('courseSelect');
    if (!select || coursesList.length === 0) return;

    // 清空现有选项
    select.innerHTML = '';

    coursesList.forEach(function(c) {
      var opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      select.appendChild(opt);
    });

    updatePreview();
  }

  // 选择作业类型
  window.selectType = function(el, type) {
    document.querySelectorAll('.type-card').forEach(function(c) { c.classList.remove('selected'); });
    el.classList.add('selected');
    currentType = type;
    var pvType = document.getElementById('pvType');
    if (pvType) pvType.textContent = typeLabels[type] || type;
  };

  // 切换班级选中
  window.toggleChip = function(el) {
    setTimeout(function() {
      var input = el.querySelector('input');
      el.classList.toggle('checked', input.checked);
      updatePreview();
    }, 0);
  };

  // 全选/取消全选
  window.toggleAll = function() {
    var chips = document.querySelectorAll('.chip');
    var allChecked = true;
    chips.forEach(function(c) {
      if (!c.classList.contains('checked')) allChecked = false;
    });
    chips.forEach(function(c) {
      var input = c.querySelector('input');
      input.checked = !allChecked;
      c.classList.toggle('checked', !allChecked);
    });
    updatePreview();
  };

  // 更新预览
  window.updatePreview = function() {
    var titleInput = document.getElementById('titleInput');
    var courseSelect = document.getElementById('courseSelect');
    var descInput = document.getElementById('descInput');
    var scoreInput = document.getElementById('scoreInput');
    var deadlineInput = document.getElementById('deadlineInput');
    var formatInput = document.getElementById('formatInput');

    var title = titleInput ? titleInput.value : '';
    var course = courseSelect ? courseSelect.value : '';
    var desc = descInput ? descInput.value : '';
    var score = scoreInput ? scoreInput.value : '';
    var deadline = deadlineInput ? deadlineInput.value : '';
    var format = formatInput ? formatInput.value : '';

    var pvTitle = document.getElementById('pvTitle');
    if (pvTitle) {
      pvTitle.textContent = title || '作业标题将显示在这里';
      pvTitle.style.color = title ? 'var(--ink)' : '#ccc';
    }

    var pvCourse = document.getElementById('pvCourse');
    if (pvCourse) pvCourse.textContent = '📚 ' + course;

    var pvScore = document.getElementById('pvScore');
    if (pvScore) pvScore.textContent = '💯 ' + (score || '—') + ' 分';

    var pvDeadline = document.getElementById('pvDeadline');
    if (pvDeadline) pvDeadline.textContent = deadline ? '⏰ ' + deadline.replace('T', ' ') : '⏰ 待设定截止时间';

    var pvDesc = document.getElementById('pvDesc');
    if (pvDesc) {
      pvDesc.textContent = desc || '在这里输入作业描述，学生会看到这段文字。可以写明要求、注意事项、参考资料等。';
      pvDesc.style.color = desc ? '#666' : '#bbb';
    }

    var pvFormat = document.getElementById('pvFormat');
    if (pvFormat) pvFormat.innerHTML = '<span class="preview-meta-item">' + escapeHtml(format || '不限') + '</span>';

    // 班级标签
    var checked = document.querySelectorAll('.chip.checked span:nth-child(2)');
    var pvClasses = document.getElementById('pvClasses');
    if (pvClasses) {
      var classHtml = '';
      checked.forEach(function(c) {
        classHtml += '<span class="preview-class-tag">' + escapeHtml(c.textContent) + '</span>';
      });
      pvClasses.innerHTML = classHtml || '<span class="preview-class-tag" style="color:#ccc">未选择班级</span>';
    }

    // 设置
    var toggles = document.querySelectorAll('.toggle-row');
    var pvSettings = document.getElementById('pvSettings');
    if (pvSettings) {
      var settings = [];
      toggles.forEach(function(row) {
        var toggle = row.querySelector('.toggle');
        if (toggle && toggle.classList.contains('on')) {
          settings.push(row.querySelector('.toggle-label').textContent);
        }
      });
      pvSettings.innerHTML = settings.map(function(s) {
        return '<span class="preview-setting">' + escapeHtml(s) + '</span>';
      }).join('') || '<span class="preview-setting" style="opacity:0.4">无特殊设置</span>';
    }
  };

  // 发布作业
  window.handlePublish = function() {
    var titleInput = document.getElementById('titleInput');
    var courseSelect = document.getElementById('courseSelect');
    var descInput = document.getElementById('descInput');
    var deadlineInput = document.getElementById('deadlineInput');

    var title = titleInput ? titleInput.value.trim() : '';
    var courseId = courseSelect ? courseSelect.value : '';
    var desc = descInput ? descInput.value.trim() : '';
    var deadline = deadlineInput ? deadlineInput.value : '';

    // 表单验证
    if (!title) {
      showToast('请输入作业标题', 'error');
      if (titleInput) titleInput.focus();
      return;
    }

    if (!courseId) {
      showToast('请选择所属课程', 'error');
      return;
    }

    if (deadline) {
      var deadlineDate = parseCST(deadline);
      var now = cstNow();
      if (deadlineDate < now) {
        showToast('截止时间不能设置为过去的时间', 'error');
        return;
      }
    }

    var btn = document.getElementById('publishBtn');
    if (btn) {
      btn.textContent = '发布中…';
      btn.disabled = true;
    }

    var payload = {
      title: title,
      description: desc,
      course_id: parseInt(courseId),
      deadline: deadline ? deadline + ':00' : null
    };

    API.post('/assignments/', payload).then(function(result) {
      if (btn) {
        btn.textContent = '✓ 已发布';
        btn.style.background = 'var(--lime)';
      }
      showToast('作业发布成功！', 'success');

      // 2秒后重置按钮
      setTimeout(function() {
        if (btn) {
          btn.textContent = '发布作业 →';
          btn.style.background = '';
          btn.disabled = false;
        }
      }, 3000);
    }).catch(function(err) {
      if (btn) {
        btn.textContent = '发布作业 →';
        btn.disabled = false;
      }
      showToast('发布失败: ' + (err.message || '未知错误'), 'error');
    });
  };

  // Toast 提示
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

  // 启动：加载课程列表
  loadCourses();
});
