// API 客户端 — 统一 HTTP 请求封装
var API = {
    baseURL: '/api',
    token: localStorage.getItem('access_token'),

    request: function(method, path, data, options) {
        options = options || {};
        var headers = { 'Content-Type': 'application/json' };
        if (this.token) {
            headers['Authorization'] = 'Bearer ' + this.token;
        }

        var config = {
            method: method,
            headers: headers
        };

        // 合并 options
        for (var key in options) {
            if (options.hasOwnProperty(key)) {
                config[key] = options[key];
            }
        }

        if (data !== undefined && data !== null) {
            config.body = JSON.stringify(data);
        }

        var self = this;
        return fetch(this.baseURL + path, config).then(function(response) {
            if (response.status === 401) {
                self.token = null;
                localStorage.removeItem('access_token');
                localStorage.removeItem('user');
                window.location.href = '/login.html';
                throw new Error('未授权，请重新登录');
            }

            if (!response.ok) {
                var errorMsg = '请求失败 (' + response.status + ')';
                return response.json().then(function(errData) {
                    if (errData.detail) errorMsg = errData.detail;
                    throw new Error(errorMsg);
                }).catch(function(err) {
                    if (err.message && err.message !== errorMsg) throw err;
                    throw new Error(errorMsg);
                });
            }

            // 204 No Content 或空响应
            return response.text().then(function(text) {
                if (!text) return null;
                return JSON.parse(text);
            });
        });
    },

    get: function(path) { return this.request('GET', path); },
    post: function(path, data) { return this.request('POST', path, data); },
    put: function(path, data) { return this.request('PUT', path, data); },
    delete: function(path) { return this.request('DELETE', path); },

    upload: function(path, formData) {
        var headers = {};
        if (this.token) {
            headers['Authorization'] = 'Bearer ' + this.token;
        }
        // 不设置 Content-Type，让浏览器自动设置 multipart boundary
        var self = this;
        return fetch(this.baseURL + path, {
            method: 'POST',
            headers: headers,
            body: formData
        }).then(function(response) {
            if (response.status === 401) {
                self.token = null;
                localStorage.removeItem('access_token');
                localStorage.removeItem('user');
                window.location.href = '/login.html';
                throw new Error('未授权，请重新登录');
            }
            if (!response.ok) {
                var errorMsg = '上传失败';
                return response.json().then(function(errData) {
                    if (errData.detail) errorMsg = errData.detail;
                    throw new Error(errorMsg);
                }).catch(function(err) {
                    if (err.message && err.message !== errorMsg) throw err;
                    throw new Error(errorMsg);
                });
            }
            return response.json();
        });
    },

    // XHR 版上传，支持进度回调与自定义 method（POST/PUT）
    // onProgress(percent, loaded, total) 可选
    uploadWithProgress: function(path, formData, onProgress, method) {
        method = method || 'POST';
        var self = this;
        return new Promise(function(resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open(method, self.baseURL + path, true);
            if (self.token) {
                xhr.setRequestHeader('Authorization', 'Bearer ' + self.token);
            }
            if (typeof onProgress === 'function' && xhr.upload) {
                xhr.upload.onprogress = function(e) {
                    if (e.lengthComputable) {
                        var pct = Math.round(e.loaded / e.total * 100);
                        onProgress(pct, e.loaded, e.total);
                    }
                };
            }
            xhr.onload = function() {
                if (xhr.status === 401) {
                    self.token = null;
                    localStorage.removeItem('access_token');
                    localStorage.removeItem('user');
                    window.location.href = '/login.html';
                    reject(new Error('未授权，请重新登录'));
                    return;
                }
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        resolve(xhr.responseText ? JSON.parse(xhr.responseText) : null);
                    } catch (e) {
                        resolve(null);
                    }
                    return;
                }
                var msg = '上传失败 (' + xhr.status + ')';
                try {
                    var errData = JSON.parse(xhr.responseText || '{}');
                    if (errData.detail) {
                        if (typeof errData.detail === 'string') msg = errData.detail;
                        else msg = JSON.stringify(errData.detail);
                    }
                } catch (e) { /* keep default */ }
                reject(new Error(msg));
            };
            xhr.onerror = function() { reject(new Error('网络错误，上传失败')); };
            xhr.onabort = function() { reject(new Error('上传已取消')); };
            xhr.send(formData);
        });
    },

    // 可在线预览的扩展名（与后端 PREVIEW_MEDIA_TYPES 白名单保持一致）
    previewExts: { pdf: 1, png: 1, jpg: 1, jpeg: 1, gif: 1, bmp: 1, txt: 1, md: 1 },

    // 在线预览：新标签页内嵌渲染（PDF 走浏览器阅读器，图片/文本直接展示）。
    // 注意：window.open 必须在点击手势内同步调用，否则会被弹窗拦截，
    // 因此先同步开一个 about:blank，拉到 blob 后再把新窗口导航过去。
    preview: function(path) {
        var self = this;
        var win = window.open('about:blank', '_blank');
        if (!win) {
            return Promise.reject(new Error('浏览器拦截了新窗口，请允许弹窗后重试'));
        }
        var headers = {};
        if (this.token) {
            headers['Authorization'] = 'Bearer ' + this.token;
        }
        return fetch(this.baseURL + path, { method: 'GET', headers: headers }).then(function(response) {
            if (response.status === 401) {
                self.token = null;
                localStorage.removeItem('access_token');
                localStorage.removeItem('user');
                window.location.href = '/login.html';
                throw new Error('未授权，请重新登录');
            }
            if (!response.ok) {
                return response.json().then(function(errData) {
                    throw new Error((errData && errData.detail) || ('预览失败 (' + response.status + ')'));
                }).catch(function(err) {
                    if (err && err.message) throw err;
                    throw new Error('预览失败 (' + response.status + ')');
                });
            }
            return response.blob();
        }).then(function(blob) {
            var url = URL.createObjectURL(blob);
            win.location.href = url;
            // 新标签页可能延迟分页加载，延迟回收 objectURL；页面关闭后自然释放
            setTimeout(function() { URL.revokeObjectURL(url); }, 10 * 60 * 1000);
            return url;
        }).catch(function(err) {
            try { win.close(); } catch (e) { /* ignore */ }
            throw err;
        });
    },

    // 提交文件智能打开：可预览格式 → 新标签页在线预览；其余 → 鉴权下载
    openSubmission: function(submissionId, fileName) {
        var ext = ((fileName || '').split('.').pop() || '').toLowerCase();
        if (this.previewExts[ext]) {
            return this.preview('/submissions/' + submissionId + '/preview');
        }
        return this.download('/submissions/' + submissionId + '/download', fileName || '');
    },

    // 鉴权下载：带 Bearer 的 fetch → blob → 触发 <a download> 点击
    download: function(path, filename) {
        var self = this;
        var headers = {};
        if (this.token) {
            headers['Authorization'] = 'Bearer ' + this.token;
        }
        return fetch(this.baseURL + path, { method: 'GET', headers: headers }).then(function(response) {
            if (response.status === 401) {
                self.token = null;
                localStorage.removeItem('access_token');
                localStorage.removeItem('user');
                window.location.href = '/login.html';
                throw new Error('未授权，请重新登录');
            }
            if (!response.ok) {
                return response.json().then(function(errData) {
                    throw new Error((errData && errData.detail) || ('下载失败 (' + response.status + ')'));
                }).catch(function(err) {
                    if (err && err.message) throw err;
                    throw new Error('下载失败 (' + response.status + ')');
                });
            }
            return response.blob().then(function(blob) {
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = filename || 'download';
                document.body.appendChild(a);
                a.click();
                setTimeout(function() {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 100);
            });
        });
    }
};
