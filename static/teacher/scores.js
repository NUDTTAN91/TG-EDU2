document.addEventListener('DOMContentLoaded', function() {
if (!Auth.requireRole('teacher')) return;

function switchView(view, btn) {
  document.querySelectorAll('.view-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  document.getElementById('tableView').classList.toggle('active', view === 'table');
  document.getElementById('cardView').classList.toggle('active', view === 'card');
  if (view === 'table') { document.getElementById('tableView').style.display = ''; document.getElementById('cardView').style.display = 'none'; }
  else { document.getElementById('tableView').style.display = 'none'; document.getElementById('cardView').style.display = ''; }
}

// Score color coding
document.querySelectorAll('.score-cell').forEach(function(cell) {
  var val = parseInt(cell.textContent);
  if (isNaN(val)) { cell.classList.add('none'); return; }
  if (val >= 85) cell.classList.add('high');
  else if (val >= 70) cell.classList.add('mid');
  else cell.classList.add('low');
});

});
