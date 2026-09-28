#!/usr/bin/env python3
"""
Giọng hát (nam) cho "Không Có Phép Màu".

Cách làm: giọng đọc tiếng Việt tổng hợp (Piper TTS, bộ giọng VIVOS) đọc từng chữ,
rồi bộ phân tích giọng WORLD tách cao độ – âm sắc – hơi, và dựng lại chữ đó
thành nốt hát: đúng cao độ, đúng độ dài, có luyến giữa hai nốt và rung cuối nốt.

Chạy:  python3 sing.py --model đường/dẫn/vi-vivos-x-low.onnx [--speaker 57]
Ra:    build/vocal.wav (44.1 kHz, mono) – compose.py sẽ tự trộn vào bài.

Model giọng đọc (không kèm trong repo, ~25 MB):
https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-vi-vivos-x-low.tar.gz
"""
import argparse
import importlib.util
import os

import numpy as np
import pyworld as pw
from scipy.io import wavfile
from scipy.signal import resample_poly

HERE = os.path.dirname(os.path.abspath(__file__))
FS = 16000          # tần số mẫu của model giọng đọc
FP = 5.0            # bước khung WORLD (ms)
OCTAVE_DOWN = 12    # giai điệu gốc viết cho quãng giọng cao -> hạ một quãng tám cho giọng nam

# Chữ tiếng Anh viết lại theo cách đọc để giọng đọc tiếng Việt phát âm đúng
SPELL = {"log": "lốc", "tab": "táp", "file": "phai", "com": "com"}


def load_compose():
    spec = importlib.util.spec_from_file_location("compose", os.path.join(HERE, "compose.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def tts(voice, cfg, word, cache={}):
    """Đọc một chữ, cắt bỏ khoảng lặng hai đầu."""
    text = SPELL.get(word.lower(), word.lower())
    if text in cache:
        return cache[text]
    x = np.concatenate([c.audio_float_array for c in voice.synthesize(text, syn_config=cfg)]).astype(np.float64)
    env = np.convolve(np.abs(x), np.ones(160) / 160, "same")
    on = np.where(env > env.max() * 0.04)[0]
    x = x[max(0, on[0] - 80): on[-1] + 160]
    cache[text] = x
    return x


def analyse(x):
    f0, t = pw.harvest(x, FS, f0_floor=60, f0_ceil=400, frame_period=FP)
    sp = pw.cheaptrick(x, f0, t, FS)
    ap = pw.d4c(x, f0, t, FS)
    return f0, sp, ap


def stretch_index(n_src, n_dst, keep_head, keep_tail):
    """Ánh xạ khung đích -> khung nguồn: giữ nguyên đầu/cuối, kéo dãn đoạn giữa."""
    keep_head = min(keep_head, n_src // 3)
    keep_tail = min(keep_tail, n_src // 3)
    mid_src = max(1, n_src - keep_head - keep_tail)
    mid_dst = max(1, n_dst - keep_head - keep_tail)
    idx = np.empty(n_dst)
    for i in range(n_dst):
        if i < keep_head:
            idx[i] = i
        elif i >= n_dst - keep_tail:
            idx[i] = n_src - (n_dst - i)
        else:
            idx[i] = keep_head + (i - keep_head) * (mid_src - 1) / max(1, mid_dst - 1)
    return np.clip(idx, 0, n_src - 1)


def interp_frames(mat, idx):
    lo = np.floor(idx).astype(int)
    hi = np.minimum(lo + 1, len(mat) - 1)
    w = (idx - lo)[:, None]
    return mat[lo] * (1 - w) + mat[hi] * w


def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def sing_note(src, note, prev_hz, rng):
    """Dựng một chữ thành một nốt hát. Trả về (tín hiệu, thời điểm bắt đầu)."""
    f0s, sp, ap = src
    voiced = np.where(f0s > 0)[0]
    if len(voiced) == 0:
        voiced = np.arange(len(f0s))
    v0, v1 = voiced[0], voiced[-1] + 1
    head = sp[:v0]; head_ap = ap[:v0]             # phụ âm đầu (vô thanh)
    tail = sp[v1:]; tail_ap = ap[v1:]             # phụ âm cuối
    pre = min(len(head), int(80 / FP))            # phụ âm đầu hát trước phách tối đa 80 ms
    head, head_ap = head[-pre:] if pre else head[:0], head_ap[-pre:] if pre else head_ap[:0]
    tail, tail_ap = tail[: int(60 / FP)], tail_ap[: int(60 / FP)]

    dur_frames = int(note["d"] * 1000 / FP)
    body_frames = max(8, dur_frames - len(tail) + int(15 / FP))   # chồng nhẹ sang chữ sau cho liền (legato)
    idx = stretch_index(v1 - v0, body_frames, keep_head=int(35 / FP), keep_tail=int(40 / FP))
    body_sp = np.exp(interp_frames(np.log(sp[v0:v1] + 1e-12), idx))
    body_ap = interp_frames(ap[v0:v1], idx)

    # đường cao độ: luyến từ nốt trước, vào nốt hơi thấp rồi lên đúng, rung ở nốt dài
    target = midi_hz(note["m"])
    n = body_frames
    tt = np.arange(n) * FP / 1000
    cents = np.zeros(n)
    if prev_hz:
        glide = min(n, int(70 / FP))
        start_c = 1200 * np.log2(prev_hz / target)
        k = np.linspace(0, 1, glide)
        cents[:glide] = start_c * (1 - (3 * k ** 2 - 2 * k ** 3))
    else:
        scoop = min(n, int(60 / FP))
        cents[:scoop] = -40 * (1 - np.linspace(0, 1, scoop))
    depth = np.clip((tt - 0.22) / 0.25, 0, 1) * 28
    cents += depth * np.sin(2 * np.pi * 5.3 * tt + rng.random() * 6.28)
    drift = np.cumsum(rng.standard_normal(n)) * 0.6
    cents += drift - drift.mean()
    body_f0 = target * 2 ** (cents / 1200)

    f0 = np.concatenate([np.zeros(len(head)), body_f0, np.zeros(len(tail))])
    spm = np.concatenate([head, body_sp, tail]) if len(head) or len(tail) else body_sp
    apm = np.concatenate([head_ap, body_ap, tail_ap]) if len(head) or len(tail) else body_ap
    y = pw.synthesize(np.ascontiguousarray(f0), np.ascontiguousarray(spm), np.ascontiguousarray(apm), FS, FP)

    # cân mức từng chữ, vào/ra mềm
    v_part = y[int(len(head) * FP * FS / 1000): int((len(head) + n) * FP * FS / 1000)]
    rms = np.sqrt(np.mean(v_part ** 2)) + 1e-9
    y *= 0.12 / rms
    fi, fo = int(0.006 * FS), int(0.02 * FS)
    y[:fi] *= np.linspace(0, 1, fi)
    y[-fo:] *= np.linspace(1, 0, fo)
    start = note["t"] - len(head) * FP / 1000
    return y, start, target


def main():
    ap_ = argparse.ArgumentParser()
    ap_.add_argument("--model", required=True)
    ap_.add_argument("--speaker", type=int, default=57)
    ap_.add_argument("--out", default=os.path.join(HERE, "build", "vocal.wav"))
    a = ap_.parse_args()

    from piper import PiperVoice, SynthesisConfig
    voice = PiperVoice.load(a.model, config_path=a.model + ".json")
    cfg = SynthesisConfig(speaker_id=a.speaker, noise_scale=0.5, noise_w_scale=0.6)

    C = load_compose()
    notes, _ = C.compose_melody()
    rng = np.random.default_rng(57)
    total = int((C.TOTAL_BARS * C.BAR + 3) * FS)
    out = np.zeros(total)
    analysed = {}
    prev_end, prev_hz = -1, None
    for nt in notes:
        m = nt["m"] + C.TRANSPOSE - OCTAVE_DOWN
        key = nt["w"].lower()
        if key not in analysed:
            analysed[key] = analyse(tts(voice, cfg, nt["w"]))
        legato = prev_hz if abs(nt["t"] - prev_end) < 0.06 else None
        y, start, hz = sing_note(analysed[key], {"t": nt["t"], "d": nt["d"], "m": m}, legato, rng)
        i = int(start * FS)
        out[i:i + len(y)] += y[: max(0, min(len(y), total - i))]
        prev_end, prev_hz = nt["t"] + nt["d"], hz

    out = resample_poly(out, 441, 160)
    out /= np.max(np.abs(out)) / 0.9
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    wavfile.write(a.out, 44100, (out * 32767).astype(np.int16))
    print(f"vocal.wav → {a.out}  ({len(notes)} nốt, {len(analysed)} chữ khác nhau, giọng #{a.speaker})")


if __name__ == "__main__":
    main()
