#!/usr/bin/env node
import crypto from "crypto";

const DEFAULT_BASE_URL = "http://127.0.0.1:5173";
const DEFAULT_TIMEOUT_MS = 30000;

const parseArgs = (argv) => {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--base-url" && argv[i + 1]) {
      args.baseUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (value === "--base-urls" && argv[i + 1]) {
      args.baseUrls = argv[i + 1];
      i += 1;
      continue;
    }
    if (value === "--base-url-2" && argv[i + 1]) {
      args.baseUrl2 = argv[i + 1];
      i += 1;
      continue;
    }
    if (value === "--api-keys" && argv[i + 1]) {
      args.apiKeys = argv[i + 1];
      i += 1;
      continue;
    }
    if (value === "--api-key-2" && argv[i + 1]) {
      args.apiKey2 = argv[i + 1];
      i += 1;
      continue;
    }
    if (value === "--api-key" && argv[i + 1]) {
      args.apiKey = argv[i + 1];
      i += 1;
      continue;
    }
    if (value === "--timeout-ms" && argv[i + 1]) {
      args.timeoutMs = Number(argv[i + 1]);
      i += 1;
      continue;
    }
  }
  return args;
};

const args = parseArgs(process.argv);
const rawBaseUrls = args.baseUrls || process.env.BASE_URLS;
const baseUrls = rawBaseUrls
  ? rawBaseUrls.split(",").map((value) => value.trim()).filter(Boolean)
  : [];
if (baseUrls.length === 0) {
  const first = args.baseUrl || process.env.BASE_URL || DEFAULT_BASE_URL;
  baseUrls.push(first);
  const second = args.baseUrl2 || process.env.BASE_URL_2;
  if (second) {
    baseUrls.push(second);
  }
}

if (baseUrls.length < 2) {
  console.error("Need two base URLs. Use --base-urls or --base-url + --base-url-2.");
  process.exit(1);
}

if (baseUrls.length > 2) {
  console.log("More than two base URLs provided. Using the first two only.");
}

const rawApiKeys = args.apiKeys || process.env.API_KEYS;
const apiKeys = rawApiKeys
  ? rawApiKeys.split(",").map((value) => value.trim())
  : [];
if (apiKeys.length === 0) {
  const first = args.apiKey || process.env.API_KEY || "";
  apiKeys.push(first);
  const second = args.apiKey2 || process.env.API_KEY_2 || first;
  apiKeys.push(second);
}

while (apiKeys.length < 2) {
  apiKeys.push(apiKeys[0] || "");
}

const targets = baseUrls.slice(0, 2).map((baseUrl, index) => ({
  baseUrl,
  apiKey: apiKeys[index] || apiKeys[0] || "",
  label: index === 0 ? "A" : "B",
}));

const TIMEOUT_MS = Number(
  args.timeoutMs || process.env.TIMEOUT_MS || DEFAULT_TIMEOUT_MS
);

const gatewayUrl = (baseUrl, path) => new URL(path, baseUrl).toString();

const authHeaders = (apiKey) => ({
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
  Accept: "application/json",
});

const openaiChatPayload = (model) => ({
  model,
  stream: false,
  max_tokens: 16,
  messages: [{ role: "user", content: "ping" }],
});

const anthropicMessagesPayload = (model) => ({
  model,
  max_tokens: 16,
  messages: [{ role: "user", content: "ping" }],
});

const geminiGeneratePayload = () => ({
  contents: [{ role: "user", parts: [{ text: "ping" }] }],
  generationConfig: { maxOutputTokens: 16 },
});

const withTimeout = async (promise) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await promise(controller.signal);
  } finally {
    clearTimeout(timer);
  }
};

const extractErrorDetails = (text) => {
  const result = { info: "", code: "" };
  if (!text) {
    return result;
  }
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object") {
      if (data.error && typeof data.error === "object") {
        result.info = data.error.message || JSON.stringify(data.error);
        result.code =
          data.error.code || data.error.type || data.error.status || "";
        return result;
      }
      if (data.message) {
        result.info = data.message;
        result.code = data.code || data.status || data.type || "";
        return result;
      }
    }
  } catch {
    // ignore json parsing errors
  }
  return result;
};

const hashText = (text) =>
  crypto.createHash("sha256").update(text || "").digest("hex").slice(0, 12);

const runRequest = async (entry, target) => {
  const url = gatewayUrl(target.baseUrl, entry.path);
  const startedAt = Date.now();
  let response;
  let text = "";
  let status = 0;
  let error = "";
  let errorCode = "";
  try {
    response = await withTimeout((signal) =>
      fetch(url, {
        method: "POST",
        headers: authHeaders(target.apiKey),
        body: JSON.stringify(entry.body),
        signal,
      })
    );
    status = response.status;
    text = await response.text();
    if (status >= 400) {
      const details = extractErrorDetails(text);
      error = details.info || "<empty>";
      errorCode = details.code || "<empty>";
    }
  } catch (err) {
    error = String(err);
    errorCode = "<fetch>";
  }

  const elapsedMs = Date.now() - startedAt;
  const label = `[${target.label}] ${entry.label}`;
  console.log(`\n${label} POST ${url}`);
  console.log(`status=${status} elapsed_ms=${elapsedMs}`);
  console.log(`response=${text || "<empty>"}`);
  if (error) {
    console.log(`error_code=${errorCode}`);
    console.log(`error_info=${error}`);
  }
  return {
    label: entry.label,
    status,
    error,
    errorCode,
    response: text || "",
    responseHash: hashText(text || ""),
  };
};

const models = [
  { name: "gemma-3-1b-it", note: "gemini" },
  { name: "claude-haiku-4-5-20251001", note: "anthropic" },
  { name: "anthropic/claude-haiku-4.5", note: "openai" },
  { name: "non-exist-model", note: "invalid" },
];

const endpoints = [
  {
    name: "v1-chat-completions",
    buildPath: () => "/v1/chat/completions",
    buildBody: (model) => openaiChatPayload(model),
  },
  {
    name: "v1-messages",
    buildPath: () => "/v1/messages",
    buildBody: (model) => anthropicMessagesPayload(model),
  },
  {
    name: "v1beta-generate-content",
    buildPath: (model) =>
      `/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    buildBody: () => geminiGeneratePayload(),
  },
];

const main = async () => {
  console.log("Gateway matrix test starting...");
  console.log(`BASE_URL_A=${targets[0].baseUrl}`);
  console.log(`BASE_URL_B=${targets[1].baseUrl}`);
  console.log(`TIMEOUT_MS=${TIMEOUT_MS}`);
  console.log(
    `API_KEY_A=${targets[0].apiKey ? "<provided>" : "<missing>"}`
  );
  console.log(
    `API_KEY_B=${targets[1].apiKey ? "<provided>" : "<missing>"}`
  );

  const entries = [];
  for (const endpoint of endpoints) {
    for (const model of models) {
      entries.push({
        label: `${endpoint.name}::${model.name}`,
        path: endpoint.buildPath(model.name),
        body: endpoint.buildBody(model.name),
      });
    }
  }

  console.log(`Total requests=${entries.length}`);

  const resultsByTarget = {};
  for (const target of targets) {
    resultsByTarget[target.label] = {};
    for (const entry of entries) {
      const result = await runRequest(entry, target);
      resultsByTarget[target.label][entry.label] = result;
    }
  }

  const summarize = (label) =>
    Object.values(resultsByTarget[label]).reduce(
      (acc, item) => {
        if (item.status >= 200 && item.status < 300) {
          acc.success += 1;
        } else if (item.status >= 400) {
          acc.error += 1;
        } else {
          acc.fail += 1;
        }
        return acc;
      },
      { success: 0, error: 0, fail: 0 }
    );

  const summaryA = summarize(targets[0].label);
  const summaryB = summarize(targets[1].label);

  console.log("\nSummary");
  console.log(
    `A: success=${summaryA.success} error=${summaryA.error} fail=${summaryA.fail}`
  );
  console.log(
    `B: success=${summaryB.success} error=${summaryB.error} fail=${summaryB.fail}`
  );

  console.log("\nComparison");
  let mismatchCount = 0;
  for (const entry of entries) {
    const left = resultsByTarget[targets[0].label][entry.label];
    const right = resultsByTarget[targets[1].label][entry.label];
    if (!left || !right) {
      continue;
    }
    const sameStatus = left.status === right.status;
    const sameError =
      left.errorCode === right.errorCode && left.error === right.error;
    const sameResponse = left.responseHash === right.responseHash;
    if (!sameStatus || !sameError || !sameResponse) {
      mismatchCount += 1;
      console.log(`- ${entry.label}`);
      console.log(
        `  status: ${left.status} vs ${right.status} | response_hash: ${left.responseHash} vs ${right.responseHash}`
      );
      console.log(
        `  error: ${left.errorCode}/${left.error || "<empty>"} vs ${right.errorCode}/${right.error || "<empty>"}`
      );
    }
  }
  if (mismatchCount === 0) {
    console.log("All results match.");
  }
};

main();
