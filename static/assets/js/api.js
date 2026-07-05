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
    }
};
