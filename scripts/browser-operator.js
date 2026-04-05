#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { createPacket, defaultBusRoot, readPacket } = require("../bin/lib/packet-bus");

const IRREVERSIBLE_WORDS = [
  "approve",
  "buy",
  "checkout",
  "confirm",
  "delete",
  "pay",
  "place order",
  "publish",
  "remove",
  "save",
  "send",
  "submit",
];

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
  node scripts/browser-operator.js --workflow <id> --packet <packet-id> [--root <dir>] [--role browser-operator] [--reply-to <role>] [--confirm <token>] [--allow-execute]
`);
}

function toArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function collectOperationText(packet) {
  const constraints = packet.constraints || {};
  return [
    packet.summary,
    packet.requested_output,
    constraints.goal,
    ...toArray(constraints.steps),
    ...toArray(constraints.actions),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isIrreversible(packet) {
  if (packet?.constraints?.requires_confirmation === true) {
    return true;
  }
  const text = collectOperationText(packet);
  return IRREVERSIBLE_WORDS.some((word) => text.includes(word));
}

function buildConfirmationToken(packet) {
  return crypto
    .createHash("sha256")
    .update(`${packet.workflow_id}:${packet.packet_id}:${packet.summary}:${packet.requested_output}`)
    .digest("hex")
    .slice(0, 16);
}

function buildDryRunReport(packet, options = {}) {
  const constraints = packet.constraints || {};
  const token = options.confirmationToken || buildConfirmationToken(packet);
  const urls = toArray(constraints.urls || constraints.target_url);
  const steps = toArray(constraints.steps);
  const allowExecute = options.allowExecute === true;
  const confirmed = options.confirmed === true;

  const lines = [
    `# Browser Packet ${packet.packet_id}`,
    "",
    `Summary: ${packet.summary}`,
    "",
    "## Mode",
    "",
    allowExecute && confirmed ? "Execution requested." : "Dry run only. No irreversible browser action will be taken.",
    "",
    "## Targets",
    "",
  ];

  if (!urls.length) {
    lines.push("- No URLs supplied.");
  } else {
    for (const url of urls) {
      lines.push(`- ${url}`);
    }
  }

  lines.push("", "## Planned Steps", "");
  if (!steps.length) {
    lines.push("- Review the target pages and stop for human confirmation before any submit/send/delete action.");
  } else {
    for (const step of steps) {
      lines.push(`- ${step}`);
    }
  }

  lines.push("", "## Guardrails", "");
  lines.push("- Browser automation is separated from coding and research.");
  lines.push("- No write-back to repos.");
  lines.push("- No submit/send/delete/purchase/approval step without explicit confirmation.");

  if (isIrreversible(packet)) {
    lines.push("- This packet was flagged as potentially irreversible.");
    lines.push(`- Confirmation token: \`${token}\``);
  }

  if (confirmed) {
    lines.push("- Confirmation status: accepted.");
  } else {
    lines.push("- Confirmation status: pending.");
  }

  return `${lines.join("\n")}\n`;
}

function executionEnabled(options) {
  return options["allow-execute"] === true || process.env.BROWSER_OPERATOR_ALLOW_EXECUTE === "1";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.workflow || !options.packet) {
    usage();
    process.exit(options.help ? 0 : 1);
  }

  const root = options.root || defaultBusRoot();
  const role = options.role || "browser-operator";
  const replyTo = options["reply-to"] || "main";
  const packet = readPacket(root, options.workflow, role, "inbox", options.packet);
  const confirmationToken = buildConfirmationToken(packet);
  const confirmed = options.confirm === confirmationToken;
  const irreversible = isIrreversible(packet);
  const allowExecute = executionEnabled(options);

  const reportFile = path.join(process.cwd(), `.tmp-browser-${packet.packet_id}.md`);
  fs.writeFileSync(
    reportFile,
    buildDryRunReport(packet, {
      allowExecute,
      confirmationToken,
      confirmed,
    }),
  );

  let taskType = "browser-dry-run";
  let requestedOutput = "Review the dry-run plan and confirm before any irreversible action.";
  const constraints = {
    source_packet: packet.packet_id,
    irreversible,
    confirmation_token: confirmationToken,
    confirmed,
    executor_configured: allowExecute,
  };

  if (irreversible && !confirmed) {
    taskType = "browser-confirmation-required";
    requestedOutput = "Obtain explicit human confirmation before routing this packet again.";
  } else if (!allowExecute) {
    taskType = "browser-execution-blocked";
    requestedOutput = "Choose and harden a browser executor before enabling live actions.";
  } else {
    taskType = "browser-ready";
    requestedOutput = "Route this packet to a trusted browser driver for live execution.";
  }

  try {
    createPacket({
      root,
      workflowId: options.workflow,
      fromRole: role,
      toRole: replyTo,
      taskType,
      summary: `Browser operator status for ${packet.packet_id}`,
      requestedOutput,
      artifacts: [reportFile],
      constraints,
    });
  } finally {
    fs.rmSync(reportFile, { force: true });
  }
}

module.exports = {
  buildConfirmationToken,
  buildDryRunReport,
  isIrreversible,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || String(err));
    process.exit(1);
  });
}
