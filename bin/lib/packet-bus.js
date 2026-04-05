// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_ROLES = ["main", "coder", "reviewer", "researcher", "browser-operator"];
const DEFAULT_BUS_ROOT = path.join(os.homedir(), ".openclaw", "bus");
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function defaultBusRoot() {
  return path.resolve(process.env.OPENCLAW_PACKET_BUS_ROOT || DEFAULT_BUS_ROOT);
}

function sanitizeIdentifier(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  const normalized = value.trim().toLowerCase();
  if (!ID_PATTERN.test(normalized)) {
    throw new Error(`${label} must match ${ID_PATTERN}`);
  }
  return normalized;
}

function ensureDirectory(dirPath, mode = 0o700) {
  fs.mkdirSync(dirPath, { recursive: true, mode });
  try {
    fs.chmodSync(dirPath, mode);
  } catch {
    // Best effort on platforms/filesystems that do not support chmod.
  }
  return dirPath;
}

function workflowRoot(root, workflowId) {
  return path.join(path.resolve(root), sanitizeIdentifier(workflowId, "workflowId"));
}

function roleRoot(root, workflowId, role) {
  return path.join(workflowRoot(root, workflowId), sanitizeIdentifier(role, "role"));
}

function roleInbox(root, workflowId, role) {
  return path.join(roleRoot(root, workflowId, role), "inbox");
}

function roleOutbox(root, workflowId, role) {
  return path.join(roleRoot(root, workflowId, role), "outbox");
}

function roleArchive(root, workflowId, role) {
  return path.join(roleRoot(root, workflowId, role), "archive");
}

function ensureWorkflow(root, workflowId, roles = DEFAULT_ROLES) {
  const busRoot = path.resolve(root);
  const safeWorkflowId = sanitizeIdentifier(workflowId, "workflowId");
  ensureDirectory(busRoot, 0o700);
  const wfRoot = workflowRoot(busRoot, safeWorkflowId);
  ensureDirectory(wfRoot, 0o700);

  const safeRoles = Array.from(
    new Set((roles || DEFAULT_ROLES).map((role) => sanitizeIdentifier(role, "role"))),
  );
  for (const role of safeRoles) {
    ensureDirectory(roleInbox(busRoot, safeWorkflowId, role), 0o700);
    ensureDirectory(roleOutbox(busRoot, safeWorkflowId, role), 0o700);
    ensureDirectory(roleArchive(busRoot, safeWorkflowId, role), 0o700);
  }

  const manifestPath = path.join(wfRoot, "manifest.json");
  const manifest = {
    workflow_id: safeWorkflowId,
    roles: safeRoles,
    updated_at: new Date().toISOString(),
  };
  if (!fs.existsSync(manifestPath)) {
    manifest.created_at = manifest.updated_at;
  } else {
    const current = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.created_at = current.created_at || manifest.updated_at;
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  try {
    fs.chmodSync(manifestPath, 0o600);
  } catch {
    // Best effort.
  }
  return manifest;
}

function resolvePacketDirectory(baseDir, packetId, create = false) {
  const safePacketId = sanitizeIdentifier(packetId, "packetId");
  const dir = path.join(baseDir, safePacketId);
  if (create) ensureDirectory(dir, 0o700);
  return dir;
}

function packetArtifactsDir(packetDir) {
  return path.join(packetDir, "artifacts");
}

function copyArtifacts(artifacts, destinationDir) {
  const copied = [];
  ensureDirectory(destinationDir, 0o700);
  for (const artifact of artifacts || []) {
    const source = path.resolve(String(artifact));
    if (!fs.existsSync(source)) {
      throw new Error(`Artifact not found: ${source}`);
    }
    const baseName = path.basename(source);
    const targetName = copied.some((entry) => entry.path === baseName)
      ? `${path.parse(baseName).name}-${crypto.randomBytes(4).toString("hex")}${path.extname(baseName)}`
      : baseName;
    const destination = path.join(destinationDir, targetName);
    fs.copyFileSync(source, destination);
    copied.push({
      path: targetName,
      original_path: source,
      size_bytes: fs.statSync(destination).size,
    });
  }
  return copied;
}

function packetFile(packetDir) {
  return path.join(packetDir, "packet.json");
}

function writePacket(packetDir, packet) {
  fs.writeFileSync(packetFile(packetDir), JSON.stringify(packet, null, 2));
  try {
    fs.chmodSync(packetFile(packetDir), 0o600);
  } catch {
    // Best effort.
  }
  return packet;
}

function readPacket(root, workflowId, role, box, packetId) {
  const baseDir = box === "inbox" ? roleInbox(root, workflowId, role) : roleOutbox(root, workflowId, role);
  const packetDir = resolvePacketDirectory(baseDir, packetId, false);
  return JSON.parse(fs.readFileSync(packetFile(packetDir), "utf8"));
}

function createPacket(options) {
  const {
    root = defaultBusRoot(),
    workflowId,
    fromRole,
    toRole,
    taskType,
    summary,
    artifacts = [],
    constraints = {},
    requestedOutput,
    packetId,
    metadata = {},
    box = "outbox",
  } = options || {};

  const safeWorkflowId = sanitizeIdentifier(workflowId, "workflowId");
  const safeFromRole = sanitizeIdentifier(fromRole, "fromRole");
  const safeToRole = sanitizeIdentifier(toRole, "toRole");
  const safeTaskType = sanitizeIdentifier(taskType, "taskType");
  if (typeof summary !== "string" || !summary.trim()) {
    throw new Error("summary is required");
  }
  if (typeof requestedOutput !== "string" || !requestedOutput.trim()) {
    throw new Error("requestedOutput is required");
  }
  if (!["outbox", "inbox"].includes(box)) {
    throw new Error("box must be 'inbox' or 'outbox'");
  }

  ensureWorkflow(root, safeWorkflowId, [safeFromRole, safeToRole]);
  const safePacketId = packetId ? sanitizeIdentifier(packetId, "packetId") : `pkt-${crypto.randomBytes(8).toString("hex")}`;
  const baseDir =
    box === "inbox" ? roleInbox(root, safeWorkflowId, safeToRole) : roleOutbox(root, safeWorkflowId, safeFromRole);
  const packetDir = resolvePacketDirectory(baseDir, safePacketId, true);
  const copiedArtifacts = copyArtifacts(artifacts, packetArtifactsDir(packetDir));
  const now = new Date().toISOString();
  const packet = {
    packet_id: safePacketId,
    workflow_id: safeWorkflowId,
    from_role: safeFromRole,
    to_role: safeToRole,
    task_type: safeTaskType,
    summary: summary.trim(),
    artifact_paths: copiedArtifacts.map((artifact) => artifact.path),
    constraints,
    requested_output: requestedOutput.trim(),
    metadata,
    status: box === "inbox" ? "delivered" : "queued",
    created_at: now,
    updated_at: now,
  };
  writePacket(packetDir, packet);
  return {
    packet,
    packetDir,
  };
}

function routePacket(options) {
  const { root = defaultBusRoot(), workflowId, fromRole, toRole, packetId, routerRole = "main" } = options || {};
  const safeWorkflowId = sanitizeIdentifier(workflowId, "workflowId");
  const safeFromRole = sanitizeIdentifier(fromRole, "fromRole");
  const safeToRole = sanitizeIdentifier(toRole, "toRole");
  const safePacketId = sanitizeIdentifier(packetId, "packetId");
  const safeRouterRole = sanitizeIdentifier(routerRole, "routerRole");

  ensureWorkflow(root, safeWorkflowId, [safeFromRole, safeToRole, safeRouterRole]);
  const sourceDir = resolvePacketDirectory(roleOutbox(root, safeWorkflowId, safeFromRole), safePacketId, false);
  const destDir = resolvePacketDirectory(roleInbox(root, safeWorkflowId, safeToRole), safePacketId, true);
  fs.cpSync(sourceDir, destDir, { recursive: true, force: true });
  const packet = JSON.parse(fs.readFileSync(packetFile(destDir), "utf8"));
  packet.status = "delivered";
  packet.to_role = safeToRole;
  packet.updated_at = new Date().toISOString();
  packet.last_routed_by = safeRouterRole;
  writePacket(destDir, packet);
  return {
    packet,
    sourceDir,
    destDir,
  };
}

function listPackets(root, workflowId, role, box) {
  const safeWorkflowId = sanitizeIdentifier(workflowId, "workflowId");
  const safeRole = sanitizeIdentifier(role, "role");
  const dir = box === "inbox" ? roleInbox(root, safeWorkflowId, safeRole) : roleOutbox(root, safeWorkflowId, safeRole);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      packetId: entry.name,
      packetPath: packetFile(path.join(dir, entry.name)),
    }))
    .filter((entry) => fs.existsSync(entry.packetPath))
    .map((entry) => JSON.parse(fs.readFileSync(entry.packetPath, "utf8")))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

module.exports = {
  DEFAULT_BUS_ROOT,
  DEFAULT_ROLES,
  createPacket,
  defaultBusRoot,
  ensureWorkflow,
  listPackets,
  readPacket,
  roleArchive,
  roleInbox,
  roleOutbox,
  routePacket,
  sanitizeIdentifier,
  workflowRoot,
};
