#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const { createPacket, defaultBusRoot, readPacket, roleInbox } = require("../bin/lib/packet-bus");

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const DEFAULT_MODEL = process.env.OPENAI_REVIEW_MODEL || "gpt-5.4";

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      i += 1;
    } else {
      options[key] = true;
    }
  }
  return options;
}

function usage() {
  console.log(`Usage:
  node scripts/review-packet.js --workflow <id> --packet <packet-id> [--root <dir>] [--role reviewer] [--reply-to <role>] [--backend codex|openai]
`);
}

function readArtifactText(root, workflowId, role, packetId, artifactPath) {
  const source = path.join(roleInbox(root, workflowId, role), packetId, "artifacts", artifactPath);
  return fs.readFileSync(source, "utf8");
}

function readArtifactPath(root, workflowId, role, packetId, artifactPath) {
  return path.join(roleInbox(root, workflowId, role), packetId, "artifacts", artifactPath);
}

function buildReviewPrompt(packet, artifactTexts) {
  const renderedArtifacts = artifactTexts
    .map((artifact) => `## ${artifact.name}\n\n${artifact.content}`)
    .join("\n\n");
  return [
    "Review the supplied code packet and return findings only.",
    "Prioritize correctness bugs, regressions, security issues, and missing tests.",
    "Do not propose style cleanups unless they are severe and user-visible.",
    "Respond in Markdown with a short Findings section. If there are no findings, say 'No findings.'",
    "",
    `Task type: ${packet.task_type}`,
    `Summary: ${packet.summary}`,
    `Requested output: ${packet.requested_output}`,
    "",
    "Constraints:",
    JSON.stringify(packet.constraints || {}, null, 2),
    "",
    renderedArtifacts,
  ].join("\n");
}

function buildCodexReviewPrompt(packet) {
  return [
    "Review the supplied code packet and return findings only.",
    "Prioritize correctness bugs, regressions, security issues, and missing tests.",
    "Do not propose style cleanups unless they are severe and user-visible.",
    "Use packet.json for task metadata and inspect files under artifacts/.",
    "Respond in Markdown with a short Findings section. If there are no findings, say 'No findings.'",
    "",
    `Task type: ${packet.task_type}`,
    `Summary: ${packet.summary}`,
    `Requested output: ${packet.requested_output}`,
  ].join("\n");
}

function safeArtifactTargetName(artifactPath) {
  const normalized = String(artifactPath || "").replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length) {
    throw new Error("Artifact path is required");
  }
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error(`Artifact path traversal is not allowed: ${artifactPath}`);
  }
  return path.join(...parts);
}

function prepareReviewWorkspace(root, workflowId, role, packet) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-review-"));
  fs.mkdirSync(path.join(workspace, "artifacts"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "packet.json"), `${JSON.stringify(packet, null, 2)}\n`);

  for (const artifactPath of packet.artifact_paths || []) {
    const source = readArtifactPath(root, workflowId, role, packet.packet_id, artifactPath);
    const relativeTarget = safeArtifactTargetName(artifactPath);
    const destination = path.join(workspace, "artifacts", relativeTarget);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }

  return workspace;
}

function candidateCodexHomes() {
  const candidates = [];
  if (process.env.CODEX_HOME) candidates.push(process.env.CODEX_HOME);
  candidates.push(path.join(os.homedir(), ".codex"));

  const windowsUsersRoot = "/mnt/c/Users";
  try {
    for (const entry of fs.readdirSync(windowsUsersRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      candidates.push(path.join(windowsUsersRoot, entry.name, ".codex"));
    }
  } catch {
    // Windows home folders may not be mounted.
  }

  return Array.from(new Set(candidates));
}

function resolveCodexHome() {
  for (const candidate of candidateCodexHomes()) {
    const authPath = path.join(candidate, "auth.json");
    if (fs.existsSync(authPath)) {
      return candidate;
    }
  }
  return null;
}

function candidateCodexBins() {
  const candidates = [];
  if (process.env.CODEX_BIN) candidates.push(process.env.CODEX_BIN);
  if (process.platform !== "win32") {
    const nvmRoot = path.join(os.homedir(), ".nvm", "versions", "node");
    try {
      const versions = fs.readdirSync(nvmRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
      versions
        .map((entry) => path.join(nvmRoot, entry.name, "bin", "codex"))
        .forEach((candidate) => candidates.push(candidate));
    } catch {
      // nvm may not be present.
    }
    candidates.push(path.join(os.homedir(), ".local", "bin", "codex"));
  }
  candidates.push("codex");
  return Array.from(new Set(candidates));
}

function canExecute(command, args = [], env = process.env) {
  try {
    const result = spawnSync(command, args, {
      env,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function resolveCodexRuntime() {
  const codexHome = resolveCodexHome();
  const env = {
    ...process.env,
    ...(codexHome ? { CODEX_HOME: codexHome } : {}),
  };

  for (const candidate of candidateCodexBins()) {
    if (canExecute(candidate, ["--version"], env)) {
      return { bin: candidate, codexHome };
    }
  }

  return null;
}

function selectReviewBackend(options = {}) {
  const explicitBackend = options.explicitBackend || process.env.NEMOCLAW_REVIEW_BACKEND;
  if (explicitBackend) return explicitBackend;
  if (options.codexRuntime) return "codex";
  if (options.openaiApiKey) return "openai";
  throw new Error("No review backend available. Configure Codex login or OPENAI_API_KEY.");
}

async function callOpenAI(prompt, model) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required");
  }
  const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: "medium" },
      input: prompt,
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json();
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  return JSON.stringify(payload, null, 2);
}

async function callCodex(prompt, model, workspaceDir, runtime) {
  if (!runtime?.bin) {
    throw new Error("Codex CLI is not available");
  }
  const outputFile = path.join(workspaceDir, "review.md");
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--color",
    "never",
    "-s",
    "read-only",
    "-C",
    workspaceDir,
    "-m",
    model,
    "-o",
    outputFile,
    "-",
  ];
  const env = {
    ...process.env,
    ...(runtime.codexHome ? { CODEX_HOME: runtime.codexHome } : {}),
  };

  await new Promise((resolve, reject) => {
    const proc = spawn(runtime.bin, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    proc.stdout.on("data", () => {
      // The final message is written to outputFile.
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `Codex review failed with exit code ${code}`));
    });
    proc.stdin.end(prompt);
  });

  if (!fs.existsSync(outputFile)) {
    throw new Error("Codex review completed without an output message");
  }
  return fs.readFileSync(outputFile, "utf8").trim();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.workflow || !options.packet) {
    usage();
    process.exit(options.help ? 0 : 1);
  }
  const root = options.root || defaultBusRoot();
  const role = options.role || "reviewer";
  const replyTo = options["reply-to"] || "main";
  const packet = readPacket(root, options.workflow, role, "inbox", options.packet);
  const artifactTexts = (packet.artifact_paths || []).map((artifactPath) => ({
    name: artifactPath,
    content: readArtifactText(root, options.workflow, role, packet.packet_id, artifactPath),
  }));
  const runtime = resolveCodexRuntime();
  const backend = selectReviewBackend({
    explicitBackend: options.backend,
    codexRuntime: runtime,
    openaiApiKey: process.env.OPENAI_API_KEY,
  });
  const model = options.model || DEFAULT_MODEL;

  let review;
  if (backend === "openai") {
    review = await callOpenAI(buildReviewPrompt(packet, artifactTexts), model);
  } else if (backend === "codex") {
    const workspaceDir = prepareReviewWorkspace(root, options.workflow, role, packet);
    try {
      review = await callCodex(buildCodexReviewPrompt(packet), model, workspaceDir, runtime);
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  } else {
    throw new Error(`Unsupported review backend: ${backend}`);
  }

  const reviewFile = path.join(process.cwd(), `.tmp-review-${packet.packet_id}.md`);
  fs.writeFileSync(reviewFile, `${review}\n`);
  try {
    createPacket({
      root,
      workflowId: options.workflow,
      fromRole: role,
      toRole: replyTo,
      taskType: "review-findings",
      summary: `Review findings for ${packet.packet_id}`,
      requestedOutput: "Integrate or acknowledge the review findings.",
      artifacts: [reviewFile],
      constraints: {
        reviewed_packet: packet.packet_id,
        model,
        backend,
      },
    });
  } finally {
    fs.rmSync(reviewFile, { force: true });
  }
}

module.exports = {
  buildCodexReviewPrompt,
  buildReviewPrompt,
  prepareReviewWorkspace,
  resolveCodexHome,
  resolveCodexRuntime,
  selectReviewBackend,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || String(err));
    process.exit(1);
  });
}
