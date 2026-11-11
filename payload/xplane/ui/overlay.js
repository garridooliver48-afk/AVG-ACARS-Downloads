'use strict';
window.avgOverlay.listen(({ title, detail, type }) => {
  document.getElementById('notice').className = 'notice ' + type;
  document.getElementById('title').textContent = title;
  document.getElementById('detail').textContent = detail;
});
