import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";

const DebugLevelSchema = z.enum(["off", "error", "info", "verbose"]);

const ConfigSchema = z.object({
  debugLevel: DebugLevelSchema.default("off"),
});

export type DebugLevel = z.infer<typeof DebugLevelSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: Config = { debugLevel: "off" };

const CONFIG_PATH = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "get-diagnostics.json",
);

export const loadConfig = (): Config => {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    return ConfigSchema.parse(JSON.parse(raw));
  } catch {
    return DEFAULT_CONFIG;
  }
};
