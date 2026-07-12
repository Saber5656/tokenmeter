import { Command } from "commander";

declare const __TOKENMETER_VERSION__: string;

export const CLI_VERSION = __TOKENMETER_VERSION__;

export function createProgram(): Command {
  const program = new Command();

  program
    .name("tokenmeter")
    .description("Local-first token and context observability for AI agents")
    .version(CLI_VERSION)
    .helpOption("-h, --help", "display help for command")
    .showHelpAfterError()
    .action(() => {
      program.outputHelp();
    });

  return program;
}
