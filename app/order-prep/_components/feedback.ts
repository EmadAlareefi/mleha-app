'use client';

/** Sound and vibration cues, so packers don't have to look at the screen to know a scan worked. */

let audioContext: AudioContext | null = null;

function tone(frequency: number, durationS: number, volume = 0.3) {
  try {
    audioContext = audioContext ?? new AudioContext();
    const context = audioContext;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(volume, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + durationS);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + durationS);
  } catch {
    // No audio (autoplay policy before the first tap): vibration still works.
  }
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not supported.
  }
}

export const feedback = {
  scanOk() {
    tone(900, 0.18);
    vibrate(40);
  },
  scanWrong() {
    tone(220, 0.45, 0.4);
    vibrate([200, 80, 200]);
  },
  done() {
    tone(660, 0.12);
    vibrate(30);
  },
};
