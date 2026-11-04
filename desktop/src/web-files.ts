import type { Fact } from "./core/knowledge";
import type { SqlJsStatic } from "sql.js";

export type ImportFile = { name: string; text?: string; facts?: Fact[] };
export type ImportKind = "legacy" | "csv" | "backup";
const MAX_FILE_BYTES = 20_000_000;

export async function readLegacyDatabase(
  bytes: Uint8Array,
  sql?: SqlJsStatic,
): Promise<Fact[]> {
  const SQL =
    sql ??
    (await (
      await import("sql.js")
    ).default({
      locateFile: () =>
        new URL("./sqlite/sql-wasm.wasm", document.baseURI).href,
    }));
  const db = new SQL.Database(bytes);
  try {
    const rows = db.exec("SELECT category,key,value,updated_at FROM facts")[0];
    return (rows?.values ?? []).map(([category, key, value, updatedAt]) => ({
      category,
      key,
      value,
      updatedAt: String(updatedAt),
    })) as Fact[];
  } finally {
    db.close();
  }
}

export async function parseSelectedFiles(
  kind: ImportKind,
  files: File[],
): Promise<ImportFile[]> {
  const selected =
    kind === "legacy"
      ? files.filter((f) =>
          ["workout_log.json", "references.json", "coach_profile.db"].includes(
            f.name,
          ),
        )
      : files;
  if (!selected.length)
    throw Error("没有找到可导入的训练记录、参考动作或用户资料文件。");
  if (kind !== "legacy" && selected.length !== 1)
    throw Error("请每次选择一个 CSV 或 JSON 文件。");
  if (new Set(selected.map((f) => f.name)).size !== selected.length)
    throw Error("发现多个同名旧版数据文件，请只选择一份旧项目的数据。");
  return Promise.all(
    selected.map(async (file) => {
      if (file.size > MAX_FILE_BYTES) throw Error(`${file.name} 超过 20 MB`);
      if (file.name === "coach_profile.db") {
        return {
          name: file.name,
          facts: await readLegacyDatabase(
            new Uint8Array(await file.arrayBuffer()),
          ),
        };
      }
      return {
        name: kind === "legacy" ? file.name : kind,
        text: await file.text(),
      };
    }),
  );
}

export function chooseBrowserFiles(
  kind: ImportKind,
): Promise<ImportFile[] | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept =
      kind === "csv"
        ? ".csv,text/csv"
        : kind === "legacy"
          ? ".json,.db"
          : ".json,application/json";
    input.multiple = kind === "legacy";
    input.setAttribute("aria-label", "选择要导入的数据文件");
    input.style.display = "none";
    document.body.append(input);
    input.oncancel = () => {
      input.remove();
      resolve(null);
    };
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      if (!files.length) {
        resolve(null);
        return;
      }
      void parseSelectedFiles(kind, files).then(resolve, reject);
    };
    input.click();
  });
}

export function downloadBrowserFile(name: string, text: string | Uint8Array) {
  const blob = new Blob(
    [typeof text === "string" ? text : new Uint8Array(text)],
    {
      type: name.endsWith(".csv")
        ? "text/csv;charset=utf-8"
        : "application/json;charset=utf-8",
    },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name.replace(/[\\/]/g, "_");
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
