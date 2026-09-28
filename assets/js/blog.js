(function () {
  var grid = document.getElementById('post-grid');
  if (!grid) return;

  var cards = Array.prototype.slice.call(grid.querySelectorAll('.entry'));
  var chips = document.querySelectorAll('.tab');
  var search = document.getElementById('post-search');
  var empty = document.getElementById('post-empty');
  var state = { cat: 'all', q: '' };

  // Bỏ dấu tiếng Việt để tìm "kinh nghiem" vẫn ra "kinh nghiệm"
  var normalize = function (s) {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  };
  cards.forEach(function (c) { c._text = normalize(c.getAttribute('data-search') || ''); });

  var apply = function () {
    var q = normalize(state.q.trim());
    var shown = 0;
    cards.forEach(function (c) {
      var ok = (state.cat === 'all' || c.getAttribute('data-cat') === state.cat) && (!q || c._text.indexOf(q) !== -1);
      c.hidden = !ok;
      if (ok) { shown++; c.classList.add('is-visible'); }
    });
    // Ẩn tiêu đề tháng nếu không còn bài nào bên dưới
    grid.querySelectorAll('[data-month]').forEach(function (h) {
      var el = h.nextElementSibling, any = false;
      while (el && !el.hasAttribute('data-month')) { if (!el.hidden) any = true; el = el.nextElementSibling; }
      h.hidden = !any;
    });
    empty.hidden = shown > 0;
    chips.forEach(function (ch) { ch.classList.toggle('is-active', ch.getAttribute('data-filter') === state.cat); });
  };

  var setCat = function (cat, push) {
    state.cat = cat;
    apply();
    if (push) {
      var url = cat === 'all' ? location.pathname : location.pathname + '?cat=' + cat;
      history.replaceState(null, '', url);
    }
  };

  chips.forEach(function (ch) {
    ch.addEventListener('click', function () { setCat(ch.getAttribute('data-filter'), true); });
  });
  search.addEventListener('input', function () { state.q = search.value; apply(); });

  var initial = new URLSearchParams(location.search).get('cat');
  if (initial && document.querySelector('.tab[data-filter="' + initial + '"]')) setCat(initial, false);
})();
