#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

const fs = require("node:fs");
const path = require("node:path");

const { renderContinueConfig } = require("../bin/lib/continue-config");

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
  node scripts/write-continue-config.js [--output <path>] [--chat-model <ollama-model>] [--autocomplete-model <ollama-model>] [--ollama-base-url <url>]
`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  const rendered = renderContinueConfig({
    chatModel: options["chat-model"],
    autocompleteModel: options["autocomplete-model"],
    ollamaBaseUrl: options["ollama-base-url"],
  });
  if (!options.output) {
    process.stdout.write(rendered);
    return;
  }
  const outputPath = path.resolve(options.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, rendered);
}

try {
  main();
} catch (err) {
  console.error(err.message || String(err));
  process.exit(1);
}
