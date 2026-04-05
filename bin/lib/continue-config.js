// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

const YAML = require("yaml");

const DEFAULT_CHAT_MODEL = "qwen3.5:27b-q4_K_M";
const DEFAULT_AUTOCOMPLETE_MODEL = "qwen2.5-coder:1.5b-base";

function buildContinueConfig({
  title = "NemoClaw Continue Local",
  ollamaBaseUrl = "http://127.0.0.1:11434",
  chatModel = DEFAULT_CHAT_MODEL,
  autocompleteModel = DEFAULT_AUTOCOMPLETE_MODEL,
} = {}) {
  return {
    name: title,
    version: "0.0.1",
    schema: "v1",
    models: [
      {
        name: "Qwen 3.5 27B",
        provider: "ollama",
        model: chatModel,
        apiBase: ollamaBaseUrl,
        roles: ["chat", "edit", "apply"],
      },
      {
        name: "Qwen 2.5 Coder 1.5B Base",
        provider: "ollama",
        model: autocompleteModel,
        apiBase: ollamaBaseUrl,
        roles: ["autocomplete"],
      },
    ],
    rules: [
      "Use chat/edit for substantial code changes and architecture work.",
      "Use autocomplete only for short inline completions.",
      "Do not store API keys or secrets in Continue config.",
    ],
  };
}

function renderContinueConfig(options = {}) {
  return YAML.stringify(buildContinueConfig(options), {
    blockQuote: false,
    defaultStringType: "PLAIN",
  });
}

module.exports = {
  DEFAULT_AUTOCOMPLETE_MODEL,
  DEFAULT_CHAT_MODEL,
  buildContinueConfig,
  renderContinueConfig,
};
