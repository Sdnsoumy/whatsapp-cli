#!/usr/bin/env node
/**
 * wacli — WhatsApp CLI (TypeScript port)
 * Entry point — mirrors cmd/wacli/main.go
 */
import { buildProgram } from './root.js';
import { writeError } from '../out/out.js';

async function main(): Promise<void> {
  // Apply device label from environment (mirrors applyDeviceLabel() in Go)
  const deviceLabel = process.env.WACLI_DEVICE_LABEL?.trim();
  if (deviceLabel) {
    // Baileys exposes browser label via the socket config at connect time;
    // we store it in env and read it in wa/client.ts
    process.env._WACLI_BROWSER_NAME = deviceLabel;
  }

  const program = buildProgram();

  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    const isJSON = process.argv.includes('--json');
    writeError(isJSON, err);
    process.exit(1);
  }
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
