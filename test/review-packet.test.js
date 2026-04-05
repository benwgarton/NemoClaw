// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const {
  buildCodexReviewPrompt,
  prepareReviewWorkspace,
  selectReviewBackend,
} = require("../scripts/review-packet");

describe("review packet", () => {
  it("prefers explicit backend selection", () => {
    const backend = selectReviewBackend({
      explicitBackend: "openai",
      codexRuntime: { bin: "codex", codexHome: "/tmp/codex" },
      openaiApiKey: "sk-test",
    });
    expect(backend).toBe("openai");
  });

  it("prefers codex when local Codex auth is available", () => {
    const backend = selectReviewBackend({
      codexRuntime: { bin: "codex", codexHome: "/tmp/codex" },
      openaiApiKey: "",
    });
    expect(backend).toBe("codex");
  });

  it("copies packet artifacts into a disposable Codex workspace", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-review-root-"));
    const inbox = path.join(root, "demo", "reviewer", "inbox", "pkt-1", "artifacts");
    fs.mkdirSync(inbox, { recursive: true });
    fs.writeFileSync(path.join(inbox, "diff.patch"), "diff --git a/a b/a\n");
    const packet = {
      packet_id: "pkt-1",
      workflow_id: "demo",
      task_type: "code-review",
      summary: "Review the patch",
      requested_output: "Findings only",
      artifact_paths: ["diff.patch"],
      constraints: {},
    };

    const workspace = prepareReviewWorkspace(root, "demo", "reviewer", packet);
    expect(fs.existsSync(path.join(workspace, "packet.json"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, "artifacts", "diff.patch"))).toBe(true);
  });

  it("builds a Codex review prompt that points to the workspace files", () => {
    const prompt = buildCodexReviewPrompt({
      task_type: "code-review",
      summary: "Review touched files",
      requested_output: "Findings only",
    });
    expect(prompt).toContain("packet.json");
    expect(prompt).toContain("artifacts/");
  });
});
