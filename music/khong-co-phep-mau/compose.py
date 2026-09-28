#!/usr/bin/env python3
"""
"Không Có Phép Màu" – bài hát cho buivandat.com, viết hoàn toàn bằng code.

Chạy:  python3 compose.py [thư-mục-ra]
Ra:    song.wav (44.1 kHz, stereo) và song.json (nhịp, đoạn, lời theo từng chữ)

Mọi thứ đều xác định (deterministic): chạy lại luôn ra đúng một bài.
Giai điệu được sinh từ lời: mỗi chữ một nốt, hướng đi của nốt theo thanh điệu
tiếng Việt (sắc/ngã đi lên, huyền/nặng đi xuống, hỏi đi xuống nhẹ, ngang giữ),
rồi bám vào âm giai La thứ và hợp âm của từng ô nhịp.
"""
import json
import os
import sys
import unicodedata

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt, fftconvolve

SR = 44100
BPM = 100.0
BEAT = 60.0 / BPM
BAR = 4 * BEAT
RNG = np.random.default_rng(20260928)
TRANSPOSE = -3  # hạ cả bài 3 nửa cung (La thứ -> Fa thăng thứ) cho vừa giọng nam
KEY_LABEL = "Fa# thứ (F#m)"
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def chord_label(name):
    root = NOTE_NAMES[(ROOT[name] + TRANSPOSE) % 12]
    return root + ("m" if name.endswith("m") else "")

# ---------------------------------------------------------------- bố cục bài
# (id, tên hiển thị, số ô nhịp)
SECTIONS = [
    ("intro", "Intro", 4),
    ("verse1", "Verse 1", 8),
    ("pre1", "Pre-chorus", 4),
    ("chorus1", "Điệp khúc", 8),
    ("verse2", "Verse 2", 8),
    ("pre2", "Pre-chorus", 4),
    ("chorus2", "Điệp khúc", 8),
    ("outro", "Outro", 6),
]

# Hợp âm theo từng đoạn (mỗi phần tử = 1 ô nhịp), La thứ: Am F C G …
PROG = {
    "intro":   ["Am", "F", "C", "G"],
    "verse1":  ["Am", "F", "C", "G"] * 2,
    "pre1":    ["F", "G", "Em", "Am"],
    "chorus1": ["F", "G", "Am", "Am", "F", "G", "C", "E"],
    "verse2":  ["Am", "F", "C", "G"] * 2,
    "pre2":    ["F", "G", "Em", "E"],
    "chorus2": ["F", "G", "Am", "Am", "F", "G", "C", "Am"],
    "outro":   ["F", "G", "Am", "Am", "F", "Am"],
}
CHORDS = {  # nốt MIDI (không kể quãng tám)
    "Am": [9, 0, 4], "F": [5, 9, 0], "C": [0, 4, 7], "G": [7, 11, 2],
    "Em": [4, 7, 11], "E": [4, 8, 11], "Dm": [2, 5, 9],
}
ROOT = {"Am": 9, "F": 5, "C": 0, "G": 7, "Em": 4, "E": 4, "Dm": 2}
SCALE = [9, 11, 0, 2, 4, 5, 7]  # La thứ tự nhiên

# ---------------------------------------------------------------- lời
# Mỗi dòng: (đoạn, ô nhịp bắt đầu trong đoạn, số ô nhịp, lời)
LYRICS = [
    ("verse1", 0, 2, "Đêm khuya màn hình vẫn sáng"),
    ("verse1", 2, 2, "Từng dòng log chạy không ngơi"),
    ("verse1", 4, 2, "Người ta hứa giàu sau một đêm"),
    ("verse1", 6, 2, "Còn mình tin vào con số thôi"),
    ("pre1", 0, 2, "Không lối tắt, chẳng ai cho không"),
    ("pre1", 2, 2, "Chỉ có bước chân mình đi"),
    ("chorus1", 0, 1, "Không có phép màu"),
    ("chorus1", 1, 1, "Chỉ có kỷ luật mỗi ngày"),
    ("chorus1", 2, 1, "Công cụ trong tay"),
    ("chorus1", 3, 1, "Thông tin đúng dẫn đường"),
    ("chorus1", 4, 1, "Không có phép màu"),
    ("chorus1", 5, 1, "Đừng tin lời hứa trên mây"),
    ("chorus1", 6, 1, "Bùi Văn Đạt chấm com"),
    ("chorus1", 7, 1, "Ghi lại từng bước ta đi"),
    ("verse2", 0, 2, "Mở tab mới, kết nối máy xa"),
    ("verse2", 2, 2, "Kéo file lên, nhấp ngụm cà phê"),
    ("verse2", 4, 2, "Thắng thua ghi hết vào sổ"),
    ("verse2", 6, 2, "Sai một lần, nhớ cả năm"),
    ("pre2", 0, 2, "Ai cũng muốn đi thật nhanh"),
    ("pre2", 2, 2, "Mình chọn đi chậm mà chắc"),
    ("chorus2", 0, 1, "Không có phép màu"),
    ("chorus2", 1, 1, "Chỉ có kỷ luật mỗi ngày"),
    ("chorus2", 2, 1, "Công cụ trong tay"),
    ("chorus2", 3, 1, "Thông tin đúng dẫn đường"),
    ("chorus2", 4, 1, "Không có phép màu"),
    ("chorus2", 5, 1, "Đừng tin lời hứa trên mây"),
    ("chorus2", 6, 1, "Bùi Văn Đạt chấm com"),
    ("chorus2", 7, 1, "Ghi lại từng bước ta đi"),
    ("outro", 0, 2, "Không có phép màu"),
    ("outro", 2, 2, "Chỉ có mình và ngày mai"),
]

# Nhịp điệu (đơn vị: móc đơn = 1/2 phách). Dòng 2 ô nhịp = 16 móc đơn, 1 ô = 8.
RHYTHM2 = {  # (điểm bắt đầu, [độ dài từng chữ])
    4: (2, [2, 2, 3, 6]),
    5: (1, [2, 1, 2, 2, 6]),
    6: (1, [2, 1, 1, 2, 2, 6]),
    7: (1, [1, 1, 2, 1, 1, 2, 6]),
    8: (1, [1, 1, 1, 1, 2, 1, 1, 6]),
}
RHYTHM1 = {
    4: (0, [1, 1, 2, 3]),
    5: (0, [1, 1, 1, 2, 2]),
    6: (0, [1, 1, 1, 1, 1, 2]),
}


def tone(syllable):
    """Thanh điệu tiếng Việt của một chữ."""
    marks = unicodedata.normalize("NFD", syllable.lower())
    if "́" in marks: return "sac"
    if "̀" in marks: return "huyen"
    if "̉" in marks: return "hoi"
    if "̃" in marks: return "nga"
    if "̣" in marks: return "nang"
    return "ngang"


TONE_STEP = {"sac": 2, "nga": 2, "ngang": 0, "hoi": -1, "huyen": -2, "nang": -2}


def section_start_bars():
    out, bar = {}, 0
    for sid, _, n in SECTIONS:
        out[sid] = bar
        bar += n
    return out, bar


START_BAR, TOTAL_BARS = section_start_bars()
DURATION = TOTAL_BARS * BAR + 2.5  # đuôi reverb


def chord_at_bar(bar):
    for sid, _, n in SECTIONS:
        s = START_BAR[sid]
        if s <= bar < s + n:
            return PROG[sid][bar - s]
    return "Am"


def section_at_bar(bar):
    for sid, _, n in SECTIONS:
        if START_BAR[sid] <= bar < START_BAR[sid] + n:
            return sid
    return SECTIONS[-1][0]


def scale_notes(lo, hi):
    return [m for m in range(lo, hi + 1) if m % 12 in SCALE]


def nearest(cands, target):
    return min(cands, key=lambda m: (abs(m - target), m))


# ---------------------------------------------------------------- giai điệu
MAX_LEAP = 5  # tối đa một quãng 4 đúng giữa hai chữ liền nhau


def limit_leap(cands, target, prev):
    ok = [m for m in cands if abs(m - prev) <= MAX_LEAP]
    return nearest(ok, target) if ok else nearest(cands, prev)


def compose_melody():
    notes, lines = [], []
    prev = None
    memory = {}  # cùng một câu ở điệp khúc -> cùng một giai điệu (hook)
    for sid, bar_off, nbars, text in LYRICS:
        words = text.replace(",", "").split()
        chorus = sid.startswith("chorus")
        lo, hi = (69, 81) if chorus else (62, 74)   # điệp khúc hát cao hơn
        if sid == "outro":
            lo, hi = (64, 76)
        pool = scale_notes(lo, hi)
        start8, durs = (RHYTHM1 if nbars == 1 else RHYTHM2)[len(words)]
        t8 = start8
        line_bar = START_BAR[sid] + bar_off
        centre = (lo + hi) // 2 + (2 if chorus else 0)
        cur = prev if prev is not None and lo <= prev <= hi else centre
        line_words = []
        key = (text, nbars, chorus)
        remembered = memory.get(key)
        pitches = []
        for i, (w, d8) in enumerate(zip(words, durs)):
            beat_in_line = t8 / 2.0
            bar = line_bar + int(beat_in_line // 4)
            chord = chord_at_bar(bar)
            tones = [m for m in range(lo, hi + 1) if m % 12 in CHORDS[chord]]
            strong = (t8 % 4 == 0)
            idx = pool.index(nearest(pool, cur))
            if i == 0:
                target = nearest(tones, centre if prev is None else cur)
            else:
                step = TONE_STEP[tone(w)]
                if step == 0 and d8 >= 2:
                    step = 1 if (i % 2) else -1  # tránh đứng yên quá lâu
                idx = max(0, min(len(pool) - 1, idx + step))
                target = pool[idx]
                if strong or i == len(words) - 1:
                    target = limit_leap(tones, target, cur)
                elif abs(target - cur) > MAX_LEAP:
                    target = limit_leap(pool, target, cur)
            # chữ cuối dòng: về nốt gốc/quãng ba của hợp âm cho có cảm giác "chốt"
            if i == len(words) - 1:
                ends = [m for m in tones if m % 12 in CHORDS[chord][:2]]
                target = limit_leap(ends, target, cur) if i else nearest(ends, target)
            if remembered:
                target = remembered[i]
            pitches.append(target)
            cur = target
            t0 = line_bar * BAR + t8 * BEAT / 2
            dur = d8 * BEAT / 2
            notes.append({"t": t0, "d": dur, "m": int(target), "w": w})
            line_words.append({"text": w, "start": round(t0, 4), "end": round(t0 + dur, 4)})
            t8 += d8
        if chorus and key not in memory:
            memory[key] = pitches
        prev = cur
        lines.append({
            "section": sid, "text": text,
            "start": line_words[0]["start"], "end": line_words[-1]["end"],
            "words": line_words,
        })
    return notes, lines


# ---------------------------------------------------------------- tổng hợp âm
N = int(DURATION * SR)
T = np.arange(N) / SR


def mtof(m):
    return 440.0 * 2 ** ((m + TRANSPOSE - 69) / 12)


def env_adsr(n, a, d, s, r, sr=SR):
    a_n, d_n, r_n = int(a * sr), int(d * sr), int(r * sr)
    e = np.ones(n) * s
    if a_n: e[:a_n] = np.linspace(0, 1, a_n)
    if d_n: e[a_n:a_n + d_n] = np.linspace(1, s, min(d_n, max(0, n - a_n)))[: max(0, min(d_n, n - a_n))]
    if r_n and n > r_n: e[-r_n:] *= np.linspace(1, 0, r_n)
    return e


def lp(x, fc, order=2):
    return sosfilt(butter(order, min(fc, SR * 0.45), "low", fs=SR, output="sos"), x)


def hp(x, fc, order=2):
    return sosfilt(butter(order, fc, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


def tv_lp(x, fc):
    """Lọc thông thấp một cực với tần số cắt thay đổi theo thời gian."""
    a = 1.0 - np.exp(-2 * np.pi * np.asarray(fc) / SR)
    y = np.empty_like(x); acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y


def saw(ph):
    return 2.0 * (ph - np.floor(ph + 0.5))


def add(buf, start_s, sig, gain=1.0):
    i = int(start_s * SR)
    if i >= len(buf): return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i] * gain


def kick():
    n = int(0.45 * SR); t = np.arange(n) / SR
    f = 45 + 95 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 7.5)
    click = hp(RNG.standard_normal(n), 2000) * np.exp(-t * 180) * 0.25
    return np.tanh((body + click) * 1.6)


def snare():
    n = int(0.3 * SR); t = np.arange(n) / SR
    noise = bp(RNG.standard_normal(n), 1200, 8000) * np.exp(-t * 16)
    tone_ = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 28) * 0.6
    return (noise * 0.8 + tone_) * 0.9


def clap():
    n = int(0.25 * SR); t = np.arange(n) / SR
    e = np.zeros(n)
    for k, off in enumerate([0, 0.011, 0.022]):
        i = int(off * SR); e[i:] += np.exp(-(t[: n - i]) * (60 if k < 2 else 18))
    return bp(RNG.standard_normal(n), 900, 5000) * e * 0.7


def hat(open_=False):
    n = int((0.22 if open_ else 0.05) * SR); t = np.arange(n) / SR
    return hp(RNG.standard_normal(n), 7000) * np.exp(-t * (12 if open_ else 90)) * 0.35


def crash():
    n = int(2.2 * SR); t = np.arange(n) / SR
    return hp(RNG.standard_normal(n), 4500) * np.exp(-t * 2.2) * 0.35


def riser(dur):
    n = int(dur * SR); t = np.arange(n) / SR
    x = RNG.standard_normal(n)
    out = np.zeros(n)
    segs = 24
    for k in range(segs):
        a, b = k * n // segs, (k + 1) * n // segs
        fc = 400 * (12 ** (k / segs))
        out[a:b] = bp(x[a:b], fc, min(fc * 2.5, 16000))
    return out * (t / dur) ** 2 * 0.5


_cache = {}


def cached(fn):
    def wrap(*args):
        key = (fn.__name__,) + tuple(round(a, 5) if isinstance(a, float) else a for a in args)
        if key not in _cache:
            _cache[key] = fn(*args)
        return _cache[key]
    wrap.__name__ = fn.__name__
    return wrap


@cached
def synth_bass(m, dur, vel=1.0):
    n = int(dur * SR); t = np.arange(n) / SR
    f = mtof(m)
    x = saw(f * t) * 0.6 + np.sin(2 * np.pi * f * t) * 0.8
    x = tv_lp(tv_lp(x, 180 + 900 * np.exp(-t * 18)), 180 + 900 * np.exp(-t * 18))
    return x * env_adsr(n, 0.004, 0.12, 0.75, 0.05) * vel


def synth_pad(ms, dur):
    n = int(dur * SR); t = np.arange(n) / SR
    x = np.zeros(n)
    for m in ms:
        for det in (-0.08, 0.0, 0.08):
            f = mtof(m + det)
            x += saw(f * t + RNG.random())
    x = lp(x / (3 * len(ms)), 2800)
    return x * env_adsr(n, 0.35, 0.4, 0.8, 0.6)


@cached
def synth_pluck(m, dur):
    n = int(dur * SR); t = np.arange(n) / SR
    f = mtof(m)
    x = np.sign(np.sin(2 * np.pi * f * t)) * 0.5 + saw(f * 1.002 * t) * 0.5
    x = tv_lp(x, 1500 + 6000 * np.exp(-t * 22))
    return x * np.exp(-t * 9) * env_adsr(n, 0.002, 0.0, 1.0, 0.03)


def synth_lead(notes):
    """Giọng lead thay lời hát: có luyến (glide), rung (vibrato) và thở."""
    out = np.zeros(N)
    freq = np.zeros(N)
    amp = np.zeros(N)
    for k, nt in enumerate(notes):
        i0, i1 = int(nt["t"] * SR), int((nt["t"] + nt["d"]) * SR)
        f = mtof(nt["m"])
        prev_f = mtof(notes[k - 1]["m"]) if k and abs(notes[k - 1]["t"] + notes[k - 1]["d"] - nt["t"]) < 0.05 else f
        n = i1 - i0
        g = min(int(0.045 * SR), n)
        seg = np.full(n, f)
        seg[:g] = prev_f * (f / prev_f) ** (np.linspace(0, 1, g) ** 0.6)
        tt = np.arange(n) / SR
        vib_depth = np.clip((tt - 0.18) / 0.3, 0, 1) * 0.012
        seg *= 1 + vib_depth * np.sin(2 * np.pi * 5.4 * tt)
        freq[i0:i1] = seg
        e = env_adsr(n, 0.025, 0.1, 0.85, min(0.09, nt["d"] * 0.3))
        amp[i0:i1] = np.maximum(amp[i0:i1], e * (0.92 + 0.08 * RNG.random()))
    ph = np.cumsum(freq) / SR
    x = saw(ph) * 0.55 + np.sign(np.sin(2 * np.pi * ph)) * 0.18 + np.sin(2 * np.pi * ph) * 0.5
    breath = bp(RNG.standard_normal(N), 2000, 7000) * 0.025
    x = lp(x, 5500, 2) + breath
    # formant nhẹ cho "giống giọng" hơn
    x = x + bp(x, 700, 1300) * 0.6 + bp(x, 2300, 3400) * 0.45
    out = x * amp
    return out


def main(outdir):
    os.makedirs(outdir, exist_ok=True)
    notes, lines = compose_melody()

    drums = np.zeros(N); bass = np.zeros(N); pad = np.zeros(N); pluck = np.zeros(N); fx = np.zeros(N)
    duck = np.ones(N)
    K, S, C, H, HO = kick(), snare(), clap(), hat(), hat(True)
    kicks, snares, downbeats, beats = [], [], [], []

    for bar in range(TOTAL_BARS):
        sid = section_at_bar(bar)
        t_bar = bar * BAR
        chord = chord_at_bar(bar)
        in_sec = bar - START_BAR[sid]
        last_bar_of_sec = in_sec == dict((s, n) for s, _, n in SECTIONS)[sid] - 1
        downbeats.append(round(t_bar, 4))
        for b in range(4):
            beats.append(round(t_bar + b * BEAT, 4))

        # ---- trống
        if sid in ("chorus1", "chorus2"):
            kpos = [0, 1, 2, 3]
        elif sid in ("verse1", "verse2"):
            kpos = [0, 1.5, 2.5] if in_sec % 2 else [0, 2, 2.75]
        elif sid.startswith("pre"):
            kpos = [0, 2] if not last_bar_of_sec else [0, 1, 2, 3, 3.5]
        elif sid == "outro":
            kpos = [0, 2] if in_sec < 4 else ([0] if in_sec == 4 else [])
        else:
            kpos = [0] if in_sec >= 2 else []
        for p in kpos:
            t = t_bar + p * BEAT
            add(drums, t, K, 0.95); kicks.append(round(t, 4))
            i = int(t * SR); n = int(0.28 * SR)
            if i + n < N:
                duck[i:i + n] = np.minimum(duck[i:i + n], 0.45 + 0.55 * np.linspace(0, 1, n) ** 0.7)
        if sid not in ("intro",) and not (sid == "outro" and in_sec >= 5):
            for p in (1, 3):
                t = t_bar + p * BEAT
                add(drums, t, S, 0.8); add(drums, t, C, 0.6); snares.append(round(t, 4))
            if sid.startswith("pre") and last_bar_of_sec:
                for k in range(8):
                    add(drums, t_bar + (2 + k * 0.25) * BEAT, S, 0.18 + 0.05 * k)
        hat_step = 0.25 if sid.startswith("chorus") else 0.5
        if sid != "intro" or in_sec >= 2:
            p = 0.0
            while p < 4:
                accent = 0.9 if (p * 2) % 2 == 1 else 0.55
                add(drums, t_bar + p * BEAT + 0.008 * RNG.standard_normal(), H, accent * (1.3 if sid != "outro" else 0.8))
                p += hat_step
        if sid.startswith("chorus") and in_sec % 2 == 1:
            add(drums, t_bar + 3.5 * BEAT, HO, 0.6)
        if in_sec == 0 and sid in ("chorus1", "chorus2", "verse2", "outro"):
            add(fx, t_bar, crash(), 0.9)
        if sid.startswith("pre") and last_bar_of_sec:
            add(fx, t_bar, riser(BAR), 1.0)

        # ---- bass
        if sid != "intro" or in_sec >= 2:
            r = 36 + ROOT[chord] if ROOT[chord] >= 4 else 48 + ROOT[chord]
            pattern = [0, 0.5, 1.5, 2, 2.5, 3.5] if sid.startswith("chorus") else [0, 1.5, 2, 3]
            if sid == "outro" and in_sec >= 4:
                pattern = [0]
            for k, p in enumerate(pattern):
                d = (pattern[k + 1] if k + 1 < len(pattern) else 4) - p
                oct_ = 12 if (sid.startswith("chorus") and p in (0.5, 2.5)) else 0
                add(bass, t_bar + p * BEAT, synth_bass(r + oct_, d * BEAT * 0.92), 0.7)

        # ---- pad
        ms = [60 + (c if c >= 5 else c + 12) for c in CHORDS[chord]]
        add(pad, t_bar, synth_pad(ms, BAR + 0.4), 0.55 if sid.startswith("chorus") else 0.4)

        # ---- arpeggio (intro, verse 2, điệp khúc)
        if sid in ("intro", "verse2", "chorus1", "chorus2", "outro") and not (sid == "outro" and in_sec >= 5):
            tones = sorted([72 + (c if c >= 5 else c + 12) - 12 for c in CHORDS[chord]])
            seq = [tones[0], tones[1], tones[2], tones[1] + 12 - 12, tones[2], tones[0] + 12, tones[2], tones[1]]
            for k in range(16):
                add(pluck, t_bar + k * BEAT / 4, synth_pluck(seq[k % 8], BEAT / 4 * 1.8), 0.22 if sid != "intro" else 0.3)

    lead = synth_lead(notes)
    vocal = np.zeros(N)
    vpath = os.path.join(outdir, "vocal.wav")
    has_vocal = os.path.exists(vpath)
    if has_vocal:  # giọng hát từ sing.py
        _, v = wavfile.read(vpath)
        v = v.astype(np.float64) / 32767
        vocal[: min(N, len(v))] = v[:N]
        vocal = hp(vocal, 110)
        vocal = vocal + bp(vocal, 2500, 5000) * 0.5      # rõ lời
        vocal = vocal - bp(vocal, 250, 450) * 0.3        # bớt ù
        lead = lead * 0.25                               # synth lùi xuống làm nền dẫn giai điệu

    # ---- trộn & hiệu ứng
    pad_d = pad * duck
    pluck_d = pluck * (0.6 + 0.4 * duck)
    bass_d = hp(bass, 40) * (0.5 + 0.5 * duck)

    ir_n = int(2.2 * SR); ir_t = np.arange(ir_n) / SR
    ir = RNG.standard_normal((2, ir_n)) * np.exp(-ir_t * 3.2)
    ir[:, : int(0.012 * SR)] = 0
    send = lead * 0.35 * 0.27 + vocal * 0.5 + pad_d * 0.25 + pluck_d * 0.35 + drums * 0.03
    send = hp(send, 250)
    rev = np.stack([fftconvolve(send, ir[c])[:N] for c in range(2)]) * 0.06

    dly = np.zeros((2, N))
    d_n = int(BEAT * 0.75 * SR)
    for c, off in enumerate([d_n, int(d_n * 1.5)]):
        src = lp(lead, 2500) * 0.28 * 0.27 + lp(vocal, 5000) * 0.22
        for k in range(1, 4):
            dly[c, off * k:] += src[: N - off * k] * (0.45 ** k)

    G = {"drums": 0.55, "bass": 0.36, "pad": 1.35, "pluck": 1.0, "lead": 0.27, "fx": 0.6, "vocal": 2.5}
    if os.environ.get("STEMS"):
        for name, st in [("drums", drums * G["drums"]), ("bass", bass_d * G["bass"]), ("pad", pad_d * G["pad"]), ("pluck", pluck_d * G["pluck"]), ("lead", lead * G["lead"]), ("vocal", vocal * G["vocal"])]:
            print(f"  {name:6} rms {20*np.log10(np.sqrt((st**2).mean())+1e-9):6.1f}  peak {np.abs(st).max():.2f}")
    L = drums * G["drums"] + bass_d * G["bass"] + pad_d * G["pad"] * 0.95 + pluck_d * G["pluck"] * 1.15 + lead * G["lead"] + vocal * G["vocal"] + fx * G["fx"]
    R = drums * G["drums"] + bass_d * G["bass"] + pad_d * G["pad"] * 1.05 + pluck_d * G["pluck"] * 0.85 + lead * G["lead"] + vocal * G["vocal"] + fx * G["fx"]
    mix = np.stack([L, R]) + rev + dly
    mix = hp(mix, 28)
    mix = mix + hp(mix, 2500) * 0.7   # kệ cao (high shelf) cho sáng

    # master: nén mềm + giới hạn
    mix /= np.max(np.abs(mix))
    mix = np.tanh(mix * 1.6) / np.tanh(1.6)   # nén mềm, không làm rè
    fade = np.ones(N); fn = int(2.0 * SR); fade[-fn:] = np.linspace(1, 0, fn) ** 1.5
    mix *= fade
    mix /= np.max(np.abs(mix)) / 0.89
    wavfile.write(os.path.join(outdir, "song.wav"), SR, (mix.T * 32767).astype(np.int16))

    loud = np.sqrt(np.convolve((mix ** 2).mean(0), np.ones(int(0.05 * SR)) / int(0.05 * SR), "same"))
    step = int(SR / 30)
    env = (loud[::step] / (loud.max() or 1)).round(3).tolist()

    sections, bar = [], 0
    for sid, label, n in SECTIONS:
        sections.append({"id": sid, "label": label, "start": round(bar * BAR, 4), "end": round((bar + n) * BAR, 4)})
        bar += n

    data = {
        "title": "Không Có Phép Màu",
        "artist": "buivandat.com",
        "bpm": BPM, "duration": round(TOTAL_BARS * BAR + 2.0, 3),
        "key": KEY_LABEL, "vocal": has_vocal,
        "sections": sections,
        "beats": beats, "downbeats": downbeats, "kicks": kicks, "snares": snares,
        "chords": [{"start": round(b * BAR, 4), "name": chord_label(chord_at_bar(b))} for b in range(TOTAL_BARS)],
        "lines": lines,
        "envelope_fps": 30, "envelope": env,
    }
    with open(os.path.join(outdir, "song.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"song.wav + song.json → {outdir}  ({data['duration']:.1f}s, {len(notes)} nốt, {len(lines)} dòng lời)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__)) + "/build")
