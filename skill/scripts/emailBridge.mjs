import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { draftEmail } from "../src/emailDraftAgent.ts";
import { isEmailApprovalCommand } from "../src/orchestrator.ts";
import { sendApprovedEmail } from "../src/emailApproval.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const stateDir = path.join(process.env.USERPROFILE ?? projectRoot, ".openclaw", "idx-exchange-email-bridge");
const draftsPath = path.join(stateDir, "drafts.json");

function parseArgs(argv) {
  const args = {
    message: "",
    user: "whatsapp-demo"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--message" || arg === "-m") {
      args.message = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--user" || arg === "-u") {
      args.user = argv[index + 1] ?? args.user;
      index += 1;
    }
  }

  return args;
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const separator = trimmed.indexOf("=");
  if (separator === -1) {
    return null;
  }

  const key = trimmed.slice(0, separator).trim();
  const rawValue = trimmed.slice(separator + 1).trim();
  const value = rawValue.replace(/^"(.*)"$/u, "$1").replace(/^'(.*)'$/u, "$1");
  return key ? [key, value] : null;
}

async function loadProjectEnv() {
  const envPath = path.join(projectRoot, ".env");
  if (!existsSync(envPath)) {
    return;
  }

  const content = await readFile(envPath, "utf8");
  for (const line of content.split(/\r?\n/u)) {
    const entry = parseEnvLine(line);
    if (!entry) {
      continue;
    }
    const [key, value] = entry;
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function readDraftState() {
  if (!existsSync(draftsPath)) {
    return { draftsByUser: {} };
  }

  const content = await readFile(draftsPath, "utf8");
  return JSON.parse(content);
}

async function writeDraftState(state) {
  await mkdir(stateDir, { recursive: true });
  await writeFile(draftsPath, JSON.stringify(state, null, 2), "utf8");
}

async function savePendingDraft(user, draft) {
  const state = await readDraftState();
  state.draftsByUser[user] = draft;
  await writeDraftState(state);
}

async function getPendingDraft(user) {
  const state = await readDraftState();
  return {
    draft: state.draftsByUser[user] ?? null,
    state
  };
}

async function clearPendingDraft(user, state) {
  delete state.draftsByUser[user];
  await writeDraftState(state);
}

function printResult(response) {
  process.stdout.write(`${response.trim()}\n`);
}

function emptyRows() {
  return [];
}

async function draftWithDatabaseFallback(message) {
  try {
    return await draftEmail({ message });
  } catch (error) {
    const fallbackOptions = {
      listingAlert: { queryRunner: emptyRows },
      marketReport: { queryRunner: emptyRows },
      propertySummary: { queryRunner: emptyRows }
    };
    return draftEmail({ message }, fallbackOptions);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const message = args.message.trim();
  if (!message) {
    throw new Error("Pass a non-empty message with --message.");
  }

  await loadProjectEnv();

  if (isEmailApprovalCommand(message)) {
    const { draft, state } = await getPendingDraft(args.user);
    if (!draft) {
      printResult("There is no pending IDX email draft to send. Draft an email first.");
      return;
    }

    const result = await sendApprovedEmail(draft, message);
    if (result.sent) {
      await clearPendingDraft(args.user, state);
    }
    printResult(result.response);
    return;
  }

  const output = await draftWithDatabaseFallback(message);
  if (output.draft) {
    await savePendingDraft(args.user, output.draft);
  }

  printResult(output.response);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`IDX email bridge failed: ${message}\n`);
  process.exitCode = 1;
});
