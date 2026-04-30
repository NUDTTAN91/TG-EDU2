document.querySelectorAll('.submit-tab').forEach(function(b) {
  b.addEventListener('click', function() {
    var t = this.getAttribute('data-tab');
    document.querySelectorAll('.submit-tab').forEach(function(x) { x.classList.remove('active'); });
    this.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(function(p) { p.style.display = 'none'; });
    document.getElementById('tab-' + t).style.display = '';
  });
});

applyGreeting('.topbar h1', '李哲');

(function() {
  var nums = document.querySelectorAll('.cd-num');
  if (nums.length !== 3) return;
  var hh = parseInt(nums[0].textContent) || 0, mm = parseInt(nums[1].textContent) || 0, ss = parseInt(nums[2].textContent) || 0, total = hh * 3600 + mm * 60 + ss;
  setInterval(function() {
    if (total <= 0) return;
    total--;
    nums[0].textContent = String(Math.floor(total / 3600)).padStart(2, '0');
    nums[1].textContent = String(Math.floor(total % 3600 / 60)).padStart(2, '0');
    nums[2].textContent = String(total % 60).padStart(2, '0');
  }, 1000);
})();

