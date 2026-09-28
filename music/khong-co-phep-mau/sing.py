#!/usr/bin/env python3
"""
Giọng hát (nam) cho "Không Có Phép Màu" – bản 2, tự nhiên hơn.

1. Đọc CẢ CÂU liền mạch (Piper TTS, giọng nam VIVOS #57, đọc chậm) để giữ phần
   nối âm tự nhiên giữa các chữ; ranh giới từng chữ được dò bằng DTW (so khớp
   với bản đọc từng chữ riêng).
2. WORLD tách cao độ – âm sắc – hơi của cả câu, rồi dựng lại cả câu một lần trên
   dòng thời gian của bài hát: kéo dãn nguyên âm, phụ âm đầu vào trước phách.
3. Cao độ như người hát: lướt vào nốt đầu câu, luyến có đà (vượt nhẹ rồi về),
   rung không đều chỉ ở nốt dài, luyến láy nhẹ theo dấu tiếng Việt, buông cuối câu.
4. Âm lượng có nhấn nhá: vòm theo câu, nốt dài to dần, nốt cao to hơn, tiếng lấy hơi.
5. Mở rộng dải cao (8 kHz -> 16 kHz) cho giọng sáng và "có hơi", tổng hợp ở 44.1 kHz.

Chạy:  python3 sing.py --model đường/dẫn/vi-vivos-x-low.onnx [--speaker 57]
Ra:    build/vocal.wav (44.1 kHz, mono) – compose.py sẽ tự trộn vào bài.

Model giọng đọc (không kèm trong repo, ~25 MB, CC BY-NC-SA 4.0):
https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-vi-vivos-x-low.tar.gz
"""
import argparse
import importlib.util
import os
import unicodedata

import numpy as np
import pyworld as pw
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

HERE = os.path.dirname(os.path.abspath(__file__))
FS_TTS = 16000
FS = 44100
FP = 5.0                      # ms / khung WORLD
FPS = 1000 / FP
OCTAVE_DOWN = 12
SPELL = {"log": "lốc", "tab": "táp", "file": "phai", "com": "com"}


def load_compose():
    spec = importlib.util.spec_from_file_location("compose", os.path.join(HERE, "compose.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def say(voice, cfg, text):
    x = np.concatenate([c.audio_float_array for c in voice.synthesize(text, syn_config=cfg)]).astype(np.float64)
    env = np.convolve(np.abs(x), np.ones(160) / 160, "same")
    on = np.where(env > env.max() * 0.03)[0]
    return x[max(0, on[0] - 80): on[-1] + 160]


# ---------------------------------------------------------------- DTW căn chữ
def mfcc(x, fs=FS_TTS):
    n, hop = 400, 160  # 25 ms / 10 ms (= 2 khung WORLD)
    if len(x) < n:
        x = np.pad(x, (0, n - len(x)))
    frames = np.lib.stride_tricks.sliding_window_view(x, n)[::hop] * np.hamming(n)
    P = np.abs(np.fft.rfft(frames, 512)) ** 2
    mel = lambda f: 2595 * np.log10(1 + f / 700)
    imel = lambda m: 700 * (10 ** (m / 2595) - 1)
    pts = imel(np.linspace(mel(80), mel(7600), 28))
    bins = np.floor((512 + 1) * pts / fs).astype(int)
    fb = np.zeros((26, P.shape[1]))
    for i in range(26):
        a, b, c = bins[i], bins[i + 1], bins[i + 2]
        fb[i, a:b] = np.linspace(0, 1, max(1, b - a), endpoint=False)
        fb[i, b:c] = np.linspace(1, 0, max(1, c - b), endpoint=False)
    E = np.log(P @ fb.T + 1e-10)
    k = np.arange(26)
    dct = np.cos(np.pi / 26 * (k[None, :] + 0.5) * np.arange(1, 14)[:, None])
    C = E @ dct.T
    return (C - C.mean(0)) / (C.std(0) + 1e-6)


def dtw_boundaries(ref_words, line):
    """ref_words: danh sách tín hiệu từng chữ; line: tín hiệu cả câu -> chỉ số khung bắt đầu mỗi chữ trong câu."""
    A = np.concatenate([mfcc(w) for w in ref_words])
    starts = np.cumsum([0] + [len(mfcc(w)) for w in ref_words])[:-1]
    B = mfcc(line)
    na, nb = len(A), len(B)
    cost = 1 - (A @ B.T) / (np.linalg.norm(A, axis=1)[:, None] * np.linalg.norm(B, axis=1)[None, :] + 1e-9)
    D = np.full((na + 1, nb + 1), np.inf); D[0, 0] = 0
    for i in range(1, na + 1):
        ci = cost[i - 1]
        for j in range(1, nb + 1):
            D[i, j] = ci[j - 1] + min(D[i - 1, j], D[i, j - 1], D[i - 1, j - 1])
    i, j, path = na, nb, []
    while i > 0 and j > 0:
        path.append((i - 1, j - 1))
        k = np.argmin([D[i - 1, j - 1], D[i - 1, j], D[i, j - 1]])
        if k == 0: i, j = i - 1, j - 1
        elif k == 1: i -= 1
        else: j -= 1
    path = path[::-1]
    a2b = {}
    for a, b in path:
        a2b.setdefault(a, b)
    bounds = [a2b.get(s, 0) for s in starts]
    return [bounds[k] for k in range(len(bounds))], nb


# ---------------------------------------------------------------- tiện ích
def tone(w):
    m = unicodedata.normalize("NFD", w.lower())
    for mark, name in (("́", "sac"), ("̀", "huyen"), ("̉", "hoi"), ("̃", "nga"), ("̣", "nang")):
        if mark in m:
            return name
    return "ngang"


def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def smooth_noise(n, rng, width):
    x = rng.standard_normal(n + width * 2)
    k = np.hanning(width * 2 + 1); k /= k.sum()
    return np.convolve(x, k, "same")[width: width + n] * np.sqrt(width)


def stretch_index(n_src, n_dst, keep_head, keep_tail):
    keep_head = min(keep_head, n_src // 3, n_dst // 3)
    keep_tail = min(keep_tail, n_src // 3, n_dst // 3)
    mid_src = max(1, n_src - keep_head - keep_tail)
    mid_dst = max(1, n_dst - keep_head - keep_tail)
    i = np.arange(n_dst, dtype=float)
    idx = np.where(i < keep_head, i,
          np.where(i >= n_dst - keep_tail, n_src - (n_dst - i),
                   keep_head + (i - keep_head) * (mid_src - 1) / max(1, mid_dst - 1)))
    return np.clip(idx, 0, n_src - 1)


def hold_index(n_src, n_dst, h0, h1):
    """Ánh xạ khung đích -> nguồn: giữ nguyên đầu [0,h0) và cuối [h1,n), ngân dài đoạn [h0,h1)."""
    head, tail = h0, n_src - h1
    if head + tail + 2 > n_dst:                     # nốt ngắn hơn chữ: co đều
        return np.linspace(0, n_src - 1, n_dst)
    mid = n_dst - head - tail
    return np.concatenate([np.arange(head), np.linspace(h0, max(h0, h1 - 1), mid), np.arange(h1, n_src)]).astype(float)


def interp_rows(mat, idx):
    lo = np.floor(idx).astype(int); hi = np.minimum(lo + 1, len(mat) - 1)
    w = (idx - lo)[:, None]
    return mat[lo] * (1 - w) + mat[hi] * w


def widen_band(sp16, ap16, fft_out):
    """Đổi phổ WORLD 16 kHz sang 44.1 kHz, ngoại suy dải trên 7.8 kHz (sáng + có hơi)."""
    f_src = np.arange(sp16.shape[1]) * FS_TTS / ((sp16.shape[1] - 1) * 2)
    f_dst = np.arange(fft_out // 2 + 1) * FS / fft_out
    edge = 7600.0
    lsp = np.log(sp16 + 1e-16)
    out_l = np.empty((len(sp16), len(f_dst))); out_a = np.empty_like(out_l)
    low = f_dst <= edge
    for r in range(len(sp16)):
        out_l[r, low] = np.interp(f_dst[low], f_src, lsp[r])
        out_a[r, low] = np.interp(f_dst[low], f_src, ap16[r])
    ref = np.log(np.mean(np.exp(lsp[:, (f_src > 6000) & (f_src <= edge)]), axis=1) + 1e-16)
    oct_ = np.log2(f_dst[~low] / edge)
    out_l[:, ~low] = ref[:, None] - (15 * np.log(10) / 10) * oct_[None, :]   # -15 dB/quãng tám
    a_edge = out_a[:, low][:, -1:]
    out_a[:, ~low] = np.clip(a_edge + (0.93 - a_edge) * np.clip(oct_ / 0.8, 0, 1)[None, :], 0, 0.999)
    return np.exp(out_l), out_a


# ---------------------------------------------------------------- đường cao độ & âm lượng
def pitch_curve(note, n, ctx, rng):
    """Cao độ (cent so với nốt đích) cho n khung thân nốt."""
    t = np.arange(n) / FPS
    c = np.zeros(n)
    if ctx["prev_hz"] is not None:
        # luyến có đà: vượt nhẹ qua nốt đích rồi về (dao động tắt dần)
        d0 = 1200 * np.log2(ctx["prev_hz"] / note["hz"])
        c += d0 * np.exp(-t / 0.032) * np.cos(2 * np.pi * t / 0.16)
    elif ctx["phrase_start"]:
        c += -60 * np.exp(-t / 0.045)                      # lướt vào nốt đầu câu
    dur = note["d"]
    if dur >= 0.42:                                        # rung chỉ ở nốt dài, không đều
        rate = 5.1 + 0.8 * rng.random() + 0.25 * smooth_noise(n, rng, 40)
        phase = 2 * np.pi * np.cumsum(rate) / FPS + rng.random() * 6.28
        depth = (18 + 20 * rng.random()) * np.clip((t - 0.2) / 0.35, 0, 1)
        depth *= np.clip((dur - t) / 0.08, 0, 1)
        c += depth * np.sin(phase)
    k = np.clip((t - dur * 0.7) / max(0.05, dur * 0.3), 0, 1)  # 30% cuối nốt
    tn = note["tone"]
    if tn == "huyen": c += -30 * k
    elif tn == "nang": c += -55 * k
    elif tn == "sac": c += 18 * k
    elif tn == "nga": c += 22 * k
    elif tn == "hoi": c += -35 * np.sin(np.pi * np.clip((t / max(dur, 0.1) - 0.45) / 0.5, 0, 1))
    if ctx["phrase_end"]:                                  # buông cuối câu
        c += -85 * np.clip((t - (dur - 0.14)) / 0.14, 0, 1) ** 2
    c += 5 * smooth_noise(n, rng, 20)
    return note["hz"] * 2 ** (c / 1200)


def gain_curve(note, n, ctx, ref_hz):
    t = np.arange(n) / FPS
    g = np.ones(n)
    g *= 2 ** (np.log2(note["hz"] / ref_hz) * 0.45)       # nốt cao to hơn (~ +2.7 dB/quãng tám)
    if note["d"] >= 0.42:
        g *= 1 + 0.18 * np.sin(np.pi * np.clip(t / note["d"], 0, 1)) ** 0.8   # to dần rồi nhỏ lại
    g *= 0.92 + 0.08 * np.sin(np.pi * ctx["pos"])          # vòm theo câu
    if note["tone"] == "nang":
        g *= 1 - 0.55 * np.clip((t - note["d"] * 0.75) / (note["d"] * 0.25 + 1e-3), 0, 1)
    if ctx["phrase_end"]:
        g *= np.clip((note["d"] - t) / 0.12, 0, 1) ** 0.7
    return g


# ---------------------------------------------------------------- dựng cả câu
def render_line(words_audio, line_audio, notes, rng, ref_hz, line_first, line_last_gap):
    bounds, nb = dtw_boundaries(words_audio, line_audio)
    f0, t = pw.harvest(line_audio, FS_TTS, f0_floor=60, f0_ceil=400, frame_period=FP)
    sp = pw.cheaptrick(line_audio, f0, t, FS_TTS)
    ap = pw.d4c(line_audio, f0, t, FS_TTS)
    nfr = len(f0)
    bounds = [min(b * 2, nfr - 1) for b in bounds] + [nfr]
    # bảo đảm ranh giới tăng dần và mỗi chữ dài ít nhất 90 ms (DTW đôi khi để chữ trước "lấn" chữ sau)
    MIN = int(0.09 * FPS)
    bounds = [0] + bounds[1:-1] + [nfr]
    for _ in range(3):
        for i in range(len(bounds) - 1):
            if bounds[i + 1] - bounds[i] < MIN:
                left = bounds[i] - bounds[i - 1] if i > 0 else 0
                right = bounds[i + 2] - bounds[i + 1] if i + 2 < len(bounds) else 0
                need = MIN - (bounds[i + 1] - bounds[i])
                if left >= right and i > 0:
                    bounds[i] -= min(need, max(0, left - MIN))
                elif i + 2 < len(bounds):
                    bounds[i + 1] += min(need, max(0, right - MIN))
    bounds = [int(min(max(b, 0), nfr)) for b in bounds]

    # khung "nguyên âm": có cao độ VÀ phần tần thấp tuần hoàn (tránh kéo dãn nhầm phụ âm xát như s, x, ph)
    f_axis = np.arange(ap.shape[1]) * FS_TTS / ((ap.shape[1] - 1) * 2)
    ap_low = ap[:, (f_axis > 100) & (f_axis < 2000)].mean(1)
    periodic = (f0 > 0) & (ap_low < 0.3)

    t0 = notes[0]["t"] - 0.15
    t_end = notes[-1]["t"] + notes[-1]["d"] + 0.05
    N = int((t_end - t0) * FPS) + 1
    out_f0 = np.zeros(N)
    out_sp = np.full((N, sp.shape[1]), 1e-12)
    out_ap = np.full((N, ap.shape[1]), 0.999)
    out_g = np.ones(N)

    prev_hz = None
    for i, nt in enumerate(notes):
        s, e = bounds[i], max(bounds[i] + 3, bounds[i + 1])
        voiced = np.where(periodic[s:e])[0]
        if len(voiced) == 0:
            voiced = np.where(f0[s:e] > 0)[0]
        if len(voiced) == 0:
            voiced = np.arange(e - s)
        v0, v1 = s + voiced[0], s + voiced[-1] + 1
        cons = min(v0 - s, int(0.13 * FPS))                 # phụ âm đầu (s, x, ph… cần dài hơn một chút)
        coda = min(e - v1, int(0.07 * FPS))                 # phụ âm cuối vô thanh
        start_f = int((nt["t"] - t0) * FPS)
        # thân nốt kéo tới trước phụ âm đầu của nốt sau (nếu liền) hoặc tới hết nốt
        nxt = notes[i + 1] if i + 1 < len(notes) else None
        legato_next = nxt is not None and nxt["t"] - (nt["t"] + nt["d"]) < 0.06
        end_t = nt["t"] + nt["d"]
        body_n = max(6, int((end_t - nt["t"]) * FPS) - (0 if legato_next else coda) + (2 if legato_next else 0))
        # phụ âm đầu: đặt ngay trước phách
        a = max(0, start_f - cons)
        out_sp[a:start_f] = sp[v0 - (start_f - a):v0]; out_ap[a:start_f] = ap[v0 - (start_f - a):v0]
        # thân: ngân dài đoạn nguyên âm "trong" nhất (ít hơi, ổn định), giữ nguyên đoạn chuyển đầu/cuối
        nv = v1 - v0
        win = max(3, int(nv * 0.35))
        score = np.convolve(ap_low[v0:v1], np.ones(win) / win, "valid")
        lo = int(nv * 0.2)
        hi = max(lo + 1, min(len(score), nv - win - int(nv * 0.1)))
        h0 = lo + int(np.argmin(score[lo:hi])) if hi > lo else max(0, (nv - win) // 2)
        idx = hold_index(nv, body_n, h0, h0 + win) + v0
        b_end = min(N, start_f + body_n)
        seg_n = b_end - start_f
        out_sp[start_f:b_end] = np.exp(interp_rows(np.log(sp + 1e-16), idx[:seg_n]))
        body_ap = interp_rows(ap, idx[:seg_n])
        body_ap[:, f_axis < 3000] = np.minimum(body_ap[:, f_axis < 3000], 0.18)   # nguyên âm trong hơn khi ngân
        out_ap[start_f:b_end] = body_ap
        ctx = {"prev_hz": prev_hz if i > 0 and nt["t"] - (notes[i - 1]["t"] + notes[i - 1]["d"]) < 0.06 else None,
               "phrase_start": i == 0, "phrase_end": i == len(notes) - 1, "pos": i / max(1, len(notes) - 1)}
        out_f0[start_f:b_end] = pitch_curve(nt, body_n, ctx, rng)[:seg_n]
        out_g[start_f:b_end] = gain_curve(nt, body_n, ctx, ref_hz)[:seg_n]
        # phụ âm cuối
        if not legato_next and coda > 0:
            c_end = min(N, b_end + coda)
            out_sp[b_end:c_end] = sp[v1:v1 + (c_end - b_end)]; out_ap[b_end:c_end] = ap[v1:v1 + (c_end - b_end)]
        prev_hz = nt["hz"]

    # tránh bật tiếng: làm mềm các chỗ f0 bật/tắt đột ngột bằng âm lượng
    out_sp *= (out_g ** 2)[:, None]
    fft_out = pw.get_cheaptrick_fft_size(FS, 71.0)
    sp44, ap44 = widen_band(out_sp, out_ap, fft_out)
    y = pw.synthesize(np.ascontiguousarray(out_f0), np.ascontiguousarray(sp44), np.ascontiguousarray(ap44), FS, FP)
    return y, t0


def breath(rng, dur=0.22):
    n = int(dur * FS)
    x = rng.standard_normal(n)
    x = sosfilt(butter(2, [600, 5500], "band", fs=FS, output="sos"), x)
    x += sosfilt(butter(2, [1200, 2000], "band", fs=FS, output="sos"), rng.standard_normal(n)) * 0.6
    e = np.sin(np.pi * np.linspace(0, 1, n)) ** 1.5
    return x * e


def main():
    ap_ = argparse.ArgumentParser()
    ap_.add_argument("--model", required=True)
    ap_.add_argument("--speaker", type=int, default=57)
    ap_.add_argument("--out", default=os.path.join(HERE, "build", "vocal.wav"))
    a = ap_.parse_args()

    from piper import PiperVoice, SynthesisConfig
    voice = PiperVoice.load(a.model, config_path=a.model + ".json")
    cfg_line = SynthesisConfig(speaker_id=a.speaker, length_scale=1.55, noise_scale=0.45, noise_w_scale=0.5)
    cfg_word = SynthesisConfig(speaker_id=a.speaker, length_scale=1.2, noise_scale=0.45, noise_w_scale=0.5)

    C = load_compose()
    notes, lines = C.compose_melody()
    rng = np.random.default_rng(57)
    for nt in notes:
        nt["hz"] = midi_hz(nt["m"] + C.TRANSPOSE - OCTAVE_DOWN)
        nt["tone"] = tone(nt["w"])
    ref_hz = np.median([nt["hz"] for nt in notes])

    total = int((C.TOTAL_BARS * C.BAR + 3) * FS)
    out = np.zeros(total)
    k = 0
    word_cache = {}
    prev_line_end = -10
    for li, line in enumerate(lines):
        ln = notes[k:k + len(line["words"])]; k += len(line["words"])
        spelled = [SPELL.get(w["text"].lower(), w["text"].lower()) for w in line["words"]]
        for w in spelled:
            if w not in word_cache:
                word_cache[w] = say(voice, cfg_word, w)
        line_audio = say(voice, cfg_line, " ".join(spelled))
        y, t0 = render_line([word_cache[w] for w in spelled], line_audio, ln, rng, ref_hz, li == 0, 0)
        # cân mức cả câu
        y *= 0.16 / (np.sqrt(np.mean(y[np.abs(y) > 1e-4] ** 2)) + 1e-9)
        i = int(t0 * FS)
        out[i:i + len(y)] += y[: max(0, min(len(y), total - i))]
        # tiếng lấy hơi trước câu nếu có chỗ nghỉ
        gap = ln[0]["t"] - prev_line_end
        if gap > 0.4:
            b = breath(rng, min(0.26, gap - 0.15))
            bi = int((ln[0]["t"] - 0.12 - len(b) / FS - 0.03) * FS)
            if bi > 0:
                out[bi:bi + len(b)] += b * 0.010
        prev_line_end = ln[-1]["t"] + ln[-1]["d"]
        print(f"  {line['text']}")

    out = sosfilt(butter(2, 70, "high", fs=FS, output="sos"), out)
    out /= np.max(np.abs(out)) / 0.9
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    wavfile.write(a.out, FS, (out * 32767).astype(np.int16))
    print(f"vocal.wav → {a.out}  ({len(notes)} nốt, {len(lines)} câu, giọng #{a.speaker})")


if __name__ == "__main__":
    main()
