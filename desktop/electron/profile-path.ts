import { existsSync } from "node:fs";
import { join } from "node:path";

// Reuse the complete previous profile, including Chromium state and service secrets.
export function profilePath(appData: string) {
  const legacy = join(appData, "Viaim Coach");
  return existsSync(legacy) ? legacy : join(appData, "open-fitness");
}
