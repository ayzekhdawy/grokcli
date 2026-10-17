/** Mic capture + PCM helpers for live voice and dictation. */

/** Convert Float32 mono samples to 16-bit little-endian PCM. */
export function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  return arrayBufferToBase64(buf);
}

/**
 * Capture mic as 16 kHz mono PCM chunks (≈100ms) via AudioWorklet-less ScriptProcessor fallback.
 * Returns a stop() function.
 */
export async function startPcmCapture(
  onChunk: (pcmBase64: string) => void,
  sampleRate = 16000,
): Promise<{ stop: () => void; stream: MediaStream }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
    video: false,
  });
  const ctx = new AudioContext({ sampleRate });
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor is deprecated but widely available; fine for desktop workbench.
  const bufferSize = 2048;
  const processor = ctx.createScriptProcessor(bufferSize, 1, 1);
  processor.onaudioprocess = (ev) => {
    const input = ev.inputBuffer.getChannelData(0);
    // Resample if needed (simple decimate when ctx.sampleRate != target).
    const ratio = ctx.sampleRate / sampleRate;
    if (ratio <= 1.01 && ratio >= 0.99) {
      onChunk(arrayBufferToBase64(floatTo16BitPCM(input)));
      return;
    }
    const outLen = Math.floor(input.length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      out[i] = input[Math.floor(i * ratio)] ?? 0;
    }
    onChunk(arrayBufferToBase64(floatTo16BitPCM(out)));
  };
  source.connect(processor);
  processor.connect(ctx.destination);

  return {
    stream,
    stop: () => {
      try {
        processor.disconnect();
        source.disconnect();
        void ctx.close();
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        // ignore
      }
    },
  };
}

/** Play base64 PCM16 mono at 24k (or 16k) — best-effort for voice deltas. */
export async function playPcm16Base64(
  b64: string,
  sampleRate = 24000,
): Promise<void> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const samples = new Float32Array(bytes.length / 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  const ctx = new AudioContext({ sampleRate });
  const buf = ctx.createBuffer(1, samples.length, sampleRate);
  buf.copyToChannel(samples, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  await new Promise<void>((resolve) => {
    src.onended = () => {
      void ctx.close();
      resolve();
    };
  });
}
