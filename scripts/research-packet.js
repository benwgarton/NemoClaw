#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

const fs = require("node:fs");
const path = require("node:path");

const { createPacket, defaultBusRoot, readPacket } = require("../bin/lib/packet-bus");

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
  node scripts/research-packet.js --workflow <id> --packet <packet-id> [--root <dir>] [--role researcher] [--reply-to <role>]
`);
}

async function braveSearch(query, limit = 5) {
  if (!process.env.BRAVE_SEARCH_API_KEY) {
    throw new Error("BRAVE_SEARCH_API_KEY is required for query-based research packets");
  }
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(limit));
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY,
    },
  });
  if (!response.ok) {
    throw new Error(`Brave Search request failed: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json();
  return (payload.web?.results || []).map((result) => ({
    title: result.title,
    url: result.url,
    description: result.description,
  }));
}

async function fetchUrlSummary(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "NemoClaw Research Sidecar/0.1",
      "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: ${response.status}`);
  }
  const body = await response.text();
  const titleMatch = body.match(/<title[^>]*>([^<]+)<\/title>/i);
  const descriptionMatch = body.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  const text = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
  return {
    url,
    title: titleMatch ? titleMatch[1].trim() : url,
    description: descriptionMatch ? descriptionMatch[1].trim() : "",
    excerpt: text,
  };
}

function renderResearchMarkdown(packet, entries) {
  const lines = [
    `# Research Packet ${packet.packet_id}`,
    "",
    `Summary: ${packet.summary}`,
    "",
    "## Findings",
    "",
  ];
  if (!entries.length) {
    lines.push("No results.");
    return `${lines.join("\n")}\n`;
  }
  for (const entry of entries) {
    lines.push(`- [${entry.title}](${entry.url})`);
    if (entry.description) lines.push(`  ${entry.description}`);
    if (entry.excerpt) lines.push(`  Excerpt: ${entry.excerpt}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.workflow || !options.packet) {
    usage();
    process.exit(options.help ? 0 : 1);
  }
  const root = options.root || defaultBusRoot();
  const role = options.role || "researcher";
  const replyTo = options["reply-to"] || "main";
  const packet = readPacket(root, options.workflow, role, "inbox", options.packet);
  const constraints = packet.constraints || {};

  let results = [];
  if (typeof constraints.query === "string" && constraints.query.trim()) {
    results = await braveSearch(constraints.query.trim(), Number(constraints.max_results || 5));
  } else if (Array.isArray(constraints.urls) && constraints.urls.length) {
    results = [];
    for (const url of constraints.urls.slice(0, Number(constraints.max_results || 5))) {
      results.push(await fetchUrlSummary(String(url)));
    }
  } else {
    throw new Error("Research packet requires constraints.query or constraints.urls");
  }

  const reportPath = path.join(process.cwd(), `.tmp-research-${packet.packet_id}.md`);
  fs.writeFileSync(reportPath, renderResearchMarkdown(packet, results));
  try {
    createPacket({
      root,
      workflowId: options.workflow,
      fromRole: role,
      toRole: replyTo,
      taskType: "research-results",
      summary: `Research results for ${packet.packet_id}`,
      requestedOutput: "Use these results as cited background material.",
      artifacts: [reportPath],
      constraints: {
        source_packet: packet.packet_id,
        result_count: results.length,
      },
    });
  } finally {
    fs.rmSync(reportPath, { force: true });
  }
}

main().catch((err) => {
  console.error(err.message || String(err));
  process.exit(1);
});
