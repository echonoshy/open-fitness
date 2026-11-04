import { CatalogPlan, catalogPlanControl, resolvePlan } from "../../src/core/catalog-plan";
import { resolvePracticeCommand } from "../../src/components/free-practice/voice-commands";
import {
  TimedTraining,
  mergeTimedRecords,
} from "../../src/core/timed-training";
import { timedVoiceIntent, timedStatusText } from "../../src/core/timed-voice";
import {
  movementCapability,
  type Movement,
} from "../../src/core/movement-library";
import { exerciseNarrationSource } from "../../src/media/exercise-narration";
import { localExerciseIntroduction } from "../../src/core/exercise-reference";
import { readFileSync } from "node:fs";
import ts from "typescript";
import {
  SessionEngine,
  commandSchema,
  type Receipt,
} from "../../src/core/session";
import {
  CameraFramer,
  cameraCommandSchema,
} from "../../src/core/camera-framing";
import { voiceCommandSchema } from "../../src/core/voice-controls";
import { memorySchema } from "../../src/core/coach-data";
import { saveProfileFact } from "../../src/core/data-edits";
import { moveToTrash } from "../../src/core/trash";
import { resolveOutputDevice } from "../../src/media/output-device";
import { GUIDANCE_LABELS } from "../../src/core/interaction";
import type { Data } from "../../src/platform";
import { coachTurn } from "../../src/core/coach";
import { localVoiceCommand } from "../../src/core/voice-routing";
import { ReplySpeechQueue } from "../../src/media/speech-queue";
import { TurnFeedback } from "../../src/media/turn-feedback";
import { WaitingFeedbackPhrases } from "../../src/core/waiting-feedback";
import { coachVoice } from "../../src/core/voices";
import { queryData } from "../../src/core/coach-data";
import { progressByExercise } from "../../src/core/progress";
import {
  resolveReferenceSize,
  REFERENCE_SIZE_LABELS,
} from "../../src/core/reference-view";

// Run the application's own closures, not a second implementation of its controls.
// Only React, hardware and disk I/O are replaced, so no user's devices/data are touched.
const source = readFileSync(
  new URL("../../src/App.tsx", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "App.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const pieces: Record<string, string> = {};
const names = [
  "snapshot",
  "setManualReps",
  "launchTraining",
  "controlSnapshot",
  "persist",
  "savePending",
  "dispatch",
  "cancel",
];
function visit(node: ts.Node) {
  if (
    ts.isFunctionDeclaration(node) &&
    node.name &&
    ["ask", "enumerate"].includes(node.name.text)
  )
    pieces[node.name.text] = node.getText(ast);
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    names.includes(node.name.text) &&
    node.initializer
  )
    pieces[node.name.text] =
      `const ${node.name.text} = ${node.initializer.getText(ast)};`;
  ts.forEachChild(node, visit);
}
visit(ast);
for (const name of names)
  if (!pieces[name]) throw Error(`Missing App closure: ${name}`);
const code = ts.transpileModule(
  names.map((n) => pieces[n]).join("\n") +
    pieces.ask +
    pieces.enumerate +
    "\nreturn {dispatch,cancel,persist,ask,enumerate,controlSnapshot,setManualReps,launchTraining};",
  {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  },
).outputText;

export function appControls(
  options: {
    engine?: SessionEngine;
    timedTraining?: TimedTraining;
    movementLibrary?: Movement[];
    data?: Data;
    startCamera?: () => Promise<void>;
    saveData?: (data: Data) => Promise<void>;
    enumerateDevices?: () => Promise<
      Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">[]
    >;
    narrationSource?: typeof exerciseNarrationSource;
    request?: (
      kind: string,
      payload: any,
      signal?: AbortSignal,
      chunk?: (chunk: any) => void,
    ) => Promise<any>;
  } = {},
) {
  const engine = options.engine ?? new SessionEngine();
  const timedTraining = options.timedTraining ?? new TimedTraining();
  const framer = new CameraFramer();
  const dataRef = {
    current:
      options.data ??
      ({
        settings: { voice: true, guidance: "balanced" },
        records: [],
      } as Data),
  };
  const controller = { current: new AbortController() };
  const speechStopped = { current: false };
  const writes = { current: Promise.resolve() };
  const commands: unknown[] = [],
    events: unknown[] = [];
  let playbackStops = 0;
  let playbackController: AbortController | undefined;
  const messages: any[] = [],
    history = { current: [] as { role: string; content: string }[] };
  const noop = () => {};
  const catalogPlan = new CatalogPlan(engine,timedTraining);
  const deps = {
    catalogPlan, catalogPlanControl, resolvePlan,
    engine,
    framer,
    dataRef,
    controller,
    speechStopped,
    writes,
    timedTraining,
    movementLibrary: options.movementLibrary ?? [],
    resolvePracticeCommand,
    mergeTimedRecords,
    timedVoiceIntent,
    movementCapability,
    timedStatusText,
    setSummaryText: noop,
    blurNotice: "",
    voiceCommandSchema,
    resolveReferenceSize,
    REFERENCE_SIZE_LABELS,
    cameraCommandSchema,
    commandSchema,
    memorySchema,
    saveProfileFact,
    moveToTrash,
    GUIDANCE_LABELS,
    loaded: true,
    saveData: options.saveData ?? (async () => {}),
    setData: noop,
    setDevices: noop,
    resolveOutputDevice,
    navigator: {
      mediaDevices: {
        enumerateDevices: options.enumerateDevices ?? (async () => []),
      },
    },
    startCamera:
      options.startCamera ??
      (async () => {
        engine.cameraReady = true;
      }),
    closeCamera: () => {
      engine.cameraReady = false;
      if (engine.active) engine.dispatch({ type: "session", action: "pause" });
    },
    startRequest: { current: 0 },
    turnId: { current: 1 },
    setPage: noop,
    setHudHidden: noop,
    setState: noop,
    renderView: noop,
    trace: (e: unknown) => events.push(e),
    flushSync: (fn: () => void) => fn(),
    setError: noop,
    notify: noop,
    speechHeld: { current: false },
    interaction: { current: { userSpoke: noop, clear: noop } },
    proactive: { current: { cancel: noop } },
    stopPlayback: () => {
      playbackStops++;
      playbackController?.abort();
    },
    working: { current: true },
    setBusy: noop,
    setVoiceState: noop,
    micOn: true,
    coachTurn,
    localVoiceCommand,
    localExerciseIntroduction,
    exerciseNarrationSource:
      options.narrationSource ??
      ((
        exercise: Parameters<typeof exerciseNarrationSource>[0],
        voice: string,
      ) =>
        exerciseNarrationSource(
          exercise,
          voice,
          async (url) =>
            new Response(
              readFileSync(
                new URL(
                  "../../public/" + String(url).replace(/^\.\//, ""),
                  import.meta.url,
                ),
              ),
            ),
        )),
    ReplySpeechQueue,
    TurnFeedback,
    coachVoice,
    queryData,
    progressByExercise,
    relevantKnowledge: async () => [],
    voiceAvailable: true,
    history,
    request: options.request ?? (async () => ({})),
    waitingPhrases: { current: new WaitingFeedbackPhrases() },
    spokenHistory: { current: [] },
    setMessages: (update: (items: any[]) => any[]) => {
      const next = update(messages);
      messages.splice(0, messages.length, ...next);
    },
    playback: {
      current: {
        stream: async (
          source: (signal: AbortSignal, push: () => void) => Promise<void>,
          _speaker: string,
          signal: AbortSignal,
        ) => {
          playbackController = new AbortController();
          const combined = AbortSignal.any([signal, playbackController.signal]);
          await source(combined, noop);
          combined.throwIfAborted();
          return true;
        },
      },
    },
  };
  const extracted = new Function(...Object.keys(deps), code)(
    ...Object.values(deps),
  ) as {
    dispatch: (raw: unknown, signal?: AbortSignal) => Promise<Receipt>;
    cancel: () => void;
    persist: (
      update: (data: Data) => Data,
      signal?: AbortSignal,
    ) => Promise<void>;
    ask: (text: string) => Promise<void>;
    enumerate: () => Promise<void>;
    controlSnapshot: () => Receipt["state"] &
      Required<
        Pick<Receipt["state"], "backgroundBlur" | "exerciseReference" | "voice">
      >;
    setManualReps: (value: number | undefined) => Promise<void>;
    launchTraining: (movement: Movement) => Promise<void>;
  };
  return {
    catalogPlan,
    engine,
    framer,
    dataRef,
    controller,
    speechStopped,
    writes,
    commands,
    events,
    messages,
    history,
    timedTraining,
    snapshot: extracted.controlSnapshot,
    setManualReps: extracted.setManualReps,
    launchTraining: extracted.launchTraining,
    dispatch: (raw: unknown, signal?: AbortSignal) => {
      commands.push(raw);
      return extracted.dispatch(raw, signal);
    },
    cancel: extracted.cancel,
    persist: extracted.persist,
    ask: extracted.ask,
    enumerate: extracted.enumerate,
    get playbackStops() {
      return playbackStops;
    },
  };
}
