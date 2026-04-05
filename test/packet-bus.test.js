// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packetBus = require("../bin/lib/packet-bus");

describe("packet bus", () => {
  it("creates workflow mailboxes with secure-ish defaults", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-bus-"));
    const manifest = packetBus.ensureWorkflow(root, "demo-flow");
    expect(manifest.workflow_id).toBe("demo-flow");
    expect(fs.existsSync(path.join(root, "demo-flow", "main", "inbox"))).toBe(true);
    expect(fs.existsSync(path.join(root, "demo-flow", "reviewer", "outbox"))).toBe(true);
  });

  it("creates and routes packets between role mailboxes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-bus-"));
    const artifact = path.join(root, "diff.patch");
    fs.writeFileSync(artifact, "diff --git a/a b/a\n");

    const created = packetBus.createPacket({
      root,
      workflowId: "webapp-review",
      fromRole: "main",
      toRole: "reviewer",
      taskType: "code-review",
      summary: "Review the latest diff",
      requestedOutput: "Findings only",
      artifacts: [artifact],
      constraints: { severity: "high" },
    });

    expect(created.packet.task_type).toBe("code-review");
    expect(created.packet.artifact_paths).toHaveLength(1);

    const routed = packetBus.routePacket({
      root,
      workflowId: "webapp-review",
      fromRole: "main",
      toRole: "reviewer",
      packetId: created.packet.packet_id,
    });

    expect(routed.packet.status).toBe("delivered");
    const delivered = packetBus.readPacket(root, "webapp-review", "reviewer", "inbox", created.packet.packet_id);
    expect(delivered.summary).toBe("Review the latest diff");
  });
});
