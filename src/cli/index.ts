import { createProgram } from "./program.js";

export async function runCli(argv: readonly string[] = process.argv): Promise<void> {
  await createProgram().parseAsync([...argv]);
}

export { CLI_VERSION, createProgram } from "./program.js";
