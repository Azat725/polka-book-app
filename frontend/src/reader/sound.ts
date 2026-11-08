let context: AudioContext | null = null;
let playing: AudioBufferSourceNode | null = null;

// Procedural paper noise is an original effect and carries no third-party audio license.
export function playPageSound(volume: number): void {
  try {
    context ??= new AudioContext();
    void context.resume();
    playing?.stop();
    const duration = 0.23;
    const buffer = context.createBuffer(
      1,
      Math.ceil(context.sampleRate * duration),
      context.sampleRate,
    );
    const samples = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < samples.length; i++) {
      const phase = i / samples.length;
      previous = (previous + (Math.random() * 2 - 1) * 0.24) / 1.15;
      samples[i] = previous * Math.sin(Math.PI * phase) * (1 - phase);
    }
    const source = context.createBufferSource();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 750;
    gain.gain.value = Math.max(0, Math.min(1, volume)) * 0.65;
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      if (playing === source) playing = null;
    };
    source.start();
    playing = source;
  } catch {
    /* Audio availability never blocks page navigation. */
  }
}

export function stopPageSound(): void {
  playing?.stop();
  playing = null;
  if (context) {
    void context.close();
    context = null;
  }
}
