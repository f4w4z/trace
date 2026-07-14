// Trace — friendly, animated first-run installer.
// Dependency-free. Runs on the Node.js that's already installed.
import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";
import { fileURLToPath } from "url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOG = path.join(ROOT, "setup.log");

// ── Color palette (ANSI) ────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  white: "\x1b[97m",
};
const gradient = [C.cyan, C.cyan, C.blue, C.blue, C.magenta, C.magenta];

const BANNER = [
  " ████████╗██████╗  █████╗  ██████╗███████╗",
  " ╚══██╔══╝██╔══██╗██╔══██╗██╔════╝██╔════╝",
  "    ██║   ██████╔╝███████║██║     █████╗  ",
  "    ██║   ██╔══██╗██╔══██║██║     ██╔══╝  ",
  "    ██║   ██║  ██║██║  ██║╚██████╗███████╗",
  "    ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚══════╝",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clear() {
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
}

function line(s = "") {
  console.log(s);
}

function banner() {
  clear();
  BANNER.forEach((b, i) => {
    console.log("  " + gradient[i] + C.bold + b + C.reset);
  });
  console.log();
  console.log("  " + C.dim + "Local Context Cloud — your OS-wide memory layer" + C.reset);
  console.log();
}

// ── Typewriter subtitle for a little flair ──────────────────────────────
async function typewriter(text, color = C.white, speed = 12) {
  process.stdout.write("  ");
  for (const ch of text) {
    process.stdout.write(color + ch + C.reset);
    await sleep(speed);
  }
  process.stdout.write("\n");
}

// ── Spinner ─────────────────────────────────────────────────────────────
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinTimer = null;
let spinText = "";
let spinStart = 0;

function startSpinner(text) {
  spinText = text;
  spinStart = Date.now();
  let i = 0;
  const draw = () => {
    const secs = Math.floor((Date.now() - spinStart) / 1000);
    const t = secs > 0 ? `${spinText}  ${C.dim}(${secs}s)${C.reset}` : spinText;
    process.stdout.write(`\r\x1b[K  ${C.cyan}${FRAMES[i]}${C.reset} ${t}`);
    i = (i + 1) % FRAMES.length;
  };
  draw();
  spinTimer = setInterval(draw, 80);
}

function stopSpinner() {
  if (spinTimer) {
    clearInterval(spinTimer);
    spinTimer = null;
  }
  process.stdout.write("\r\x1b[K");
}

function ok(text) {
  console.log(`  ${C.green}✓${C.reset} ${text}`);
}

function fail(text) {
  console.log(`  ${C.red}✗${C.reset} ${text}`);
}

// Run a step with a spinner, then ✓ or ✗. Returns the fn result.
async function step(label, fn) {
  startSpinner(label);
  try {
    const r = await fn();
    stopSpinner();
    ok(label);
    return r;
  } catch (e) {
    stopSpinner();
    fail(label);
    throw e;
  }
}

// ── Shell helpers ───────────────────────────────────────────────────────
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const out = opts.logFile ? fs.openSync(opts.logFile, "a") : "ignore";
    const p = spawn(cmd, args, {
      cwd: ROOT,
      shell: true,
      windowsHide: true,
      stdio: ["ignore", out, out],
    });
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))
    );
  });
}

function tailLog(lines = 8) {
  try {
    const content = fs.readFileSync(LOG, "utf8").trim().split("\n");
    return content.slice(-lines).join("\n");
  } catch {
    return "(no log)";
  }
}

// ── Interactive prompts ─────────────────────────────────────────────────
function prompt(text, def = "") {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const suffix = def ? ` ${C.dim}[${def}]${C.reset}` : "";
    rl.question(`  ${text}${suffix}: `, (ans) => {
      rl.close();
      resolve(ans.trim() || def);
    });
  });
}

function promptSecret(text) {
  return new Promise((resolve) => {
    process.stdout.write(`  ${text} `);
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    let val = "";
    const onKey = (str, key) => {
      if (!key) return;
      if (key.name === "return" || key.name === "enter") {
        cleanup();
        process.stdout.write("\n");
        resolve(val);
      } else if (key.name === "backspace") {
        if (val.length > 0) {
          val = val.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else if (key.ctrl && key.name === "c") {
        cleanup();
        process.stdout.write("\n");
        process.exit(1);
      } else if (str && str.length === 1 && !key.ctrl && !key.meta) {
        val += str;
        process.stdout.write(C.dim + "•" + C.reset);
      }
    };
    const cleanup = () => {
      process.stdin.removeListener("keypress", onKey);
      process.stdin.setRawMode(false);
    };
    process.stdin.on("keypress", onKey);
  });
}

function selectMenu(question, options, defaultIndex = 0) {
  return new Promise((resolve) => {
    let index = defaultIndex;
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    let linesPrinted = 0;
    const draw = () => {
      let out = "";
      for (let i = 0; i < linesPrinted; i++) out += "\x1b[1A\x1b[2K";
      options.forEach((opt, i) => {
        const sel = i === index;
        const marker = sel ? `${C.cyan}❯ ${C.reset}` : "  ";
        const label = sel ? `${C.bold}${opt.label}${C.reset}` : `${C.gray}${opt.label}${C.reset}`;
        out += marker + label + "\n";
      });
      process.stdout.write(out);
      linesPrinted = options.length;
    };
    const cleanup = () => {
      process.stdin.removeListener("keypress", onKey);
      process.stdin.setRawMode(false);
    };
    const finish = () => {
      cleanup();
      process.stdout.write("\n");
      resolve(options[index].value);
    };
    const onKey = (str, key) => {
      if (!key) return;
      if (key.name === "up") {
        index = (index - 1 + options.length) % options.length;
        draw();
      } else if (key.name === "down") {
        index = (index + 1) % options.length;
        draw();
      } else if (key.name === "return" || key.name === "enter") {
        finish();
      } else if (key.ctrl && key.name === "c") {
        cleanup();
        process.stdout.write("\n");
        process.exit(1);
      }
    };
    console.log(`  ${question} ${C.dim}(↑/↓ to move, Enter to select)${C.reset}`);
    draw();
    process.stdin.on("keypress", onKey);
  });
}

function confirm(text, def = true) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const suffix = def ? `${C.dim}[Y/n]${C.reset}` : `${C.dim}[y/N]${C.reset}`;
    rl.question(`  ${text} ${suffix}: `, (ans) => {
      rl.close();
      const a = ans.trim().toLowerCase();
      if (a === "") return resolve(def);
      resolve(a === "y" || a === "yes");
    });
  });
}

// Wait for any keypress (works even after readline prompts tore down
// the keypress emitter). In raw mode, 'data' fires for every key.
function waitForKeypress(exitAfter = false) {
  return new Promise((resolve) => {
    const finish = () => {
      try {
        process.stdin.setRawMode(false);
      } catch {}
      process.stdin.pause();
      if (exitAfter) process.exit(1);
      resolve();
    };
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.once("data", finish);
    } else {
      setTimeout(finish, 4000);
    }
  });
}

// ── LLM config (ported from the old batch/powershell logic) ─────────────
const PROVIDERS = {
  GROQ_API_KEY: ["https://api.groq.com/openai/v1", "llama-3.3-70b-versatile"],
  OPENAI_API_KEY: ["https://api.openai.com/v1", "gpt-4o"],
  ANTHROPIC_API_KEY: ["https://api.anthropic.com/v1", "claude-3-5-sonnet-latest"],
  GEMINI_API_KEY: ["https://generativelanguage.googleapis.com/v1beta/openai", "gemini-2.0-flash"],
};

function configureLLM(keyName, keyVal) {
  const [url, model] = PROVIDERS[keyName] || [];
  if (!url) return null;
  let f = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  const setVar = (name, value) => {
    const re = new RegExp(`^${name}=.*$`, "m");
    if (re.test(f)) f = f.replace(re, `${name}=${value}`);
    else f += `\n${name}=${value}\n`;
  };
  setVar("LLM_URL", url);
  setVar("LLM_MODEL", model);
  setVar("LLM_API_KEY", keyVal);
  fs.writeFileSync(path.join(ROOT, ".env"), f);
  return model;
}

function hasDockerKey() {
  try {
    const f = fs.readFileSync(path.join(ROOT, ".env.docker"), "utf8");
    return /^[\w]*API_KEY=.+/m.test(f);
  } catch {
    return false;
  }
}

function readDockerKey() {
  try {
    const f = fs.readFileSync(path.join(ROOT, ".env.docker"), "utf8");
    const m = f.match(/^([\w]*API_KEY)=(.+)$/m);
    return m ? { name: m[1], key: m[2] } : null;
  } catch {
    return null;
  }
}

// ── Step implementations ────────────────────────────────────────────────
function checkNode() {
  try {
    execSync("node --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function checkDocker() {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function setupConfig() {
  const env = path.join(ROOT, ".env");
  const example = path.join(ROOT, ".env.example");
  if (!fs.existsSync(env)) {
    if (!fs.existsSync(example)) {
      throw new Error(".env.example missing — redownload Trace.");
    }
    fs.copyFileSync(example, env);
  }
}

async function setupKey() {
  if (hasDockerKey()) {
    const d = readDockerKey();
    const model = configureLLM(d.name, d.key);
    if (model) ok(`Q&A ready with ${model}`);
    return;
  }

  console.log();
  console.log("  " + C.bold + "Connect an AI key" + C.reset);
  console.log("  " + C.dim + "This lets Trace understand and organize your notes." + C.reset);
  console.log("  " + C.dim + "Free keys: console.groq.com  ·  platform.openai.com" + C.reset);
  console.log();

  const key = await promptSecret("Paste a key, or press Enter to skip");
  if (!key) {
    fs.writeFileSync(
      path.join(ROOT, ".env.docker"),
      "# Docker-specific env overrides\n# GROQ_API_KEY=your_key_here\n"
    );
    console.log("  " + C.yellow + "Skipped" + C.reset + " — add one later in .env.docker");
    return;
  }

  const provider = await selectMenu("Which provider is this key for?", [
    { label: "Groq  (fast & free — recommended)", value: "GROQ_API_KEY" },
    { label: "OpenAI", value: "OPENAI_API_KEY" },
    { label: "Anthropic", value: "ANTHROPIC_API_KEY" },
    { label: "Gemini", value: "GEMINI_API_KEY" },
  ]);

  fs.writeFileSync(
    path.join(ROOT, ".env.docker"),
    `# Docker-specific env overrides\n${provider}=${key}\n`
  );
  const model = configureLLM(provider, key);
  ok(`Key saved${model ? ` — Q&A ready with ${model}` : ""}`);
}

async function installDeps() {
  fs.writeFileSync(LOG, "");
  await run("npm", ["install"], { logFile: LOG });
  const electronExe = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
  if (!fs.existsSync(electronExe)) {
    const installJs = path.join(ROOT, "node_modules", "electron", "install.js");
    if (fs.existsSync(installJs)) {
      await run("node", [installJs], { logFile: LOG });
    }
  }
}

async function build() {
  await run("npm", ["run", "build"], { logFile: LOG });
}

async function buildImage() {
  await run("docker", ["compose", "build"], { logFile: LOG });
}

function launch() {
  try {
    spawn("wscript.exe", [path.join(ROOT, "scripts", "start.vbs")], {
      cwd: ROOT,
      shell: true,
      windowsHide: true,
      stdio: "ignore",
    });
  } catch {
    /* best-effort */
  }
}

function celebrate() {
  clear();
  const box = [
    "  ╔════════════════════════════════════════════════════════╗",
    "  ║                                                        ║",
    "  ║            🎉   You're all set!   🎉                    ║",
    "  ║                                                        ║",
    "  ║   Trace is running in your system tray.                 ║",
    "  ║                                                        ║",
    "  ║   • Press  Alt+X  anytime to open it                    ║",
    "  ║   • Look for the Trace icon near your clock             ║",
    "  ║                                                        ║",
    "  ╚════════════════════════════════════════════════════════╝",
  ];
  box.forEach((b, i) => {
    const col = i === 2 ? C.green + C.bold : C.green;
    console.log(col + b + C.reset);
  });
  console.log();
  console.log("  " + C.dim + "Trace is now quietly remembering everything you do." + C.reset);
  console.log();
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  banner();
  await typewriter("Let's get everything set up — this takes about 5 minutes.", C.gray, 10);
  console.log();

  // 1. Node
  await step("Checking for Node.js…", async () => {
    if (!checkNode()) {
      throw new Error("Node.js isn't installed. Get the LTS version at https://nodejs.org/");
    }
  });

  // 2. Docker
  await step("Checking for Docker Desktop…", async () => {
    if (!checkDocker()) {
      throw new Error(
        "Docker Desktop isn't running. Open it, wait a few seconds, then run setup again."
      );
    }
  });

  // 3. Config
  await step("Setting up your configuration…", async () => {
    setupConfig();
  });

  // 4. Key
  console.log();
  await step("Connecting your AI key…", setupKey);

  // 5. Deps
  console.log();
  await step("Downloading components…", installDeps);

  // 6. Build
  await step("Getting Trace ready…", build);

  // 7. Docker image
  await step("Setting up the background service (first time only)…", buildImage);

  // Launch
  console.log();
  launch();
  celebrate();

  console.log("  " + C.dim + "Press any key to close this window…" + C.reset);
  await waitForKeypress();
}

main().catch(async (e) => {
  stopSpinner();
  console.log();
  fail("Setup stopped");
  console.log("  " + C.red + (e.message || e) + C.reset);
  console.log("  " + C.dim + "Details saved to setup.log — you can re-run setup anytime." + C.reset);
  console.log();
  if (fs.existsSync(LOG)) {
    console.log(C.gray + tailLog() + C.reset);
    console.log();
  }
  console.log("  " + C.dim + "Press any key to exit…" + C.reset);
  await waitForKeypress(true);
});
