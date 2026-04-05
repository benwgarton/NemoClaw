// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

const { buildContinueConfig, renderContinueConfig } = require("../bin/lib/continue-config");

describe("continue config", () => {
  it("assigns Qwen 27B to chat/edit/apply and a smaller model to autocomplete", () => {
    const config = buildContinueConfig();
    expect(config.models).toHaveLength(2);
    expect(config.models[0].roles).toEqual(["chat", "edit", "apply"]);
    expect(config.models[1].roles).toEqual(["autocomplete"]);
  });

  it("renders valid yaml text", () => {
    const yaml = renderContinueConfig();
    expect(yaml).toContain("schema: v1");
    expect(yaml).toContain("provider: ollama");
    expect(yaml).toContain("roles:");
  });
});
