/*
 * "Không Có Phép Màu" – music video vẽ bằng code cho buivandat.com.
 *
 * Mỗi khung hình là một hàm xác định của thời gian bài hát t (giây):
 * bản xem trực tiếp trên trình duyệt và bản xuất MP4 giống hệt nhau.
 * Lời hiện theo từng chữ, đúng thời điểm từng nốt (lấy từ song.json).
 * Cách làm lấy cảm hứng từ mexicat/pdoom-video (MIT).
 */
(function (global) {
  'use strict';

  var W = 1920, H = 1080, M = 96; // khung logic 1080p, lề an toàn 96px
  var INK = '#0B0B0C', BONE = '#F2F0EB', PAPER = '#FFFFFF', BLACK = '#111111';
  var SANS = '"Be Vietnam Pro", system-ui, sans-serif';
  var MONO = 'ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace';

  // ---------------------------------------------------------------- tiện ích
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function prog(t, a, b) { return clamp((t - a) / (b - a), 0, 1); }
  var ease = {
    outExpo: function (k) { return k >= 1 ? 1 : 1 - Math.pow(2, -10 * k); },
    inOutCubic: function (k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; },
    outCubic: function (k) { return 1 - Math.pow(1 - k, 3); },
    outBack: function (k) { var c = 1.4; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); },
  };
  function hash(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function rgba(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function fmtTime(t) {
    var m = Math.floor(t / 60), s = t - m * 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // ---------------------------------------------------------------- dữ liệu bài hát
  function Song(data) {
    this.d = data;
    this.beat = 60 / data.bpm;
    this.bar = this.beat * 4;
    this.lines = data.lines;
  }
  Song.prototype.section = function (t) {
    var s = this.d.sections;
    for (var i = s.length - 1; i >= 0; i--) if (t >= s[i].start) return s[i];
    return s[0];
  };
  Song.prototype.pulse = function (list, t, decay) {
    // độ "nảy" sau cú đánh gần nhất (kick/snare)
    var lo = 0, hi = list.length - 1, best = -1;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (list[mid] <= t) { best = mid; lo = mid + 1; } else hi = mid - 1; }
    if (best < 0) return 0;
    return Math.exp(-(t - list[best]) * (decay || 9));
  };
  Song.prototype.kick = function (t) { return this.pulse(this.d.kicks, t, 9); };
  Song.prototype.snare = function (t) { return this.pulse(this.d.snares, t, 12); };
  Song.prototype.linesIn = function (sectionId) {
    return this.lines.filter(function (l) { return l.section === sectionId; });
  };
  Song.prototype.currentLine = function (lines, t, lead) {
    var cur = null, idx = -1;
    for (var i = 0; i < lines.length; i++) if (t >= lines[i].start - (lead || 0)) { cur = lines[i]; idx = i; }
    return { line: cur, index: idx };
  };
  Song.prototype.level = function (t) {
    var e = this.d.envelope, i = Math.floor(t * this.d.envelope_fps);
    return e[clamp(i, 0, e.length - 1)] || 0;
  };
  function wordProgress(w, t) { return clamp((t - w.start) / Math.max(0.05, w.end - w.start), 0, 1); }

  // ---------------------------------------------------------------- chữ
  function font(ctx, size, weight, family) {
    ctx.font = (weight || 700) + ' ' + size + 'px ' + (family || SANS);
  }
  function layout(ctx, words, maxW) {
    var space = ctx.measureText(' ').width, rows = [[]], x = 0;
    words.forEach(function (w) {
      var ww = ctx.measureText(w.text).width;
      if (x > 0 && x + ww > maxW) { rows.push([]); x = 0; }
      rows[rows.length - 1].push({ w: w, x: x, width: ww });
      x += ww + space;
    });
    return rows;
  }

  /* Vẽ một dòng lời kiểu karaoke: chữ chưa hát mờ, chữ đang hát được "tô" từ trái sang phải. */
  function karaoke(ctx, line, t, o) {
    font(ctx, o.size, o.weight || 700);
    ctx.letterSpacing = (o.tracking != null ? o.tracking : -0.02 * o.size) + 'px';
    var rows = layout(ctx, line.words, o.maxW);
    var lh = o.size * (o.leading || 1.12);
    var y0 = o.anchor === 'top' ? o.y : o.y - (rows.length - 1) * lh * 0.5;
    rows.forEach(function (row, r) {
      var y = y0 + r * lh;
      row.forEach(function (cell) {
        var w = cell.w, p = wordProgress(w, t), x = o.x + cell.x;
        if (o.mode === 'slam') {
          if (t < w.start - 0.02) {
            if (o.ghost) { ctx.fillStyle = o.ghost; ctx.fillText(w.text, x, y); }
            return;
          }
          var k = ease.outExpo(prog(t, w.start - 0.02, w.start + 0.22));
          ctx.save();
          ctx.translate(x, y + (1 - k) * o.size * 0.35);
          ctx.globalAlpha *= k;
          ctx.fillStyle = o.on;
          ctx.fillText(w.text, 0, 0);
          ctx.restore();
          return;
        }
        ctx.fillStyle = o.off; ctx.fillText(w.text, x, y);
        if (p > 0) {
          ctx.save();
          ctx.beginPath(); ctx.rect(x - 4, y - o.size, cell.width * p + 4, o.size * 1.5); ctx.clip();
          ctx.fillStyle = o.on; ctx.fillText(w.text, x, y);
          ctx.restore();
          if (o.underline && p < 1 && t >= w.start) {
            ctx.fillStyle = o.on;
            ctx.fillRect(x, y + o.size * 0.18, cell.width * p, Math.max(3, o.size * 0.045));
          }
        }
      });
    });
    ctx.letterSpacing = '0px';
    return { rows: rows, lh: lh, y0: y0 };
  }

  // ---------------------------------------------------------------- logo Đ
  function logoPath(ctx, s) {
    // toạ độ theo logo-mark.svg (viewBox 64)
    var k = s / 64;
    return {
      box: function () { roundRect(ctx, 0, 0, 64 * k, 64 * k, 14 * k); },
      d: function () {
        ctx.moveTo(25 * k, 18 * k); ctx.lineTo(32 * k, 18 * k);
        ctx.bezierCurveTo(40.3 * k, 18 * k, 46 * k, 23.9 * k, 46 * k, 32 * k);
        ctx.bezierCurveTo(46 * k, 40.1 * k, 40.3 * k, 46 * k, 32 * k, 46 * k);
        ctx.lineTo(25 * k, 46 * k); ctx.closePath();
      },
      bar: function () { ctx.moveTo(17 * k, 32 * k); ctx.lineTo(32 * k, 32 * k); },
      k: k,
    };
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  /* Logo tự vẽ nét: a = khung, b = chữ D, c = gạch ngang, fill = tô đặc */
  function drawLogo(ctx, cx, cy, s, a, b, c, fill, color, bg) {
    var L = logoPath(ctx, s);
    ctx.save();
    ctx.translate(cx - s / 2, cy - s / 2);
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    if (fill > 0) {
      ctx.globalAlpha = fill; ctx.fillStyle = color; ctx.beginPath(); L.box(); ctx.fill(); ctx.globalAlpha = 1;
    }
    var stroke = fill > 0.5 ? bg : color;
    ctx.strokeStyle = color; ctx.lineWidth = 2.2 * L.k;
    if (a > 0 && fill < 1) {
      var per = 4 * 64 * L.k;
      ctx.setLineDash([per * a, per]); ctx.beginPath(); L.box(); ctx.stroke();
    }
    ctx.strokeStyle = stroke; ctx.lineWidth = 5.5 * L.k;
    if (b > 0) {
      var perD = 110 * L.k;
      ctx.setLineDash([perD * b, perD]); ctx.beginPath(); L.d(); ctx.stroke();
    }
    ctx.setLineDash([]);
    if (c > 0) {
      ctx.lineWidth = 5 * L.k; ctx.beginPath();
      ctx.moveTo(32 * L.k - 15 * L.k * c, 32 * L.k); ctx.lineTo(32 * L.k, 32 * L.k); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- HUD
  function hud(ctx, S, t, fg, sec) {
    var dim = rgba(fg, 0.55);
    font(ctx, 18, 500, MONO);
    ctx.fillStyle = dim; ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left'; ctx.fillText('buivandat.com', M, 64);
    ctx.textAlign = 'right'; ctx.fillText(sec.label.toUpperCase() + '  ·  ' + S.d.bpm + ' BPM  ·  ' + S.d.key.toUpperCase(), W - M, 64);
    ctx.textAlign = 'left'; ctx.fillText(fmtTime(t) + ' / ' + fmtTime(S.d.duration), M, H - 48);
    var bar = Math.floor(t / S.bar), beat = Math.floor((t % S.bar) / S.beat);
    ctx.textAlign = 'right';
    ctx.fillText('Ô NHỊP ' + pad2(bar + 1) + '  PHÁCH ' + (beat + 1), W - M - 76, H - 48);
    for (var i = 0; i < 4; i++) {
      ctx.fillStyle = i <= beat ? fg : rgba(fg, 0.2);
      ctx.fillRect(W - M - 64 + i * 17, H - 61, 12, 12);
    }
    ctx.textAlign = 'left';
  }

  // ---------------------------------------------------------------- cảnh
  function Scenes(S) { this.S = S; }

  Scenes.prototype.intro = function (ctx, t, sec) {
    var S = this.S, b = S.bar;
    ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
    var out = ease.inOutCubic(prog(t, sec.end - 0.7, sec.end));
    ctx.save(); ctx.translate(0, -out * 80); ctx.globalAlpha = 1 - out;
    var kp = S.kick(t);
    drawLogo(ctx, W / 2, 400 - kp * 4, 190 + kp * 6,
      ease.inOutCubic(prog(t, 0.2, b * 0.95)),
      ease.inOutCubic(prog(t, b * 0.95, b * 1.9)),
      ease.outExpo(prog(t, b * 2, b * 2 + 0.25)),
      ease.outCubic(prog(t, b * 3, b * 3 + 0.4)), BONE, INK);
    // tên bài hiện theo từng phách của ô nhịp 3
    var title = ['Không', 'Có', 'Phép', 'Màu'];
    font(ctx, 104, 700); ctx.letterSpacing = '-2px';
    var widths = title.map(function (w) { return ctx.measureText(w).width; });
    var sp = 28, total = widths.reduce(function (a, c) { return a + c; }, 0) + sp * 3, x = (W - total) / 2;
    title.forEach(function (w, i) {
      var k = ease.outExpo(prog(t, b * 2 + i * S.beat, b * 2 + i * S.beat + 0.35));
      ctx.globalAlpha = k * (1 - out); ctx.fillStyle = BONE;
      ctx.fillText(w, x, 660 + (1 - k) * 40); x += widths[i] + sp;
    });
    ctx.letterSpacing = '0px';
    var k2 = ease.outCubic(prog(t, b * 3, b * 3 + 0.8));
    ctx.globalAlpha = k2 * (1 - out);
    font(ctx, 26, 500); ctx.fillStyle = rgba(BONE, 0.6); ctx.textAlign = 'center';
    ctx.fillText('buivandat.com  ·  nhạc, lời và hình viết bằng code', W / 2, 730);
    ctx.textAlign = 'left';
    // đường kẻ nảy theo kick
    ctx.globalAlpha = (1 - out) * 0.5;
    var len = 180 + kp * 420 * prog(t, b * 2, b * 2.1);
    ctx.fillStyle = BONE; ctx.fillRect(W / 2 - len / 2, 800, len, 2);
    ctx.restore();
    hud(ctx, S, t, BONE, sec);
  };

  /* Verse 1: đêm khuya, log chạy bên trái */
  Scenes.prototype.verseNight = function (ctx, t, sec) {
    var S = this.S;
    ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
    var inK = ease.outCubic(prog(t, sec.start, sec.start + 0.6));
    var colX = 720;
    // log: mỗi móc đơn một dòng
    var step = S.beat / 2, n = Math.floor((t - sec.start) / step), lh = 30, rows = 26;
    var frac = ease.outExpo(((t - sec.start) % step) / step);
    font(ctx, 19, 400, MONO);
    ctx.save(); ctx.beginPath(); ctx.rect(M, 120, colX - M - 40, H - 260); ctx.clip();
    for (var i = 0; i < rows; i++) {
      var id = n - i; if (id < 0) break;
      var y = H - 170 - i * lh + (1 - frac) * lh;
      var secs = 23 * 3600 + 41 * 60 + Math.floor(sec.start + id * step);
      var hh = Math.floor(secs / 3600) % 24, mm = Math.floor(secs / 60) % 60, ss = secs % 60;
      var warn = hash(id + 3) < 0.1;
      var msg = pad2(hh) + ':' + pad2(mm) + ':' + pad2(ss) + (warn ? '  WARN  job #' + (1040 + id) + ' retry' : '  INFO  job #' + (1040 + id) + ' ok ' + (0.4 + hash(id) * 1.9).toFixed(1) + 's');
      ctx.fillStyle = rgba(BONE, (i === 0 ? 0.85 : 0.42 - i * 0.012) * inK);
      ctx.fillText(msg, M, y);
    }
    ctx.restore();
    // vạch chia cột
    ctx.fillStyle = rgba(BONE, 0.15 * inK); ctx.fillRect(colX, 120, 1, H - 240);
    font(ctx, 16, 500, MONO); ctx.fillStyle = rgba(BONE, 0.5 * inK);
    ctx.fillText('tail -f ~/tool-bot/logs/bot.log', M, 110);

    var lines = S.linesIn(sec.id);
    var cur = S.currentLine(lines, t, 0.5);
    var x = colX + 80, maxW = W - M - x;
    if (cur.index > 0) {
      var prev = lines[cur.index - 1], kk = ease.outExpo(prog(t, cur.line.start - 0.5, cur.line.start));
      ctx.globalAlpha = (1 - kk * 0.6) * inK;
      karaoke(ctx, prev, t, { x: x, y: lerp(560, 360, kk), size: lerp(88, 44, kk), maxW: maxW, on: rgba(BONE, 0.5), off: rgba(BONE, 0.5), weight: 600 });
      ctx.globalAlpha = 1;
    }
    if (cur.line) {
      var k = ease.outExpo(prog(t, cur.line.start - 0.5, cur.line.start - 0.1));
      ctx.globalAlpha = k * inK;
      var r = karaoke(ctx, cur.line, t, { x: x, y: 560 + (1 - k) * 40, size: 88, maxW: maxW, on: BONE, off: rgba(BONE, 0.24), underline: true });
      // con trỏ nhấp nháy theo phách
      var last = r.rows[r.rows.length - 1], lc = last[last.length - 1];
      var blink = ((t / S.beat) % 1) < 0.5 ? 1 : 0.15;
      ctx.fillStyle = rgba(BONE, blink);
      font(ctx, 88, 700); ctx.letterSpacing = '-1.76px';
      ctx.fillRect(x + lc.x + lc.width + 18, r.y0 + (r.rows.length - 1) * r.lh - 66, 34, 78);
      ctx.letterSpacing = '0px';
      ctx.globalAlpha = 1;
    }
    hud(ctx, S, t, BONE, sec);
  };

  /* Verse 2: chia khung như Termidat – tải file, sổ thắng/thua, lời bên dưới */
  Scenes.prototype.versePanes = function (ctx, t, sec) {
    var S = this.S, b = S.bar;
    ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
    var open = ease.inOutCubic(prog(t, sec.start, sec.start + 0.9));
    var midX = W / 2, topY = 120, splitY = 560;
    ctx.fillStyle = rgba(BONE, 0.18);
    ctx.fillRect(M, splitY, (W - 2 * M) * open, 1);
    ctx.fillRect(midX, topY, 1, (splitY - topY) * open);

    // khung trái: tải file lên server
    var files = [['tool-bot.zip', 2.4], ['config.json', 0.004], ['backup-2026-09.tgz', 3.3], ['notes.md', 0.02]];
    font(ctx, 17, 500, MONO); ctx.fillStyle = rgba(BONE, 0.5 * open);
    ctx.fillText('SFTP  ·  /home/tool-bot', M, topY + 40);
    files.forEach(function (f, i) {
      var y = topY + 110 + i * 88;
      var st = sec.start + b * 2 + i * S.beat * 2, en = st + S.beat * (i === 2 ? 6 : 3);
      var p = ease.inOutCubic(prog(t, st, en));
      ctx.globalAlpha = open;
      font(ctx, 26, 600); ctx.fillStyle = BONE; ctx.fillText(f[0], M, y);
      font(ctx, 17, 500, MONO); ctx.fillStyle = rgba(BONE, 0.55); ctx.textAlign = 'right';
      var label = p >= 1 ? '✓ xong' : p > 0 ? Math.round(p * 100) + '%' : 'đang chờ';
      ctx.fillText((f[1] * p).toFixed(f[1] < 1 ? 3 : 1) + ' / ' + f[1] + ' MB   ' + label, midX - 60, y);
      ctx.textAlign = 'left';
      ctx.fillStyle = rgba(BONE, 0.15); ctx.fillRect(M, y + 18, midX - 60 - M, 4);
      ctx.fillStyle = BONE; ctx.fillRect(M, y + 18, (midX - 60 - M) * p, 4);
      ctx.globalAlpha = 1;
    });

    // khung phải: sổ thắng / thua, thêm một dòng mỗi tiếng snare
    var x0 = midX + 60, x1 = W - M;
    font(ctx, 17, 500, MONO); ctx.fillStyle = rgba(BONE, 0.5 * open);
    ctx.fillText('SỔ GHI CHÉP  ·  thắng / thua', x0, topY + 40);
    var snares = S.d.snares.filter(function (s) { return s >= sec.start + b * 4 && s <= t; });
    var total = 0, rowsMax = 7;
    var start = Math.max(0, snares.length - rowsMax);
    for (var i = 0; i < snares.length; i++) {
      var win = hash(i + 11) > 0.33, amt = Math.round((win ? 40 : -25) * (0.5 + hash(i + 29)));
      total += amt;
      if (i < start) continue;
      var y = topY + 100 + (i - start) * 46;
      var k = ease.outExpo(prog(t, snares[i], snares[i] + 0.25));
      ctx.globalAlpha = k * open;
      font(ctx, 20, 500, MONO);
      ctx.fillStyle = rgba(BONE, 0.55); ctx.fillText('ngày ' + pad2(i + 1), x0, y);
      ctx.fillStyle = BONE; ctx.fillText(win ? 'thắng' : 'thua ', x0 + 180, y);
      ctx.textAlign = 'right'; ctx.fillText((amt > 0 ? '+' : '−') + Math.abs(amt), x1, y); ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }
    if (snares.length) {
      ctx.fillStyle = rgba(BONE, 0.3 * open); ctx.fillRect(x0, splitY - 70, x1 - x0, 1);
      font(ctx, 20, 700, MONO); ctx.fillStyle = BONE; ctx.globalAlpha = open;
      ctx.fillText('tổng', x0, splitY - 36); ctx.textAlign = 'right';
      ctx.fillText((total >= 0 ? '+' : '−') + Math.abs(total), x1, splitY - 36); ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }

    // lời ở khung dưới
    var lines = S.linesIn(sec.id), cur = S.currentLine(lines, t, 0.5);
    if (cur.line) {
      var k2 = ease.outExpo(prog(t, cur.line.start - 0.5, cur.line.start - 0.1));
      ctx.globalAlpha = k2;
      karaoke(ctx, cur.line, t, { x: M, y: 800 + (1 - k2) * 30, size: 96, maxW: W - 2 * M, on: BONE, off: rgba(BONE, 0.22), underline: true });
      ctx.globalAlpha = 1;
    }
    hud(ctx, S, t, BONE, sec);
  };

  /* Pre-chorus: thanh tiến độ nhích theo từng phách, dồn lên điệp khúc */
  Scenes.prototype.pre = function (ctx, t, sec) {
    var S = this.S;
    ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
    var lastBar = sec.end - S.bar, build = prog(t, lastBar, sec.end);
    // nền lưới chớp theo móc kép ở ô nhịp cuối
    if (build > 0) {
      var sixteenth = Math.floor((t - lastBar) / (S.beat / 4));
      for (var i = 0; i < 24; i++) {
        if (hash(i * 7 + sixteenth) < 0.35 + build * 0.4) {
          ctx.fillStyle = rgba(BONE, 0.05 + 0.1 * build);
          ctx.fillRect(M + i * ((W - 2 * M) / 24), 0, 2, H);
        }
      }
    }
    // thanh tiến độ: nhích theo phách
    var beats = (t - sec.start) / S.beat, total = (sec.end - sec.start) / S.beat;
    var fl = Math.floor(beats), p = (fl + ease.outExpo(beats - fl)) / total;
    var slow = sec.id === 'pre2';
    var y = 760, x0 = M, x1 = W - M;
    ctx.fillStyle = rgba(BONE, 0.15); ctx.fillRect(x0, y, x1 - x0, 8);
    ctx.fillStyle = BONE; ctx.fillRect(x0, y, (x1 - x0) * p, 8);
    for (var j = 0; j <= total; j++) {
      ctx.fillStyle = rgba(BONE, j <= fl ? 0.7 : 0.2);
      ctx.fillRect(x0 + (x1 - x0) * j / total, y + 22, 2, j % 4 === 0 ? 18 : 9);
    }
    font(ctx, 22, 500, MONO); ctx.fillStyle = rgba(BONE, 0.6);
    ctx.fillText(slow ? 'đi chậm mà chắc' : 'không có lối tắt', x0, y - 24);
    ctx.textAlign = 'right'; ctx.fillStyle = BONE;
    ctx.fillText(Math.floor(p * 100) + '%', x1, y - 24); ctx.textAlign = 'left';

    var lines = S.linesIn(sec.id), cur = S.currentLine(lines, t, 0.5);
    if (cur.line) {
      var k = ease.outExpo(prog(t, cur.line.start - 0.5, cur.line.start - 0.1));
      var scale = 1 + build * 0.12;
      ctx.save(); ctx.translate(M, 520); ctx.scale(scale, scale); ctx.globalAlpha = k;
      karaoke(ctx, cur.line, t, { x: 0, y: (1 - k) * 30, size: 100, maxW: (W - 2 * M) / scale, on: BONE, off: rgba(BONE, 0.22), underline: true });
      ctx.restore();
    }
    // chớp trắng ở phách cuối, nối sang điệp khúc nền trắng
    var flash = prog(t, sec.end - S.beat * 0.5, sec.end);
    if (flash > 0) { ctx.fillStyle = rgba(PAPER, ease.inOutCubic(flash)); ctx.fillRect(0, 0, W, H); }
    hud(ctx, S, t, BONE, sec);
  };

  /* Điệp khúc: nền trắng, chữ đập theo nhịp, biểu đồ đi lên đều */
  Scenes.prototype.chorus = function (ctx, t, sec) {
    var S = this.S, second = sec.id === 'chorus2';
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
    var kp = S.kick(t);

    // lưới biểu đồ
    var gx0 = M, gx1 = W - M, gy0 = 600, gy1 = H - 120;
    ctx.fillStyle = 'rgba(0,0,0,0.07)';
    for (var g = 0; g <= 4; g++) ctx.fillRect(gx0, gy0 + (gy1 - gy0) * g / 4, gx1 - gx0, 1);
    for (var v = 0; v <= 8; v++) ctx.fillRect(gx0 + (gx1 - gx0) * v / 8, gy0, 1, gy1 - gy0);
    font(ctx, 16, 500, MONO); ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillText('kết quả', gx0, gy0 - 14);
    ctx.textAlign = 'right'; ctx.fillText('kỷ luật × thời gian →', gx1, gy1 + 30); ctx.textAlign = 'left';

    // đường biểu đồ: mỗi phách một điểm, đi lên đều, thỉnh thoảng hụt nhẹ
    var beatsTotal = (sec.end - sec.start) / S.beat;
    var bt = (t - sec.start) / S.beat, nPts = Math.floor(bt);
    var base = second ? 0.45 : 0.05;
    function val(i) {
      var trend = base + (i / beatsTotal) * (second ? 0.5 : 0.4);
      var dip = hash(i * 3.1 + (second ? 50 : 0)) < 0.18 ? -0.06 : 0;
      return clamp(trend + dip + (hash(i + 7) - 0.5) * 0.03, 0, 1);
    }
    function px(i) { return gx0 + (gx1 - gx0) * i / beatsTotal; }
    function py(vv) { return gy1 - (gy1 - gy0) * vv; }
    ctx.strokeStyle = BLACK; ctx.lineWidth = 4; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(px(0), py(val(0)));
    for (var i = 1; i <= nPts; i++) ctx.lineTo(px(i), py(val(i)));
    var fr = ease.outExpo(bt - nPts);
    var hx = lerp(px(nPts), px(nPts + 1), fr), hy = lerp(py(val(nPts)), py(val(nPts + 1)), fr);
    ctx.lineTo(hx, hy); ctx.stroke();
    ctx.fillStyle = BLACK; ctx.beginPath(); ctx.arc(hx, hy, 9 + kp * 7, 0, Math.PI * 2); ctx.fill();

    // lời: mỗi câu một ô nhịp
    var lines = S.linesIn(sec.id), cur = S.currentLine(lines, t, 0.15);
    var isHook = function (l) { return /phép màu/.test(l.text); };
    var sizeOf = function (l) { return isHook(l) ? 176 : 128; };
    if (cur.index > 0) {
      var prev = lines[cur.index - 1], kk = ease.outExpo(prog(t, cur.line.start - 0.15, cur.line.start + 0.1));
      // câu trước lùi lên thành dòng nhỏ phía trên
      karaoke(ctx, prev, t, { x: M, y: lerp(360, 190, kk), size: lerp(sizeOf(prev), 52, kk), maxW: W - 2 * M, on: BLACK, off: BLACK, mode: 'slam', anchor: 'top' });
      ctx.globalAlpha = 1;
    }
    if (cur.line) {
      karaoke(ctx, cur.line, t, { x: M, y: isHook(cur.line) ? 390 : 360, size: sizeOf(cur.line), maxW: W - 2 * M, on: BLACK, ghost: 'rgba(0,0,0,0.08)', mode: 'slam', tracking: -4, anchor: 'top' });
      // con dấu buivandat.com cho câu "Bùi Văn Đạt chấm com"
      if (/chấm com/.test(cur.line.text)) {
        var com = cur.line.words[cur.line.words.length - 1];
        var ks = ease.outBack(prog(t, com.start, com.start + 0.3));
        if (ks > 0) {
          ctx.save(); ctx.translate(1380, 470); ctx.rotate(-0.07); ctx.scale(ks, ks);
          ctx.strokeStyle = BLACK; ctx.lineWidth = 5; ctx.beginPath(); roundRect(ctx, -250, -58, 500, 104, 10); ctx.stroke();
          font(ctx, 54, 700); ctx.fillStyle = BLACK; ctx.textAlign = 'center';
          ctx.fillText('buivandat.com', 0, 12); ctx.textAlign = 'left';
          ctx.restore();
          if (second) drawLogo(ctx, 1700, 300, 120 * ks, 1, 1, 1, 1, BLACK, PAPER);
        }
      }
      // chú thích tỉnh bơ sau "phép màu"
      if (/phép màu/.test(cur.line.text)) {
        var mau = cur.line.words[cur.line.words.length - 1];
        var kc = ease.outCubic(prog(t, mau.end, mau.end + 0.2));
        ctx.globalAlpha = kc; font(ctx, 20, 500, MONO); ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.textAlign = 'right'; ctx.fillText('* tìm "phép màu": 0 kết quả', W - M, 150); ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
      }
    }
    // vạch nảy theo kick trên cùng
    ctx.fillStyle = BLACK; ctx.fillRect(0, 0, W * kp * 0.35, 6);
    if (second) {
      font(ctx, 18, 700, MONO); ctx.fillStyle = BLACK; ctx.textAlign = 'right';
      ctx.fillText('NGÀY ' + (180 + Math.floor(bt * 4)), gx1, gy0 - 14); ctx.textAlign = 'left';
    }
    // gạt sang nền đen ở cuối điệp khúc 1
    if (!second) {
      var wipe = ease.inOutCubic(prog(t, sec.end - 0.35, sec.end));
      if (wipe > 0) { ctx.fillStyle = INK; ctx.fillRect(0, 0, W * wipe, H); }
    }
    hud(ctx, S, t, BLACK, sec);
  };

  Scenes.prototype.outro = function (ctx, t, sec) {
    var S = this.S, b = S.bar;
    ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
    var inK = ease.outCubic(prog(t, sec.start, sec.start + 0.8));
    var lines = S.linesIn('outro'), cur = S.currentLine(lines, t, 0.5);
    var endCard = prog(t, sec.start + b * 4, sec.start + b * 4 + 0.8);
    if (cur.line && endCard < 1) {
      var k = ease.outExpo(prog(t, cur.line.start - 0.5, cur.line.start - 0.1));
      ctx.globalAlpha = k * inK * (1 - endCard);
      font(ctx, 110, 700);
      karaoke(ctx, cur.line, t, { x: M, y: 560, size: 110, maxW: W - 2 * M, on: BONE, off: rgba(BONE, 0.2), underline: true });
      ctx.globalAlpha = 1;
    }
    if (endCard > 0) {
      var e = ease.outCubic(endCard);
      ctx.globalAlpha = e;
      drawLogo(ctx, W / 2, 420, 170, 1, 1, 1, ease.outCubic(prog(t, sec.start + b * 4.5, sec.start + b * 4.5 + 0.6)), BONE, INK);
      font(ctx, 72, 700); ctx.fillStyle = BONE; ctx.textAlign = 'center'; ctx.letterSpacing = '-1.5px';
      ctx.fillText('buivandat.com', W / 2, 620); ctx.letterSpacing = '0px';
      font(ctx, 24, 500); ctx.fillStyle = rgba(BONE, 0.6);
      ctx.fillText('Không Có Phép Màu  ·  nhạc, lời và hình viết bằng code', W / 2, 680);
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    }
    var fade = prog(t, S.d.duration - 1.8, S.d.duration);
    if (fade > 0) { ctx.fillStyle = rgba(INK, fade); ctx.fillRect(0, 0, W, H); }
    hud(ctx, S, t, BONE, sec);
  };

  // ---------------------------------------------------------------- engine
  function create(canvas, data) {
    var S = new Song(data), sc = new Scenes(S);
    var ctx = canvas.getContext('2d', { alpha: false });
    var map = {
      intro: sc.intro, verse1: sc.verseNight, pre1: sc.pre, chorus1: sc.chorus,
      verse2: sc.versePanes, pre2: sc.pre, chorus2: sc.chorus, outro: sc.outro,
    };
    return {
      song: S,
      draw: function (t) {
        var scale = canvas.width / W;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = 1; ctx.letterSpacing = '0px';
        var sec = S.section(t);
        map[sec.id].call(sc, ctx, t, sec);
      },
    };
  }

  global.KhongCoPhepMau = { create: create, W: W, H: H };
})(typeof window !== 'undefined' ? window : this);
