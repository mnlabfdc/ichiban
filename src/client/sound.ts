// 成功／失敗提示音，用 Web Audio 現場產生，不需要音檔

let ctx: AudioContext | null = null;

function tone(freq: number, start: number, duration: number) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.08, ctx.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration);
}

export function beep(kind: "ok" | "fail") {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    if (kind === "ok") {
      tone(1320, 0, 0.09);
    } else {
      tone(220, 0, 0.18);
      tone(180, 0.22, 0.28);
    }
  } catch {
    // 瀏覽器不支援就不出聲
  }
}
