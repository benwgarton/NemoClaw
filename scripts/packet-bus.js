#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

const {
  DEFAULT_ROLES,
  createPacket,
  defaultBusRoot,
  ensureWorkflow,
  listPackets,
  routePacket,
} = require("../bin/lib/packet-bus");

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { _: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const current = rest[i];
    if (!current.startsWith("--")) {
      options._.push(current);
      continue;
    }
    const key = current.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith("--")) {
      if (options[key] === undefined) options[key] = next;
      else if (Array.isArray(options[key])) options[key].push(next);
      else options[key] = [options[key], next];
      i += 1;
      continue;
    }
    options[key] = true;
  }
  return { command, options };
}

function readJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    throw new Error(`Invalid JSON: ${err.message}`);
  }
}

function ensureArray(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function usage() {
  console.log(`Usage:
  node scripts/packet-bus.js init --workflow <id> [--root <dir>] [--roles main,coder,...]
  node scripts/packet-bus.js create --workflow <id> --from <role> --to <role> --type <task> --summary <text> --requested-output <text> [--artifact <path>] [--constraints-json <json>] [--metadata-json <json>]
  node scripts/packet-bus.js route --workflow <id> --from <role> --to <role> --packet <packet-id> [--router <role>]
  node scripts/packet-bus.js list --workflow <id> --role <role> [--box inbox|outbox]
`);
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const root = options.root || defaultBusRoot();

  if (!command || options.help) {
    usage();
    process.exit(command ? 0 : 1);
  }

  if (command === "init") {
    const roles =
      typeof options.roles === "string" && options.roles.trim()
        ? options.roles.split(",").map((role) => role.trim()).filter(Boolean)
        : DEFAULT_ROLES;
    const manifest = ensureWorkflow(root, options.workflow, roles);
    console.log(JSON.stringify({ root, manifest }, null, 2));
    return;
  }

  if (command === "create") {
    const result = createPacket({
      root,
      workflowId: options.workflow,
      fromRole: options.from,
      toRole: options.to,
      taskType: options.type,
      summary: options.summary,
      requestedOutput: options["requested-output"],
      artifacts: ensureArray(options.artifact),
      constraints: readJson(options["constraints-json"], {}),
      metadata: readJson(options["metadata-json"], {}),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "route") {
    const result = routePacket({
      root,
      workflowId: options.workflow,
      fromRole: options.from,
      toRole: options.to,
      packetId: options.packet,
      routerRole: options.router || "main",
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "list") {
    const packets = listPackets(root, options.workflow, options.role, options.box || "inbox");
    console.log(JSON.stringify({ root, packets }, null, 2));
    return;
  }

  usage();
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error(err.message || String(err));
  process.exit(1);
}
