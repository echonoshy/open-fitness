import { recoverTimedCheckpoint } from "../src/core/timed-training";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { dataSchema } from "../src/core/data";
import { mergeImportedData } from "../src/core/data-edits";
import { exportCSV, importCSV, recoverCheckpoint } from "../src/core/history";
import { SessionEngine, type RecordRow } from "../src/core/session";
import type { Data } from "../src/platform";
import { appControls } from "./helpers/app-controls";

// Exercise the real DataPanel export/import closures; replace only UI and file I/O.
const ast = ts.createSourceFile(
  "Features.tsx",
  readFileSync(
    new URL("../src/components/Features.tsx", import.meta.url),
    "utf8",
  ),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const pieces: Record<string, string> = {};
function visit(node: ts.Node) {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    ["importing", "exporting"].includes(node.name.text) &&
    node.initializer
  )
    pieces[node.name.text] =
      `const ${node.name.text} = ${node.initializer.getText(ast)};`;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(pieces.importing && pieces.exporting);
const code = ts.transpileModule(
  pieces.importing + pieces.exporting + "return { importing, exporting };",
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
function panel(
  data: Data,
  persist?: (update: (d: Data) => Data) => Promise<void>,
) {
  const h = appControls({ data });
  let files: string[] = [],
    exported = "",
    notice = "";
  const errors: unknown[] = [];
  const deps = {
    data,
    dataSchema,
    mergeImportedData,
    recoverCheckpoint,
    recoverTimedCheckpoint,
    importCSV,
    exportCSV,
    desktop: false,
    persist: persist ?? h.persist,
    setBusy: () => {},
    setNotice: (s: string) => {
      notice = s;
    },
    report: (e: unknown) => errors.push(e),
    importFiles: async () => files.map((text) => ({ text })),
    exportFile: async (_name: string, text: string) => {
      exported = text;
      return true;
    },
  };
  const actions = new Function(...Object.keys(deps), code)(
    ...Object.values(deps),
  ) as {
    importing: (kind: "backup" | "csv") => Promise<void>;
    exporting: (kind: "json") => Promise<void>;
  };
  return {
    async export() {
      await actions.exporting("json");
      assert.deepEqual(errors, []);
      return exported;
    },
    async import(text: string, kind: "backup" | "csv" = "backup") {
      files = [text];
      await actions.importing(kind);
    },
    errors,
    get data() {
      return h.dataRef.current;
    },
    get notice() {
      return notice;
    },
  };
}
const rep = (count = 1) => ({
  count,
  duration: 3,
  eccentric_s: 2,
  concentric_s: 1,
  min_angle: 80,
  full_depth: true,
  faults: [],
  score: 100,
});
function checkpoint(hold = false): RecordRow {
  return {
    id: "in-progress",
    sessionId: "session",
    exercise: hold ? "plank" : "squat",
    startedAt: "2026-10-30T03:00:00Z",
    duration: 15,
    reps: hold ? [] : [rep()],
    holdSeconds: hold ? 9.5 : 0,
    holdBest: hold ? 6 : 0,
    load: 0,
    goal: hold ? 30 : 12,
    interrupted: true,
  };
}
const empty = (): Data => ({ settings: { voice: false }, records: [] });

test("actual backup export/import preserves timed records and recovers a live timer once", async () => {
  const timed = {
    id: "timed-live",
    sessionId: "timed-session",
    setIndex: 2,
    movementSlug: "dumbbell-lateral-raise",
    movementName: "哑铃侧平举",
    startedAt: "2026-11-03T02:00:00Z",
    duration: 23.5,
    goalSeconds: 60,
    load: 5,
    manualReps: 12,
    mode: "timed" as const,
  };
  const backup = await panel({
    ...empty(),
    version: 3,
    timedRecords: [{ ...timed, id: "timed-complete", setIndex: 1 }],
    timedCheckpoint: timed,
    freePractice: { movementSlugs: [timed.movementSlug] },
  }).export();
  const target = panel(empty());
  await target.import(backup);
  assert.deepEqual(target.errors, []);
  assert.equal(target.data.timedRecords!.length, 2);
  assert.deepEqual(target.data.timedRecords![1], {
    ...timed,
    interrupted: true,
  });
  assert.equal(target.data.records.length, 0);
  assert.deepEqual(target.data.freePractice!.movementSlugs, [
    timed.movementSlug,
  ]);
  const first = structuredClone(target.data);
  await target.import(backup);
  assert.deepEqual(target.data, first);
});

test("actual JSON export/import restores in-progress reps and holds as interrupted records, once", async () => {
  for (const hold of [false, true]) {
    const source: Data = {
      ...empty(),
      records: [{ ...checkpoint(), id: "completed", interrupted: undefined }],
      checkpoint: checkpoint(hold),
    };
    const backup = await panel(source).export();
    const target = panel(empty());
    await target.import(backup);
    assert.deepEqual(target.errors, []);
    assert.equal(target.data.records.length, 2);
    assert.deepEqual(
      target.data.records.find((r) => r.id === "in-progress"),
      source.checkpoint,
    );
    assert.equal(
      target.data.checkpoint,
      undefined,
      "import never resumes a live counter",
    );
    assert.match(target.notice, /新增 2 组记录/);
    const restored = structuredClone(target.data);
    await target.import(backup);
    assert.deepEqual(target.data, restored);
    assert.match(target.notice, /新增 0 组记录/);
  }
});

test("a checkpoint without the optional flag is still restored as interrupted", async () => {
  const target = panel(empty());
  await target.import(
    JSON.stringify({
      ...empty(),
      checkpoint: { ...checkpoint(), interrupted: undefined },
    }),
  );
  assert.equal(target.data.records[0]?.interrupted, true);
});

test("completed records take precedence over stale same-ID checkpoints in the backup or destination", async () => {
  const finished = {
    ...checkpoint(),
    interrupted: undefined,
    reps: [rep(), rep(2)],
    duration: 30,
  };
  delete finished.interrupted;
  for (const existing of [false, true]) {
    const target = panel({ ...empty(), records: existing ? [finished] : [] });
    await target.import(
      JSON.stringify({
        ...empty(),
        records: existing ? [] : [finished],
        checkpoint: checkpoint(),
      }),
    );
    assert.deepEqual(target.errors, []);
    assert.equal(target.data.records.length, 1);
    assert.deepEqual(target.data.records[0], finished);
  }
});

test("import preserves a different active local checkpoint and all local device preferences", async () => {
  const local: Data = {
    settings: { voice: false, camera: "local-camera" },
    records: [],
    checkpoint: { ...checkpoint(), id: "local-active" },
  };
  const target = panel(local);
  await target.import(
    JSON.stringify({
      settings: { voice: true, camera: "other-camera" },
      records: [],
      checkpoint: checkpoint(true),
    }),
  );
  assert.deepEqual(target.data.settings, local.settings);
  assert.deepEqual(target.data.checkpoint, local.checkpoint);
  assert.deepEqual(target.data.records, [checkpoint(true)]);
});

test("reimporting the active set's own snapshot cannot prevent saving its later completed repetitions", async () => {
  const engine = new SessionEngine(),
    h = appControls({ engine });
  await h.dispatch({ type: "session", action: "start" });
  engine.acceptRep(rep());
  await h.persist((d) => ({ ...d, checkpoint: engine.checkpoint() }));
  const localCheckpoint = structuredClone(h.dataRef.current.checkpoint);
  const backup = await panel(h.dataRef.current).export();
  const target = panel(h.dataRef.current, h.persist);
  await target.import(backup);
  assert.deepEqual(target.errors, []);
  assert.deepEqual(h.dataRef.current.checkpoint, localCheckpoint);
  assert.equal(h.dataRef.current.records.length, 0);
  assert.equal(engine.active, true);
  engine.acceptRep(rep(2));
  await h.dispatch({ type: "session", action: "end" });
  assert.equal(h.dataRef.current.records.length, 1);
  assert.equal(h.dataRef.current.records[0].reps.length, 2);
  assert.equal(h.dataRef.current.records[0].interrupted, undefined);
  assert.equal(engine.pending.length, 0);
});

test("record-only JSON and CSV imports retain existing behavior and reject malformed checkpoints atomically", async () => {
  const completed = { ...checkpoint(), interrupted: undefined };
  delete completed.interrupted;
  const target = panel(empty());
  await target.import(JSON.stringify({ ...empty(), records: [completed] }));
  assert.deepEqual(target.data.records, [completed]);
  await target.import(exportCSV([completed], "strong"), "csv");
  assert.deepEqual(target.errors, []);
  assert.equal(target.data.records.length, 2);
  const before = structuredClone(target.data);
  await target.import(
    JSON.stringify({
      ...empty(),
      checkpoint: { ...checkpoint(), holdSeconds: -1 },
    }),
  );
  assert.equal(target.errors.length, 1);
  assert.deepEqual(target.data, before);
});
