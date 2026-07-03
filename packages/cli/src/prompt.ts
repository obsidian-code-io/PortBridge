/**
 * Read a secret from the terminal without echoing it. Works on a TTY (raw mode,
 * no echo) and when stdin is piped (reads a line). Never prints the value.
 */

const CR = "\r";
const LF = "\n";
const EOT = String.fromCharCode(4); // Ctrl-D
const ETX = String.fromCharCode(3); // Ctrl-C
const DEL = String.fromCharCode(127); // delete
const BS = "\b";

interface RawStdin {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => void;
  resume: () => void;
  pause: () => void;
  setEncoding: (enc: string) => void;
  on: (event: "data", cb: (chunk: string) => void) => void;
  removeListener: (event: "data", cb: (chunk: string) => void) => void;
}

export function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin as unknown as RawStdin;
  process.stdout.write(question);
  return new Promise((resolve) => {
    let value = "";
    const done = (): void => {
      stdin.setRawMode?.(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
      resolve(value);
    };
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === CR || ch === LF || ch === EOT) return done();
        if (ch === ETX) process.exit(1);
        else if (ch === DEL || ch === BS) value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
  });
}
