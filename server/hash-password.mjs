import { hashPassword } from "./auth.mjs";

if (process.stdin.isTTY) {
  process.stderr.write("Passphrase sicher über stdin übergeben, nicht als Befehlsargument.\n");
  process.exitCode = 1;
} else {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  try { process.stdout.write(`${await hashPassword(input.replace(/\r?\n$/, ""))}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
