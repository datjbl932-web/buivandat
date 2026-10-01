(function () {
  'use strict';
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set: function (k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) { /* bỏ qua */ } },
  };
  var state = { token: store.get('dc_token'), admin: store.get('dc_admin'), scrapers: {} };

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') e.textContent = attrs[k]; else if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]); });
    (children || []).forEach(function (c) { e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(function () { t.hidden = true; }, 2500); }
  function fmtBytes(n) { return n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n > 1e3 ? (n / 1e3).toFixed(0) + ' KB' : n + ' B'; }
  function fmtDate(ms) { return new Date(ms).toLocaleString('vi-VN'); }

  function api(path, opts) {
    opts = opts || {};
    var headers = { authorization: 'Bearer ' + (opts.admin ? state.admin : state.token) };
    if (opts.body) headers['content-type'] = 'application/json';
    return fetch(path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) { /* html */ } return { status: r.status, json: j, text: t, headers: r.headers }; }); });
  }

  // ---------------------------------------------------------------- đăng nhập
  function showApp() {
    $('#login').hidden = true; $('#tabs').hidden = false;
    $('#tab-admin').hidden = !state.admin;
    tab('overview');
  }
  $('#login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    state.token = e.target.token.value.trim(); state.admin = e.target.admin.value.trim();
    api('/api/account').then(function (r) {
      if (r.status !== 200) { $('#login-err').hidden = false; $('#login-err').textContent = (r.json && r.json.error) || 'Token không hợp lệ'; return; }
      store.set('dc_token', state.token); store.set('dc_admin', state.admin); showApp();
    });
  });
  $('#logout').addEventListener('click', function () { store.set('dc_token', ''); store.set('dc_admin', ''); location.reload(); });

  function tab(name) {
    $$('nav button[data-tab]').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === name); });
    $$('[data-panel]').forEach(function (p) { p.hidden = p.dataset.panel !== name; });
    ({ overview: loadOverview, jobs: loadJobs, docs: loadDocs, admin: loadAdmin })[name] && ({ overview: loadOverview, jobs: loadJobs, docs: loadDocs, admin: loadAdmin })[name]();
  }
  $$('nav button[data-tab]').forEach(function (b) { b.addEventListener('click', function () { tab(b.dataset.tab); }); });

  // ---------------------------------------------------------------- tổng quan
  function loadOverview() {
    api('/api/account').then(function (r) {
      var a = r.json; if (!a) return;
      var tot = a.usage.reduce(function (s, d) { s.ok += d.success; s.fail += d.failed; s.cached += d.cached; return s; }, { ok: 0, fail: 0, cached: 0 });
      var rate = tot.ok + tot.fail ? Math.round(100 * tot.ok / (tot.ok + tot.fail)) + '%' : '–';
      var box = $('#stats'); box.innerHTML = '';
      [[a.month_success + (a.monthly_quota ? ' / ' + a.monthly_quota : ''), 'Thành công tháng này'], [rate, 'Tỉ lệ thành công (30 ngày)'],
       [a.rate_limit + '/phút', 'Giới hạn tần suất'], [a.webhook_secret, 'Webhook secret']].forEach(function (s) {
        box.appendChild(el('div', { class: 'stat' }, [el('b', { text: String(s[0]), class: String(s[0]).length > 16 ? 'small' : '' }), el('span', { text: s[1] })]));
      });
      var days = a.usage.slice().reverse(), max = Math.max.apply(null, days.map(function (d) { return d.success + d.failed; }).concat([1]));
      var chart = $('#chart'); chart.innerHTML = '';
      days.forEach(function (d) {
        var bar = el('div', { title: d.day + ': ' + d.success + ' thành công, ' + d.failed + ' thất bại' });
        bar.style.height = (100 * (d.success + d.failed) / max) + '%';
        var f = el('i'); f.style.height = (d.success + d.failed ? 100 * d.failed / (d.success + d.failed) : 0) + '%'; bar.appendChild(f);
        chart.appendChild(bar);
      });
      var tb = $('#usage tbody'); tb.innerHTML = '';
      a.usage.forEach(function (d) { tb.appendChild(el('tr', {}, [d.day, String(d.success), String(d.failed), String(d.cached), fmtBytes(d.bytes)].map(function (v) { return el('td', { text: v }); }))); });
    });
  }

  // ---------------------------------------------------------------- thử nghiệm
  function loadScrapers() {
    return fetch('/api/scrapers').then(function (r) { return r.json(); }).then(function (s) {
      state.scrapers = s;
      ['#scraper-select', '#job-scraper'].forEach(function (sel) {
        Object.keys(s).forEach(function (k) { $(sel).appendChild(el('option', { value: k, text: k + ' – ' + s[k] })); });
      });
    });
  }
  $('#play').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, btn = $('button', f), t0 = Date.now();
    var p = new URLSearchParams({ url: f.url.value.trim(), cache: f.cache.value, javascript: f.javascript.value, format: 'json' });
    if (f.scraper.value) p.set('scraper', f.scraper.value);
    btn.disabled = true; $('#play-meta').textContent = 'Đang crawl…'; $('#play-out').hidden = true;
    api('/api/crawl?' + p).then(function (r) {
      var j = r.json || {};
      $('#play-meta').textContent = 'pc_status ' + j.pc_status + ' · original_status ' + j.original_status + ' · ' + (Date.now() - t0) + ' ms' +
        (j.attempts ? ' · ' + j.attempts + ' lần thử' : '') + (j.cached ? ' · từ cache' : '') + (j.proxy ? ' · ' + j.proxy : '') + (j.error ? ' · ' + j.error : '');
      var out = $('#play-out'); out.hidden = false;
      out.textContent = typeof j.body === 'string' ? j.body.slice(0, 200000) : JSON.stringify(j, null, 2);
    }).finally(function () { btn.disabled = false; });
  });

  // ---------------------------------------------------------------- job
  $('#job-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, urls = f.urls.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    api('/api/jobs', { method: 'POST', body: { urls: urls, scraper: f.scraper.value || null, callback_url: f.callback_url.value.trim() || null } }).then(function (r) {
      if (r.status !== 200) { $('#job-err').hidden = false; $('#job-err').textContent = (r.json && r.json.error) || 'Lỗi'; return; }
      $('#job-err').hidden = true; f.urls.value = ''; toast('Đã tạo ' + r.json.id + ' (' + r.json.total + ' URL)'); loadJobs();
    });
  });
  var jobTimer = null;
  function loadJobs() {
    clearTimeout(jobTimer);
    api('/api/jobs').then(function (r) {
      var tb = $('#jobs-tbl tbody'); tb.innerHTML = '';
      (r.json || []).forEach(function (j) {
        var dl = el('button', { class: 'btn sm', text: 'Tải CSV' }); dl.addEventListener('click', function () { download(j.id, 'csv'); });
        var dj = el('button', { class: 'btn sm', text: 'JSON' }); dj.addEventListener('click', function () { download(j.id, 'json'); });
        tb.appendChild(el('tr', {}, [
          el('td', { text: j.id }), el('td', { text: fmtDate(j.created_at) }), el('td', { text: j.scraper || 'html' }),
          el('td', { text: (j.done + j.failed) + ' / ' + j.total + (j.failed ? ' (' + j.failed + ' lỗi)' : '') }),
          el('td', {}, [el('span', { class: 'pill ' + j.status, text: j.status })]), el('td', {}, [dl, document.createTextNode(' '), dj]),
        ]));
      });
      if ((r.json || []).some(function (j) { return j.status === 'queued' || j.status === 'running'; }) && !$('[data-panel="jobs"]').hidden) jobTimer = setTimeout(loadJobs, 3000);
    });
  }
  function fetchAllItems(id) {
    var all = [];
    function page(offset) {
      return api('/api/jobs/' + id + '?limit=500&offset=' + offset).then(function (r) {
        all = all.concat(r.json.items);
        return r.json.items.length === 500 ? page(offset + 500) : all;
      });
    }
    return page(0);
  }
  function csvCell(v) { if (v == null) return ''; if (typeof v === 'object') v = Array.isArray(v) && v.every(function (x) { return typeof x !== 'object'; }) ? v.join(' | ') : JSON.stringify(v); v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function download(id, kind) {
    fetchAllItems(id).then(function (items) {
      var blob;
      if (kind === 'json') {
        blob = new Blob([JSON.stringify(items.map(function (i) { return i.result; }), null, 2)], { type: 'application/json' });
      } else {
        var rows = [];
        items.forEach(function (i) {
          var res = i.result || {}, b = res.body;
          var base = { source_url: i.url, pc_status: res.pc_status, original_status: res.original_status, error: res.error || '' };
          if (b && Array.isArray(b.products)) b.products.forEach(function (p) { rows.push(Object.assign({}, base, p)); });
          else if (b && typeof b === 'object') rows.push(Object.assign({}, base, b));
          else rows.push(base);
        });
        var cols = []; rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (cols.indexOf(k) < 0) cols.push(k); }); });
        var csv = '﻿' + cols.join(',') + '\n' + rows.map(function (r) { return cols.map(function (c) { return csvCell(r[c]); }).join(','); }).join('\n');
        blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      }
      var a = el('a', { href: URL.createObjectURL(blob), download: id + '.' + kind }); document.body.appendChild(a); a.click(); a.remove();
    });
  }

  // ---------------------------------------------------------------- tài liệu
  function loadDocs() {
    var host = location.origin, t = state.token || 'dc_...';
    $('#doc-scrapers').textContent = 'auto, ' + Object.keys(state.scrapers).join(', ');
    $('#doc-curl').textContent = 'curl "' + host + '/?token=' + t + '&scraper=amazon-product-details&url=' + encodeURIComponent('https://www.amazon.com/dp/B0BKW3LB2B') + '"';
    $('#doc-py').textContent = 'import requests\n\nr = requests.get("' + host + '/", params={\n    "token": "' + t + '",\n    "url": "https://www.amazon.com/s?k=mechanical+keyboard",\n    "scraper": "amazon-serp",\n})\ndata = r.json()\nfor p in data["body"]["products"]:\n    print(p["asin"], p["price"], p["name"])';
    $('#doc-node').textContent = 'const qs = new URLSearchParams({\n  token: "' + t + '",\n  url: "https://www.amazon.com/dp/B0BKW3LB2B",\n  scraper: "amazon-product-details",\n});\nconst data = await (await fetch("' + host + '/?" + qs)).json();\nconsole.log(data.body.name, data.body.price, data.body.rating);';
    $('#doc-job').textContent = 'curl -X POST ' + host + '/api/jobs \\\n  -H "Authorization: Bearer ' + t + '" -H "Content-Type: application/json" \\\n  -d \'{"urls": ["https://www.amazon.com/dp/B0BKW3LB2B"], "scraper": "auto", "callback_url": "https://may-chu-cua-ban/webhook"}\'\n\n# Xem tiến độ & kết quả\ncurl -H "Authorization: Bearer ' + t + '" ' + host + '/api/jobs/job_xxx';
  }

  // ---------------------------------------------------------------- quản trị
  function loadAdmin() {
    api('/admin/tokens', { admin: true }).then(function (r) {
      var tb = $('#tok-tbl tbody'); tb.innerHTML = '';
      if (r.status !== 200) { toast('ADMIN_TOKEN không đúng'); return; }
      r.json.forEach(function (t) {
        var off = el('button', { class: 'btn sm', text: t.disabled ? 'Đã khoá' : 'Khoá' });
        off.disabled = !!t.disabled;
        off.addEventListener('click', function () { if (confirm('Khoá token ' + t.name + '?')) api('/admin/tokens/' + t.id + '/disable', { method: 'POST', admin: true }).then(loadAdmin); });
        tb.appendChild(el('tr', {}, [String(t.id), t.name, t.prefix + '…', String(t.rate_limit || 'mặc định'), String(t.monthly_quota || '∞'), String(t.success), String(t.failed)]
          .map(function (v) { return el('td', { text: v }); }).concat([el('td', {}, [off])])));
      });
    });
    api('/admin/proxies', { admin: true }).then(function (r) {
      var tb = $('#px-tbl tbody'); tb.innerHTML = '';
      (r.json || []).forEach(function (p) {
        tb.appendChild(el('tr', {}, [p.proxy, String(p.score), String(p.ok), String(p.fail), String(p.blocked), String(p.inflight),
          p.banned.map(function (b) { return b.domain + ' → ' + new Date(b.until).toLocaleTimeString('vi-VN'); }).join(', ') || '–']
          .map(function (v) { return el('td', { text: v }); })));
      });
    });
  }
  $('#tok-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    api('/admin/tokens', { method: 'POST', admin: true, body: { name: f.name.value, rate_limit: f.rate_limit.value ? +f.rate_limit.value : null, monthly_quota: f.monthly_quota.value ? +f.monthly_quota.value : null } })
      .then(function (r) {
        if (r.status !== 200) return toast('Không tạo được token');
        var box = $('#tok-new'); box.hidden = false;
        box.textContent = 'Token mới (chỉ hiện một lần, hãy lưu lại): ' + r.json.token + ' · webhook secret: ' + r.json.webhookSecret;
        f.reset(); loadAdmin();
      });
  });

  loadScrapers().then(function () { if (state.token) api('/api/account').then(function (r) { if (r.status === 200) showApp(); }); });
})();
