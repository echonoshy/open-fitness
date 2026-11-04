import test from "node:test";
import assert from "node:assert/strict";
import { VoicePlayback } from "../src/media/playback";
import { SpeechTurnDetector } from "../src/core/speech-turn";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const pcm = new Uint8Array(16000 * 2);
class FakeContext {
  static instances: FakeContext[] = [];
  currentTime = 0;
  state = "running";
  destination = {};
  volume = 1;
  closeRequested = false;
  nodes: {
    stopped: boolean;
    disconnected: boolean;
    onended?: () => void;
    start: (at: number) => void;
    stop: () => void;
    connect: () => void;
    disconnect: () => void;
  }[] = [];
  closed!: () => void;
  private closing = new Promise<void>((resolve) => {
    this.closed = () => {
      this.state = "closed";
      resolve();
    };
  });
  constructor() {
    FakeContext.instances.push(this);
  }
  createGain() {
    return {
      connect() {},
      gain: {
        cancelScheduledValues() {},
        setValueAtTime: (v: number) => {
          this.volume = v;
        },
        setTargetAtTime: (v: number) => {
          this.volume = v;
        },
      },
    };
  }
  createBuffer(_channels: number, size: number, rate: number) {
    return {
      duration: size / rate,
      getChannelData: () => new Float32Array(size),
    };
  }
  createBufferSource() {
    const node = {
      stopped: false,
      disconnected: false,
      onended: undefined as (() => void) | undefined,
      start(_at: number) {},
      stop() {
        this.stopped = true;
      },
      connect() {},
      disconnect() {
        this.disconnected = true;
      },
    };
    this.nodes.push(node);
    return node;
  }
  async resume() {}
  close() {
    this.closeRequested = true;
    return this.closing;
  }
}
async function withAudio(run: () => Promise<void>) {
  const original = globalThis.AudioContext;
  FakeContext.instances = [];
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
  try {
    await run();
  } finally {
    for (const context of FakeContext.instances) context.closed();
    globalThis.AudioContext = original;
  }
}

test("interrupt immediately mutes and stops all buffered chunks before device close resolves", () =>
  withAudio(async () => {
    const player = new VoicePlayback();
    let late!: (bytes: Uint8Array, rate: number) => void;
    const task = player.stream(async (_signal, push) => {
      late = push;
      for (let i = 0; i < 3; i++) push(pcm, 16000);
    });
    await tick();
    const context = FakeContext.instances[0];
    context.currentTime = 0.1;
    assert.equal(player.audible, true);
    player.stop();
    assert.equal(context.volume, 0);
    assert.ok(context.nodes.every((n) => n.stopped && n.disconnected));
    assert.equal(player.active, false);
    assert.equal(player.audible, false);
    assert.equal(
      context.state,
      "running",
      "device close is intentionally still pending",
    );
    late(pcm, 16000);
    assert.equal(context.nodes.length, 3, "late chunks cannot be scheduled");
    context.closed();
    assert.equal(await task, false);
  }));

test("synthesis and queued future audio are not audible playback", () =>
  withAudio(async () => {
    const player = new VoicePlayback();
    let emit!: () => void;
    const task = player.stream(
      async (_signal, push) =>
        new Promise<void>((resolve) => {
          emit = () => {
            push(pcm, 16000);
            resolve();
          };
        }),
    );
    await tick();
    assert.equal(player.active, true);
    assert.equal(player.audible, false);
    emit();
    assert.equal(player.audible, false, "40ms buffer lead is not yet audible");
    const context = FakeContext.instances[0];
    context.currentTime = 0.05;
    assert.equal(player.audible, true);
    player.stop();
    context.closed();
    assert.equal(await task, false);
  }));

test("a brief candidate ducks and restores, while confirmed speech cuts the same stream", () =>
  withAudio(async () => {
    const player = new VoicePlayback();
    const task = player.stream(async (_signal, push) => push(pcm, 16000));
    await tick();
    const context = FakeContext.instances[0];
    context.currentTime = 0.05;
    const detector = new SpeechTurnDetector();
    const frame = Float32Array.from(
      { length: 512 },
      (_, i) => 0.025 * Math.sin(i * 0.2),
    );
    function feed(p: number) {
      const event = detector.feed(frame, p, player.audible);
      if (event?.type === "candidate") player.duck(true);
      if (event?.type === "candidate_end") player.duck(false);
      if (event?.type === "start") player.stop();
    }
    feed(0.8);
    feed(0.8);
    assert.equal(context.volume, 0.15);
    assert.equal(player.active, true);
    feed(0.2);
    feed(0.2);
    feed(0.2);
    assert.equal(context.volume, 1);
    assert.equal(player.active, true);
    for (const p of [0.78, 0.82, 0.57, 0.76, 0.84, 0.73, 0.59, 0.79, 0.81])
      feed(p);
    assert.equal(player.active, false);
    assert.equal(context.volume, 0);
    assert.ok(context.nodes.every((n) => n.stopped));
    context.closed();
    assert.equal(await task, false);
  }));
