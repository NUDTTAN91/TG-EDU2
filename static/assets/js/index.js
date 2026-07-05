// Scroll reveal, greeting & base animations handled by shared.js

// Counter
const counters = document.querySelectorAll('[data-count]');
counters.forEach(counter => {
  const target = +counter.dataset.count;
  const cio = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) {
      const start = performance.now();
      (function tick(now) {
        const p = Math.min((now - start) / 1500, 1);
        counter.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))).toLocaleString();
        if (p < 1) requestAnimationFrame(tick);
      })(performance.now());
      cio.disconnect();
    }
  }, { threshold: 0.5 });
  cio.observe(counter);
});

// Toast notification - appears after 3s
setTimeout(() => {
  document.getElementById('toast').classList.add('show');
}, 3000);

// Mouse parallax on hero cards
const heroRight = document.querySelector('.hero-right');
if (heroRight) {
  heroRight.addEventListener('mousemove', (e) => {
    const rect = heroRight.getBoundingClientRect();
    const x = (e.clientX - rect.left - rect.width / 2) / rect.width;
    const y = (e.clientY - rect.top - rect.height / 2) / rect.height;
    const cards = heroRight.querySelectorAll('.float-card');
    cards.forEach((card, i) => {
      const factor = (i + 1) * 4;
      card.style.translate = `${x * factor}px ${y * factor}px`;
    });
  });
  heroRight.addEventListener('mouseleave', () => {
    heroRight.querySelectorAll('.float-card').forEach(card => {
      card.style.translate = '';
    });
  });
}

// Rotate toast messages
const toastMessages = [
  { icon: '📬', text: '有同学刚刚提交了一份作业', sub: '登录后查看动态' },
  { icon: '⏰', text: '系统会在截止前自动提醒你', sub: '不用担心忘交' },
];
let toastIdx = 0;
setInterval(() => {
  const toast = document.getElementById('toast');
  toast.classList.remove('show');
  setTimeout(() => {
    toastIdx = (toastIdx + 1) % toastMessages.length;
    const msg = toastMessages[toastIdx];
    toast.querySelector('.toast-icon').textContent = msg.icon;
    toast.querySelector('.toast-text').innerHTML = msg.text + '<br><span style="color:#999; font-size:0.75rem;">' + msg.sub + '</span>';
    toast.classList.add('show');
  }, 500);
}, 8000);
