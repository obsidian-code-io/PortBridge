#!/usr/bin/env node
import { cac } from "cac";
import { CliError } from "./config.ts";
import { cmdConfig, cmdLogin, cmdLogout, cmdLs, cmdTargets, cmdTunnel } from "./commands.ts";

const cli = cac("portbridge");

cli
  .command("config <action> [value]", "Manage config: set-url <url> | show")
  .action((action: string, value: string | undefined) => cmdConfig(action, value));

cli
  .command("login", "Store the admin token (prompted, not echoed)")
  .option("--url <url>", "Server URL")
  .action((opts: { url?: string }) => cmdLogin(opts));

cli.command("logout", "Remove stored credentials").action(() => cmdLogout());

cli
  .command("targets", "List forwardable containers on the server")
  .option("--url <url>", "Server URL")
  .action((opts: { url?: string }) => cmdTargets(opts));

cli
  .command("tunnel <target> <port>", "Open a tunnel from localhost to a cloud container port")
  .option("--local <port>", "Local port (auto if omitted)")
  .option("--ttl <minutes>", "TTL in minutes, or 'never'")
  .option("--url <url>", "Server URL")
  .action((target: string, port: string, opts: { local?: string; ttl?: string; url?: string }) =>
    cmdTunnel(target, port, opts),
  );

cli
  .command("ls", "List active agent-tunnels")
  .option("--url <url>", "Server URL")
  .action((opts: { url?: string }) => cmdLs(opts));

cli.help();
cli.version("0.1.0");

const FIRST_RUN = [
  "",
  "First run? Point the CLI at your server, log in, then list targets:",
  "  portbridge config set-url https://portbridge.example.com",
  "  portbridge login",
  "  portbridge targets",
].join("\n");

async function main(): Promise<void> {
  try {
    const parsed = cli.parse(process.argv, { run: false });
    if (parsed.options["help"] === true || parsed.options["version"] === true) return;
    if (cli.matchedCommand === undefined) {
      cli.outputHelp();
      const unknown = process.argv.length > 2;
      console.error(unknown ? "\nUnknown command — see the usage above." : FIRST_RUN);
      process.exit(unknown ? 1 : 0);
    }
    await cli.runMatchedCommand();
  } catch (err) {
    console.error(err instanceof CliError ? err.message : err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

void main();
