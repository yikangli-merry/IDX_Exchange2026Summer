import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");

function parseArgs(argv) {
  const args = {
    limit: undefined,
    progressInterval: 10
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--limit" || arg === "-l") {
      const rawLimit = argv[index + 1];
      const limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error("--limit must be a positive integer.");
      }
      args.limit = limit;
      index += 1;
    } else if (arg === "--progress-interval") {
      const rawInterval = argv[index + 1];
      const progressInterval = Number(rawInterval);
      if (!Number.isInteger(progressInterval) || progressInterval < 1) {
        throw new Error("--progress-interval must be a positive integer.");
      }
      args.progressInterval = progressInterval;
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
    if (!process.env[key]?.trim()) {
      process.env[key] = value;
    }
  }
}

function isPlaceholderOpenAiKey(value) {
  const normalized = value.trim().toLowerCase();
  return normalized === "your_openai_api_key" || normalized === "your_openai_key" || normalized.includes("your_openai");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await loadProjectEnv();

  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is required to generate listing embeddings.");
  }
  if (isPlaceholderOpenAiKey(process.env.OPENAI_API_KEY)) {
    throw new Error("OPENAI_API_KEY still looks like a placeholder; set a real key before generating listing embeddings.");
  }

  const [
    { generateListingEmbeddings, defaultEmbeddingModel },
    { closePool, query }
  ] = await Promise.all([
    import("../src/semanticSearch.ts"),
    import("../src/db.ts")
  ]);

  try {
    let lastProgressAt = -1;
    process.stderr.write(`Starting listing embedding generation${args.limit ? ` for up to ${args.limit} active listing(s)` : ""}...\n`);
    const summary = await generateListingEmbeddings(args.limit, {
      onProgress: (progress) => {
        const shouldPrint =
          progress.processed === 0 ||
          progress.processed === progress.total ||
          progress.processed - lastProgressAt >= args.progressInterval;
        if (!shouldPrint) {
          return;
        }

        lastProgressAt = progress.processed;
        const listingSuffix = progress.listingId ? `; latest ${progress.listingId}` : "";
        process.stderr.write(
          `Embedding progress: ${progress.processed}/${progress.total}; generated ${progress.generated}; skipped ${progress.skipped}${listingSuffix}\n`
        );
      }
    });
    const [cache] = await query(
      "SELECT COUNT(*) AS total, COUNT(DISTINCT embedding_model) AS models FROM rets_property_embeddings"
    );
    process.stdout.write(`${JSON.stringify({
      cache,
      limit: args.limit ?? null,
      model: defaultEmbeddingModel(),
      ...summary
    }, null, 2)}\n`);
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Embedding generation failed: ${message}\n`);
  process.exitCode = 1;
});
