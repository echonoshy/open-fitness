import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  chmodSync,
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  unlinkSync,
  statSync,
} from "node:fs";

// A private local wrapping key keeps credentials out of readable config and
// training exports. Both files remain accessible to the owning OS account;
// this is not an OS keychain or protection against a compromised account.
function wrappingKey(file: string, create: boolean): Buffer {
  const path = file + ".key";
  if (create) {
    try {
      writeFileSync(path, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    chmodSync(path, 0o600);
  }
  const key = readFileSync(path);
  if (key.length !== 32) throw Error("本机服务密钥文件损坏");
  return key;
}
export function encodeServiceSecrets(config: object, file: string) {
  const data = structuredClone(config) as Record<string, any>;
  if (!Object.values(data).some((service) => service?.apiKey)) return data;
  const key = wrappingKey(file, true);
  for (const [kind, service] of Object.entries(data)) {
    if (!service?.apiKey) continue;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(kind));
    const encrypted = Buffer.concat([
      cipher.update(service.apiKey, "utf8"),
      cipher.final(),
    ]);
    service.apiKey = {
      encrypted: "aes-256-gcm-v1",
      value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
        "base64",
      ),
    };
  }
  return data;
}
export function decodeServiceSecrets(data: any, file: string) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  for (const [kind, service] of Object.entries(data) as [string, any][]) {
    if (!service?.apiKey || typeof service.apiKey !== "object") continue;
    try {
      if (
        service.apiKey.encrypted !== "aes-256-gcm-v1" ||
        typeof service.apiKey.value !== "string"
      )
        throw Error();
      const bytes = Buffer.from(service.apiKey.value, "base64");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        wrappingKey(file, false),
        bytes.subarray(0, 12),
      );
      decipher.setAAD(Buffer.from(kind));
      decipher.setAuthTag(bytes.subarray(12, 28));
      service.apiKey = Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw Error("本机 API Key 无法读取，请保留服务配置及配套密钥文件");
    }
  }
  return data;
}

// Serialize both first-launch upgrades and settings changes across processes.
export function replaceServiceFile(file: string, prepare: () => object) {
  const lock = file + ".lock";
  const temp = file + "." + randomUUID() + ".tmp";
  let locked = false;
  try {
    // A synchronous, short critical section also serializes desktop/Web saves.
    try {
      if (Date.now() - statSync(lock).mtimeMs > 60_000) unlinkSync(lock);
    } catch {}
    let fd: number;
    try {
      fd = openSync(lock, "wx", 0o600);
    } catch {
      throw Error("配置正在保存，请稍后重试");
    }
    closeSync(fd);
    locked = true;
    const encoded = prepare();
    const output = openSync(temp, "wx", 0o600);
    try {
      writeFileSync(output, JSON.stringify(encoded, null, 2) + "\n");
      fsyncSync(output);
    } finally {
      closeSync(output);
    }
    renameSync(temp, file);
  } finally {
    try {
      unlinkSync(temp);
    } catch {}
    if (locked)
      try {
        unlinkSync(lock);
      } catch {}
  }
}
