document.addEventListener('DOMContentLoaded', function() {
if (!Auth.requireRole('teacher')) return;

applyGreeting('.topbar h1', '老师');

});
