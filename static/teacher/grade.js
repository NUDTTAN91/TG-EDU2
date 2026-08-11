// 教师批改作业功能模块
document.addEventListener('DOMContentLoaded', function() {
  if (!Auth.requireRole('teacher')) return;

  // 状态变量
  var allSubmissions = [];
  var allAssignments = [];
  var currentSubmissionId = null;
  var currentFilter = 'all';

  // HTML 转义防 XSS
  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // 成绩校验
  function validateGrade(value) {
    var num = parseInt(value);
    if (isNaN(num) || num < 0 || num > 100) {
      return false;
    }
    return true;
  }

  // 加载数据
  function loadData() {
    API.get('/submissions/').then(function(data) {
      allSubmissions = data || [];
      return API.get('/assignments/');
    }).then(function(data) {
      allAssignments = data || [];
      renderSubmissionList();
      updateFilterStats();
      // 默认选中第一个待批改的
      selectFirstPending();
      maybePoll();
    }).catch(function(err) {
      console.error('加载数据失败:', err);
      showToast('加载提交数据失败，请刷新页面', 'error');
    });
  }

  // 构建作业 ID -> 标题的映射
  function getAssignmentMap() {
    var map = {};
    allAssignments.forEach(function(a) {
      map[a.id] = a.title;
    });
    return map;
  }

  // 渲染提交列表
  function renderSubmissionList() {
    var container = document.getElementById('studentItems');
    if (!container) return;

    var assignMap = getAssignmentMap();
    var filtered = allSubmissions.filter(function(s) {
      if (currentFilter === 'pending') return !s.grade && s.grade !== 0;
      if (currentFilter === 'graded') return s.grade !== null && s.grade !== undefined;
      return true;
    });

    if (filtered.length === 0) {
      container.innerHTML = '<div style="padding:24px;text-align:center;color:#aaa;font-size:.85rem">暂无提交</div>';
      return;
    }

    var colors = ['var(--sky)', 'var(--lime)', 'var(--yellow)', 'var(--lavender)', 'var(--pink)'];
    var html = '';

    filtered.forEach(function(s, idx) {
      var isGraded = s.grade !== null && s.grade !== undefined;
      var status = isGraded ? 'graded' : 'pending';
      var isActive = s.id === currentSubmissionId ? ' active' : '';
      var color = colors[idx % colors.length];
      var initial = (s.student_name || s.student_id || 'S').toString().charAt(0).toUpperCase();
      var assignTitle = assignMap[s.assignment_id] || '作业 #' + s.assignment_id;
      var timeStr = s.submitted_at ? formatTime(s.submitted_at) : '未知时间';
      var fileName = s.file_name || '';
      var ext = fileName.split('.').pop() || '';

      html += '<div class="s-item' + isActive + '" data-status="' + status + '" data-id="' + s.id + '" onclick="selectSubmission(' + s.id + ')">';
      html += '<div class="s-avatar" style="background:' + color + '">' + escapeHtml(initial) + '</div>';
      html += '<div class="s-info">';
      html += '<div class="s-name">' + escapeHtml(s.student_name || ('学生 ' + s.student_id)) + '</div>';
      html += '<div class="s-meta">' + escapeHtml(assignTitle) + ' · ' + escapeHtml(timeStr) + ' · ' + escapeHtml(ext) + '</div>';
      html += '</div>';
      html += '<div class="s-right">';
      if (s.status === 'queued') {
        html += '<span class="s-status" style="background:#ddd">排队中</span>';
      } else if (s.status === 'grading') {
        html += '<span class="s-status" style="background:var(--sky)">AI 批改中</span>';
      } else if (isGraded) {
        html += '<span class="s-score">' + s.grade + '</span>';
        html += '<span class="s-status" style="background:var(--lime)">已批</span>';
      } else {
        html += '<span class="s-status" style="background:var(--yellow)">待批</span>';
      }
      if (!isGraded && s.ai_suggested_grade !== null && s.ai_suggested_grade !== undefined) {
        html += '<span class="s-status" style="background:var(--lavender)">AI ' + s.ai_suggested_grade + '</span>';
      }
      if (isGraded && (s.graded_by === null || s.graded_by === undefined)) {
        html += '<span class="s-status" style="background:var(--lavender)">AI</span>';
      }
      html += '</div>';
      html += '</div>';
    });

    container.innerHTML = html;
  }

  // 选择提交
  window.selectSubmission = function(id) {
    currentSubmissionId = id;
    // 更新列表高亮
    document.querySelectorAll('.s-item').forEach(function(item) {
      item.classList.toggle('active', parseInt(item.getAttribute('data-id')) === id);
    });
    // 更新批改区域
    updateGradeArea(id);
  };

  // 更新批改区域
  function updateGradeArea(id) {
    var sub = null;
    for (var i = 0; i < allSubmissions.length; i++) {
      if (allSubmissions[i].id === id) { sub = allSubmissions[i]; break; }
    }
    if (!sub) return;

    var assignMap = getAssignmentMap();
    var assignTitle = assignMap[sub.assignment_id] || '作业 #' + sub.assignment_id;

    // 更新学生信息区
    var nameEl = document.querySelector('.grade-student-name');
    if (nameEl) nameEl.textContent = sub.student_name || ('学生 ' + sub.student_id);

    var metaEl = document.querySelector('.grade-student-meta');
    if (metaEl) {
      var timeStr = sub.submitted_at ? formatTime(sub.submitted_at) : '';
      metaEl.innerHTML = '<span style="color:#bbb">提交于 ' + escapeHtml(timeStr) + ' · ' + escapeHtml(sub.file_name || '') + '</span>';
    }

    // 更新文件预览
    var fileNameEl = document.querySelector('.file-preview .file-name');
    if (fileNameEl) {
      fileNameEl.innerHTML = '';
      var a = document.createElement('a');
      a.href = 'javascript:void(0)';
      a.style.color = '#58a6ff';
      a.style.textDecoration = 'underline';
      a.textContent = sub.file_name || '未知文件';
      a.onclick = function() {
        API.openSubmission(sub.id, sub.file_name || '').catch(function(err) {
          showToast('打开失败: ' + (err.message || '未知错误'), 'error');
        });
      };
      fileNameEl.appendChild(a);
    }

    var fileMetaEl = document.querySelector('.file-preview .file-meta');
    if (fileMetaEl) {
      var submitTime = sub.submitted_at ? formatTime(sub.submitted_at) : '';
      fileMetaEl.textContent = '提交于 ' + submitTime;
    }

    // 重置输入：已批用正式分；未批但有 AI 建议分时预填作参考
    var scoreInput = document.getElementById('scoreInput');
    var hasGrade = sub.grade !== null && sub.grade !== undefined;
    var hasAi = sub.ai_suggested_grade !== null && sub.ai_suggested_grade !== undefined;
    if (scoreInput) scoreInput.value = hasGrade ? sub.grade : (hasAi ? sub.ai_suggested_grade : '');

    var hint = document.getElementById('aiSuggestHint');
    if (hint) {
      if (!hasGrade && hasAi) {
        hint.style.display = '';
        hint.textContent = 'AI 建议 ' + sub.ai_suggested_grade + ' 分（仅参考，可修改；提交批改后才生效）';
      } else {
        hint.style.display = 'none';
        hint.textContent = '';
      }
    }

    var commentInput = document.getElementById('commentInput');
    if (commentInput) commentInput.value = sub.feedback || '';

    // 重置提交按钮
    var btn = document.getElementById('submitGrade');
    if (btn) {
      btn.textContent = '提交批改 →';
      btn.style.background = '';
      btn.disabled = false;
    }
    panelDirty = false;
  }

  // 选择第一个待批改
  function selectFirstPending() {
    for (var i = 0; i < allSubmissions.length; i++) {
      if (allSubmissions[i].grade === null || allSubmissions[i].grade === undefined) {
        window.selectSubmission(allSubmissions[i].id);
        return;
      }
    }
    // 如果没有待批改的，选第一个
    if (allSubmissions.length > 0) {
      window.selectSubmission(allSubmissions[0].id);
    }
  }

  // 更新过滤统计
  function updateFilterStats() {
    var pending = 0;
    var graded = 0;
    allSubmissions.forEach(function(s) {
      if (s.grade !== null && s.grade !== undefined) {
        graded++;
      } else {
        pending++;
      }
    });

    var statsEls = document.querySelectorAll('.filter-stat strong');
    if (statsEls.length >= 3) {
      statsEls[0].textContent = pending;
      statsEls[1].textContent = graded;
      statsEls[2].textContent = allSubmissions.length;
    }

    // 更新 progress-mini
    var progressEl = document.querySelector('.progress-mini strong');
    if (progressEl) progressEl.textContent = graded;
    var progressTotal = document.querySelector('.progress-mini');
    if (progressTotal) progressTotal.innerHTML = '<strong>' + graded + '</strong>/' + allSubmissions.length + ' 已批改';
  }

  // 过滤学生 - 全局函数
  window.filterStudents = function(btn, type) {
    currentFilter = type;
    document.querySelectorAll('.filter-tab').forEach(function(t) { t.classList.remove('active'); });
    btn.classList.add('active');
    renderSubmissionList();
  };

  // 设置分数 - 全局函数
  window.setScore = function(val) {
    document.getElementById('scoreInput').value = val;
    panelDirty = true;
  };

  // 添加评语 - 全局函数
  window.addComment = function(text) {
    var ta = document.getElementById('commentInput');
    ta.value = ta.value ? ta.value + '\n' + text : text;
    panelDirty = true;
  };

  // 提交批改 - 全局函数
  window.submitGrade = function() {
    if (!currentSubmissionId) {
      showToast('请先选择一份提交', 'error');
      return;
    }

    var scoreVal = document.getElementById('scoreInput').value;
    var feedbackVal = document.getElementById('commentInput').value;

    if (!validateGrade(scoreVal)) {
      showToast('请输入 0-100 之间的整数成绩', 'error');
      return;
    }

    var gradeNum = parseInt(scoreVal);
    var btn = document.getElementById('submitGrade');
    btn.textContent = '保存中…';
    btn.disabled = true;

    API.put('/submissions/' + currentSubmissionId + '/grade', {
      grade: gradeNum,
      feedback: feedbackVal
    }).then(function(result) {
      btn.textContent = '✓ 已保存';
      btn.style.background = 'var(--lime)';

      // 更新本地数据
      for (var i = 0; i < allSubmissions.length; i++) {
        if (allSubmissions[i].id === currentSubmissionId) {
          allSubmissions[i].grade = gradeNum;
          allSubmissions[i].feedback = feedbackVal;
          break;
        }
      }

      renderSubmissionList();
      updateFilterStats();

      setTimeout(function() {
        btn.textContent = '提交批改 →';
        btn.style.background = '';
        btn.disabled = false;
      }, 2000);

      showToast('批改已保存', 'success');
    }).catch(function(err) {
      btn.textContent = '提交批改 →';
      btn.disabled = false;
      showToast('保存失败: ' + (err.message || '未知错误'), 'error');
    });
  };

  // 跳过当前 - 全局函数
  window.skipStudent = function() {
    var items = document.querySelectorAll('.s-item:not([style*="display: none"])');
    var found = false;
    var nextId = null;
    items.forEach(function(item) {
      if (item.classList.contains('active') && !found) {
        found = true;
      } else if (found && !nextId) {
        nextId = parseInt(item.getAttribute('data-id'));
      }
    });
    // 如果没找到下一个，回到第一个
    if (!nextId && items.length > 0) {
      nextId = parseInt(items[0].getAttribute('data-id'));
    }
    if (nextId) {
      window.selectSubmission(nextId);
    }
  };

  // 更新过滤统计（全局）
  window.updateFilterStats = function() {
    updateFilterStats();
  };

  // ===== AI 批改队列 =====
  var panelDirty = false; // 教师正在编辑评语/分数时，轮询不覆盖面板
  window.aiEnqueue = function() {
    if (!currentSubmissionId) { showToast('请先选择一份提交', 'error'); return; }
    API.post('/ai-grading/' + currentSubmissionId + '/enqueue').then(function() {
      showToast('已加入 AI 批改队列', 'success');
      loadData();
    }).catch(function(err) {
      showToast('入队失败: ' + (err.message || '未知错误'), 'error');
    });
  };

  window.aiEnqueueAll = function() {
    API.post('/ai-grading/enqueue-pending').then(function(r) {
      showToast(r.message || '已入队', 'success');
      loadData();
    }).catch(function(err) {
      showToast('入队失败: ' + (err.message || '未知错误'), 'error');
    });
  };

  var pollTimer = null;
  function hasActiveAi() {
    return allSubmissions.some(function(s) { return s.status === 'queued' || s.status === 'grading'; });
  }
  function maybePoll() {
    if (hasActiveAi() && !pollTimer) {
      pollTimer = setInterval(silentReload, 5000);
    } else if (!hasActiveAi() && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }
  function silentReload() {
    API.get('/submissions/').then(function(data) {
      var prev = null;
      if (currentSubmissionId) {
        for (var j = 0; j < allSubmissions.length; j++) {
          if (allSubmissions[j].id === currentSubmissionId) { prev = allSubmissions[j]; break; }
        }
      }
      allSubmissions = data || [];
      renderSubmissionList();
      updateFilterStats();
      // 数据有变化且教师未正在编辑时，自动刷新批改区（AI 批完立即显示）
      if (currentSubmissionId && !panelDirty) {
        for (var i = 0; i < allSubmissions.length; i++) {
          var nw = allSubmissions[i];
          if (nw.id === currentSubmissionId) {
            if (!prev || prev.status !== nw.status || prev.grade !== nw.grade || prev.feedback !== nw.feedback) {
              updateGradeArea(currentSubmissionId);
            }
            break;
          }
        }
      }
      maybePoll();
    }).catch(function() {});
  }

  // 键盘快捷键
  document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.key === 'Enter') window.submitGrade();
  });

  // 教师编辑分数/评语时标记 dirty，轮询不覆盖
  document.getElementById('scoreInput').addEventListener('input', function() { panelDirty = true; });
  document.getElementById('commentInput').addEventListener('input', function() { panelDirty = true; });

  // 解析CST时间
  function parseCST(dateStr) {
    if (!dateStr) return new Date(NaN);
    var s = String(dateStr);
    if (s.length > 10 && s.indexOf('Z') === -1 && s.indexOf('+') === -1) s += '+08:00';
    return new Date(s);
  }
  function cstNow() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  }

  // 格式化时间
  function formatTime(dateStr) {
    try {
      var d = parseCST(dateStr);
      var now = cstNow();
      var diff = now - d;
      if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
      if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
      if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
      return d.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
    } catch (e) {
      return dateStr;
    }
  }

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

  // 启动
  loadData();
});
