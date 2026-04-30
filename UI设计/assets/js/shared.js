/* ===== Shared JavaScript Utilities ===== */

/**
 * Initialize scroll-reveal animation for all .anim elements
 */
function initScrollReveal() {
  document.querySelectorAll('.anim').forEach(function (el) {
    var io = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) { el.classList.add('show'); io.disconnect(); }
    }, { threshold: 0.1 });
    io.observe(el);
  });
}

/**
 * Get time-based greeting string
 * @returns {string} greeting text
 */
function getTimeGreeting() {
  var h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 12) return '早上好';
  if (h < 14) return '中午好';
  if (h >= 18) return '晚上好';
  return '下午好';
}

/**
 * Apply greeting to a DOM element
 * @param {string} selector - CSS selector for target element
 * @param {string} [name] - optional name to append
 */
function applyGreeting(selector, name) {
  var el = document.querySelector(selector);
  if (el) {
    el.innerHTML = '<span class="wave">👋</span> ' + getTimeGreeting() + (name ? '，' + name : '');
  }
}

/* ===== Theme Toggle ===== */

/**
 * Initialize theme from localStorage or system preference
 */
function initTheme() {
  var saved = localStorage.getItem('theme');
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
}

/**
 * Toggle between light and dark theme
 */
function toggleTheme() {
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('theme', 'dark');
  }
  updateThemeIcon();
}

/**
 * Update the toggle button icon based on current theme
 */
function updateThemeIcon() {
  var btn = document.getElementById('themeToggle');
  if (!btn) return;
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  btn.textContent = isDark ? '☀️' : '🌙';
  btn.title = isDark ? '切换到亮色模式' : '切换到暗色模式';
}

/**
 * Inject theme toggle button into the page
 */
function injectThemeToggle() {
  var btn = document.createElement('button');
  btn.id = 'themeToggle';
  btn.className = 'theme-toggle';
  btn.onclick = toggleTheme;
  document.body.appendChild(btn);
  updateThemeIcon();
}

// Auto-init on DOM ready
document.addEventListener('DOMContentLoaded', function () {
  initTheme();
  injectThemeToggle();
  initScrollReveal();
  lucide.createIcons();
});
