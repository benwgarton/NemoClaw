// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

const {
  buildConfirmationToken,
  buildDryRunReport,
  isIrreversible,
} = require("../scripts/browser-operator");

describe("browser operator", () => {
  it("flags irreversible packets from their summary and steps", () => {
    const packet = {
      summary: "Open the legacy ERP and submit the completed form",
      requested_output: "Finish the workflow",
      constraints: {
        steps: ["Fill out the fields", "Submit the form"],
      },
    };
    expect(isIrreversible(packet)).toBe(true);
  });

  it("builds a stable confirmation token for routing", () => {
    const packet = {
      workflow_id: "falcon-dev",
      packet_id: "pkt-1234",
      summary: "Submit inventory update",
      requested_output: "Return the confirmation number",
    };
    expect(buildConfirmationToken(packet)).toBe(buildConfirmationToken(packet));
    expect(buildConfirmationToken(packet)).toMatch(/^[a-f0-9]{16}$/);
  });

  it("renders a dry-run report with guardrails and a confirmation token", () => {
    const packet = {
      workflow_id: "falcon-dev",
      packet_id: "pkt-1234",
      summary: "Submit inventory update",
      requested_output: "Return the confirmation number",
      constraints: {
        target_url: "https://example.test/form",
        steps: ["Open the form", "Submit the changes"],
      },
    };

    const report = buildDryRunReport(packet, {
      confirmationToken: "abc123token",
      confirmed: false,
      allowExecute: false,
    });
    expect(report).toContain("Dry run only");
    expect(report).toContain("abc123token");
    expect(report).toContain("No submit/send/delete/purchase/approval step without explicit confirmation");
  });
});
