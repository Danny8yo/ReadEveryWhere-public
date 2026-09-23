import { cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

for (const name of ["tokenizer.json", "tokenizer_config.json", "README.md"]) {
  const source = resolve("src/integrations/deepseek/assets/deepseek-v3", name);
  const target = resolve("dist/integrations/deepseek/assets/deepseek-v3", name);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target);
}
