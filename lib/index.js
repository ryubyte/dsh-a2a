import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
//#region src/protocol.ts
/**
* A2A (Agent2Agent) Protocol v1.0 — TypeScript type definitions.
*
* These types mirror the normative source of truth `specification/a2a.proto`
* (package `lf.a2a.v1`) from https://github.com/a2aproject/A2A, v1.0.0.
* JSON wire names are camelCase per ProtoJSON serialization; enum values use
* SCREAMING_SNAKE_CASE as mandated by A2A v1.0.
*/
/** The lifecycle states of a Task (a2a.proto `TaskState`). */
let TaskState = /* @__PURE__ */ function(TaskState) {
	TaskState["UNSPECIFIED"] = "TASK_STATE_UNSPECIFIED";
	TaskState["SUBMITTED"] = "TASK_STATE_SUBMITTED";
	TaskState["WORKING"] = "TASK_STATE_WORKING";
	TaskState["COMPLETED"] = "TASK_STATE_COMPLETED";
	TaskState["FAILED"] = "TASK_STATE_FAILED";
	TaskState["CANCELED"] = "TASK_STATE_CANCELED";
	TaskState["INPUT_REQUIRED"] = "TASK_STATE_INPUT_REQUIRED";
	TaskState["REJECTED"] = "TASK_STATE_REJECTED";
	TaskState["AUTH_REQUIRED"] = "TASK_STATE_AUTH_REQUIRED";
	return TaskState;
}({});
function isTerminal(state) {
	return state === "TASK_STATE_COMPLETED" || state === "TASK_STATE_FAILED" || state === "TASK_STATE_CANCELED" || state === "TASK_STATE_REJECTED";
}
/** The sender of a Message (a2a.proto `Role`). */
let Role = /* @__PURE__ */ function(Role) {
	Role["UNSPECIFIED"] = "ROLE_UNSPECIFIED";
	Role["USER"] = "ROLE_USER";
	Role["AGENT"] = "ROLE_AGENT";
	return Role;
}({});
/** A2A JSON-RPC method names (v1.0 canonical PascalCase as in a2a.proto RPCs). */
const A2A_METHODS = {
	sendMessage: "SendMessage",
	sendStreamingMessage: "SendStreamingMessage",
	getTask: "GetTask",
	listTasks: "ListTasks",
	cancelTask: "CancelTask",
	subscribeToTask: "SubscribeToTask",
	getExtendedAgentCard: "GetExtendedAgentCard"
};
/** Standard error codes from the A2A JSON-RPC binding. */
const A2A_ERROR_CODES = {
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,
	TASK_NOT_FOUND: -32001,
	TASK_CANCEL_NOT_ALLOWED: -32002,
	TASK_ALREADY_CANCELED: -32003,
	AGENT_CARD_NOT_FOUND: -32004,
	AGENT_CARD_SIGNATURE_INVALID: -32005,
	CONTEXT_NOT_FOUND: -32006,
	AUTHENTICATION_REQUIRED: -32007,
	PUSH_NOTIFICATION_CONFIG_NOT_FOUND: -32008,
	EXTENSION_NOT_SUPPORTED: -32009,
	UNSUPPORTED_OPERATION: -32010,
	VERSION_NOT_SUPPORTED: -32011
};
//#endregion
//#region src/errors.ts
/** Error class for A2A protocol failures, mirroring JSON-RPC error semantics. */
var A2AError = class A2AError extends Error {
	code;
	data;
	/** True when this error came from a remote agent over the wire. */
	remote;
	constructor(code, message, data, remote = false) {
		super(message);
		this.name = "A2AError";
		this.code = code;
		this.data = data;
		this.remote = remote;
	}
	toJsonRpc() {
		const out = {
			code: this.code,
			message: this.message
		};
		if (this.data !== void 0) out.data = this.data;
		return out;
	}
	static fromJsonRpc(err) {
		return new A2AError(err.code, err.message, err.data, true);
	}
};
//#endregion
//#region src/card.ts
function isAgentCard(value) {
	if (typeof value !== "object" || value === null) return false;
	const v = value;
	return typeof v.name === "string" && typeof v.description === "string" && typeof v.version === "string" && Array.isArray(v.supportedInterfaces) && typeof v.capabilities === "object" && v.capabilities !== null && Array.isArray(v.defaultInputModes) && Array.isArray(v.defaultOutputModes) && Array.isArray(v.skills);
}
function normalizeUrl(base, path) {
	return `${base.endsWith("/") ? base.slice(0, -1) : base}${path.startsWith("/") ? path : `/${path}`}`;
}
/**
* Fetch and validate an agent's AgentCard.
*
* Discovery order (per spec §AgentCard discovery):
*   1. Probe `GET {origin}/.well-known/agent-card.json` first.
*   2. Fall back to the exact configured URL.
* A configured URL that already ends in `agent-card.json` is used directly.
*/
async function fetchAgentCard(baseUrl, options = {}) {
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	const timeoutMs = options.timeoutMs ?? 15e3;
	const headers = { Accept: "application/json" };
	if (options.bearerToken) headers.Authorization = `Bearer ${options.bearerToken}`;
	const wellKnown = normalizeUrl(baseUrl, "/.well-known/agent-card.json");
	const candidates = baseUrl.endsWith("agent-card.json") || baseUrl.endsWith("agent-card.json/") ? [baseUrl] : [wellKnown, baseUrl];
	let lastError;
	for (const url of candidates) {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), timeoutMs);
		try {
			const res = await fetchImpl(url, {
				headers,
				signal: ctrl.signal
			});
			if (res.status === 404) {
				lastError = new A2AError(404, `AgentCard not found at ${url}`, void 0, true);
				continue;
			}
			if (!res.ok) throw new A2AError(res.status, `AgentCard request failed (${res.status}) at ${url}`, void 0, true);
			const json = await res.json();
			if (!isAgentCard(json)) throw new A2AError(400, `Invalid AgentCard at ${url}: missing required fields`, void 0, true);
			return json;
		} catch (err) {
			if (err instanceof Error && err.name === "AbortError") throw new A2AError(408, `AgentCard fetch timed out after ${timeoutMs}ms at ${url}`, void 0, true);
			lastError = err instanceof Error ? err : new Error(String(err));
		} finally {
			clearTimeout(timer);
		}
	}
	throw lastError ?? new A2AError(404, `AgentCard could not be fetched from ${baseUrl}`, void 0, true);
}
/**
* Pick the best interface to talk to an agent from its AgentCard.
*
* Preference order: a JSONRPC interface first, then gRPC, then any other
* binding; the card's own ordering ("first entry is preferred") is respected
* within each binding class. Returns the interface and a normalized base URL
* to post JSON-RPC requests to.
*/
function pickInterface(card, preferred) {
	const ifaces = card.supportedInterfaces ?? [];
	if (ifaces.length === 0) throw new A2AError(-32e3, `AgentCard for "${card.name}" declares no supportedInterfaces`);
	const want = preferred ?? "JSONRPC";
	const iface = [...ifaces].sort((a, b) => {
		return (a.protocolBinding === want ? 0 : a.protocolBinding === "GRPC" ? 1 : 2) - (b.protocolBinding === want ? 0 : b.protocolBinding === "GRPC" ? 1 : 2);
	})[0];
	return {
		iface,
		url: iface.url.endsWith("/") ? iface.url.slice(0, -1) : iface.url
	};
}
//#endregion
//#region src/jsonrpc.ts
var JsonRpcClient = class {
	url;
	timeoutMs;
	bearerToken;
	fetchImpl;
	seq = 0;
	constructor(url, options = {}) {
		this.url = url;
		this.timeoutMs = options.timeoutMs ?? 6e4;
		this.bearerToken = options.bearerToken;
		this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
	}
	headers(extra) {
		const h = {
			"content-type": "application/json",
			accept: "application/json",
			...extra
		};
		if (this.bearerToken) h.authorization = `Bearer ${this.bearerToken}`;
		return h;
	}
	/** Perform a unary JSON-RPC call. */
	async call(method, params, options = {}) {
		const req = {
			jsonrpc: "2.0",
			id: ++this.seq,
			method,
			params
		};
		const ctrl = options.signal ? new AbortController() : void 0;
		const onAbort = () => ctrl?.abort();
		options.signal?.addEventListener("abort", onAbort);
		const timeout = setTimeout(() => ctrl?.abort(), options.timeoutMs ?? this.timeoutMs);
		try {
			const res = await this.fetchImpl(this.url, {
				method: "POST",
				headers: this.headers(),
				body: JSON.stringify(req),
				signal: ctrl?.signal
			});
			if (!res.ok) throw new A2AError(res.status, `A2A JSON-RPC request failed (HTTP ${res.status}) at ${this.url}`, void 0, true);
			const json = await res.json();
			if ("error" in json && json.error) throw A2AError.fromJsonRpc(json.error);
			return json.result;
		} catch (err) {
			if (err instanceof Error && err.name === "AbortError") throw new A2AError(408, `A2A JSON-RPC call "${method}" timed out`, void 0, true);
			throw err;
		} finally {
			clearTimeout(timeout);
			options.signal?.removeEventListener("abort", onAbort);
		}
	}
	/**
	* Open a streaming JSON-RPC call (`SendStreamingMessage`) over SSE and
	* yield the `StreamResponse` events as they arrive. The connection is
	* closed when the returned async iterator is broken or the request is
	* cancelled. Events are decoded from SSE `data:` lines (JSON-RPC result
	* frames); per A2A v1.0 the JSON structure uses member names to
	* discriminate `task` / `message` / `statusUpdate` / `artifactUpdate`.
	*/
	async *stream(method, params, options = {}) {
		const req = {
			jsonrpc: "2.0",
			id: ++this.seq,
			method,
			params
		};
		const ctrl = new AbortController();
		const onAbort = () => ctrl.abort();
		options.signal?.addEventListener("abort", onAbort);
		const timeout = setTimeout(() => ctrl.abort(), options.timeoutMs ?? this.timeoutMs);
		let res;
		try {
			res = await this.fetchImpl(this.url, {
				method: "POST",
				headers: this.headers({ accept: "text/event-stream" }),
				body: JSON.stringify(req),
				signal: ctrl.signal
			});
		} catch (err) {
			clearTimeout(timeout);
			options.signal?.removeEventListener("abort", onAbort);
			if (err instanceof Error && err.name === "AbortError") throw new A2AError(408, `A2A stream "${method}" timed out`, void 0, true);
			throw err;
		}
		if (!res.ok || !res.body) {
			clearTimeout(timeout);
			options.signal?.removeEventListener("abort", onAbort);
			throw new A2AError(res.status, `A2A stream request failed (HTTP ${res.status}) at ${this.url}`, void 0, true);
		}
		try {
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const frames = buffer.split(/\r?\n\r?\n/);
				buffer = frames.pop() ?? "";
				for (const frame of frames) {
					const data = frame.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
					if (!data) continue;
					let payload;
					try {
						payload = JSON.parse(data);
					} catch {
						continue;
					}
					const envelope = payload;
					if (envelope && "error" in envelope && envelope.error) throw A2AError.fromJsonRpc(envelope.error);
					yield payload;
				}
			}
		} finally {
			clearTimeout(timeout);
			options.signal?.removeEventListener("abort", onAbort);
		}
	}
};
//#endregion
//#region src/client.ts
/**
* A2A (Agent2Agent) Protocol v1.0 — outbound client.
*
* A thin client that discovers an agent via its AgentCard and speaks the
* JSONRPC binding: SendMessage (sync/async), SendStreamingMessage,
* GetTask, CancelTask, ListTasks.
*/
/** A2A client bound to one remote agent. */
var A2AClient = class A2AClient {
	card;
	rpc;
	endpointUrl;
	tenant;
	static async connect(agentCardUrlOrBase, options = {}) {
		const card = await fetchAgentCard(agentCardUrlOrBase, options);
		return new A2AClient(card, options);
	}
	constructor(card, options = {}) {
		this.card = card;
		const { iface, url } = pickInterface(card, options.preferredBinding);
		this.endpointUrl = url;
		this.tenant = iface.tenant;
		this.rpc = new JsonRpcClient(url, options);
	}
	/** Send a message; returns a Task or Message per the server's choice. */
	async sendMessage(message, configuration, options = {}) {
		return this.rpc.call("SendMessage", {
			message,
			configuration,
			...this.tenant ? { tenant: this.tenant } : {}
		}, options);
	}
	/** Send a message over a stream, yielding all StreamResponse events. */
	streamMessage(message, configuration = {}, options = {}) {
		return this.rpc.stream("SendStreamingMessage", {
			message,
			configuration,
			...this.tenant ? { tenant: this.tenant } : {}
		}, options);
	}
	async getTask(id, historyLength, options = {}) {
		return this.rpc.call("GetTask", {
			id,
			...historyLength !== void 0 ? { historyLength } : {},
			...this.tenant ? { tenant: this.tenant } : {}
		}, options);
	}
	async listTasks(params = {}, options = {}) {
		return this.rpc.call("ListTasks", {
			...params,
			...this.tenant ? { tenant: this.tenant } : {}
		}, options);
	}
	async cancelTask(id, options = {}) {
		return this.rpc.call("CancelTask", {
			id,
			...this.tenant ? { tenant: this.tenant } : {}
		}, options);
	}
	/**
	* Send a message and wait (polling) until the created task reaches a
	* terminal state. Errors if the task fails or is rejected.
	*/
	async sendAndWait(message, configuration = {}, options = {}) {
		const resp = await this.sendMessage(message, {
			...configuration,
			returnImmediately: true
		}, options);
		if ("message" in resp && resp.message) return {
			id: "message",
			status: {
				state: "TASK_STATE_COMPLETED",
				timestamp: (/* @__PURE__ */ new Date()).toISOString()
			},
			artifacts: [{
				artifactId: "message",
				parts: resp.message.parts
			}],
			history: [resp.message]
		};
		const task = "task" in resp && resp.task ? resp.task : void 0;
		if (!task) throw new A2AError(-32602, "SendMessage returned neither a Task nor a Message");
		let t = task;
		for (;;) {
			if (isTerminal(t.status.state)) return t;
			if (t.status.state === "TASK_STATE_INPUT_REQUIRED" || t.status.state === "TASK_STATE_AUTH_REQUIRED") return t;
			if (options.signal?.aborted) throw new A2AError(408, "Task wait aborted");
			await new Promise((r) => setTimeout(r, options.intervalMs ?? 500));
			t = await this.getTask(t.id, 0, options);
		}
	}
};
//#endregion
//#region src/outbound.ts
function normalizeToolName(raw) {
	const norm = raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
	if (norm.length > 0 && /^[A-Za-z0-9_-]+$/.test(norm)) return norm;
	let h = 0;
	for (let i = 0; i < raw.length; i++) h = h * 31 + raw.charCodeAt(i) >>> 0;
	return `_${h.toString(16)}`;
}
function skillToToolName(agentName, skill) {
	const raw = `a2a__${agentName}__${skill.id}`;
	const base = raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
	if (base === raw || base.length < 64) return base;
	let h = 0;
	for (let i = 0; i < raw.length; i++) h = h * 31 + raw.charCodeAt(i) >>> 0;
	return `${base.slice(0, 56)}_${h.toString(16)}`;
}
/** Extract the first meaningful text from message parts. */
function partsToText(parts) {
	if (!parts) return "";
	return parts.map((p) => {
		if ("text" in p && p.text) return p.text;
		if ("url" in p && p.url) return p.url;
		if ("data" in p && p.data !== void 0) return JSON.stringify(p.data);
		if ("raw" in p && p.raw) return `[raw ${p.mediaType ?? "application/octet-stream"}]`;
		return "";
	}).filter(Boolean).join("\n");
}
/**
* Register all skills of a remote agent on `ctx.tools` and return disposers.
*/
async function registerAgentTools(tools, options) {
	const connectionId = crypto.randomUUID();
	const client = await A2AClient.connect(options.agentCardUrl, {
		bearerToken: options.bearerToken,
		timeoutMs: options.timeoutMs
	});
	const card = client.card;
	const skills = card.skills ?? [];
	options.onReady?.({
		connectionId,
		card
	});
	let disposers = [];
	if (options.mapSkills === false || skills.length === 0) {
		const name = normalizeToolName(`a2a__${options.name}__agent`);
		const dispose = tools.register?.(makeTool(name, client, {
			id: "agent",
			name: options.name,
			description: `${card.name}: ${card.description} (no skills advertised)`
		}));
		if (dispose) disposers = [{
			name,
			dispose
		}];
	} else {
		const out = [];
		for (const skill of skills) {
			const name = skillToToolName(options.name, skill);
			const dispose = tools.register?.(makeTool(name, client, skill));
			if (dispose) out.push({
				name,
				dispose
			});
		}
		disposers = out;
	}
	return disposers.map((r) => ({
		...r,
		connectionId,
		dispose: () => {
			r.dispose();
			options.onDispose?.(connectionId);
		}
	}));
}
function makeTool(name, client, skill) {
	return {
		name,
		description: [skill.description, ...skill.examples?.length ? [`Examples: ${skill.examples.join(" | ")}`] : []].filter(Boolean).join("\n"),
		parameters: {
			type: "object",
			properties: { prompt: {
				type: "string",
				description: "The task or instruction to send to the remote agent."
			} },
			required: ["prompt"]
		},
		output: {
			schema: { type: "string" },
			render: (_args, value) => [{
				type: "text",
				text: String(value)
			}]
		},
		async execute(args, exec) {
			const message = {
				messageId: crypto.randomUUID(),
				role: "ROLE_USER",
				parts: [{ text: args.prompt }]
			};
			try {
				const task = await client.sendAndWait(message, {}, { signal: exec.signal });
				const text = partsToText(task.artifacts?.flatMap((a) => a.parts));
				const failureMsg = task.status.message?.parts?.find((p) => "text" in p && p.text);
				if (task.status.state === "TASK_STATE_FAILED") throw new A2AError(-32e3, `Remote agent task failed: ${text || (failureMsg && "text" in failureMsg ? failureMsg.text : "no detail")}`);
				if (task.status.state === "TASK_STATE_INPUT_REQUIRED" || task.status.state === "TASK_STATE_AUTH_REQUIRED") {
					const ask = (failureMsg && "text" in failureMsg ? failureMsg.text : "") || text || "agent awaits input";
					return `[remote agent ${task.status.state}] ${ask}`;
				}
				return text || "(remote agent returned no output)";
			} catch (err) {
				if (err instanceof A2AError && err.code === -32001 && err.message.includes("interrupted")) throw new Error(`Remote agent requires input: ${err.message}`);
				throw err;
			}
		}
	};
}
//#endregion
//#region src/server.ts
/** In-memory task store with the full A2A Task lifecycle. */
var TaskStore = class {
	tasks = /* @__PURE__ */ new Map();
	messages = /* @__PURE__ */ new Map();
	create(message) {
		const taskId = crypto.randomUUID();
		const task = {
			id: taskId,
			contextId: message.contextId ?? crypto.randomUUID(),
			status: {
				state: "TASK_STATE_SUBMITTED",
				timestamp: (/* @__PURE__ */ new Date()).toISOString()
			},
			artifacts: [],
			history: [message],
			metadata: {}
		};
		this.tasks.set(taskId, task);
		this.messages.set(message.messageId, message);
		return task;
	}
	get(id) {
		return this.tasks.get(id);
	}
	list() {
		return [...this.tasks.values()];
	}
	setStatus(taskId, state, message) {
		const task = this.tasks.get(taskId);
		if (!task) throw new Error(`task ${taskId} not found`);
		task.status = {
			state,
			message,
			timestamp: (/* @__PURE__ */ new Date()).toISOString()
		};
		if (message) {
			this.messages.set(message.messageId, message);
			task.history = [...task.history ?? [], message];
		}
		return task;
	}
	addArtifact(taskId, artifact) {
		const task = this.tasks.get(taskId);
		if (!task) throw new Error(`task ${taskId} not found`);
		const existing = task.artifacts?.find((a) => a.artifactId === artifact.artifactId);
		if (existing) existing.parts.push(...artifact.parts);
		else task.artifacts = [...task.artifacts ?? [], {
			artifactId: artifact.artifactId,
			name: artifact.name,
			parts: artifact.parts
		}];
		return task;
	}
	getMessage(id) {
		return this.messages.get(id);
	}
};
/** Extract a human-readable source address from a request (when visible). */
function sourceOf(req) {
	const s = req.socket;
	if (!s?.remoteAddress) return void 0;
	return `${s.remoteAddress}:${s.remotePort ?? ""}`;
}
/** A2A JSON-RPC server handler over a raw HTTP request/response pair. */
var A2AServer = class {
	options;
	store;
	card;
	endpointPath;
	execute;
	listeners = /* @__PURE__ */ new Set();
	baseUrl;
	constructor(options, store = new TaskStore()) {
		this.options = options;
		this.store = store;
		this.execute = options.execute ?? notConfiguredExecutor;
		this.endpointPath = options.endpointPath ?? "/a2a";
		this.baseUrl = options.baseUrl;
		this.card = this.buildCard();
	}
	/**
	* Update the base URL advertised in the AgentCard after the real listen
	* address is known (e.g. ephemeral port). Mutates `card` in place.
	*/
	setBaseUrl(baseUrl) {
		this.baseUrl = baseUrl.replace(/\/$/, "");
		this.card.supportedInterfaces = this.card.supportedInterfaces.map((iface) => ({
			...iface,
			url: `${this.baseUrl}${this.endpointPath}`
		}));
	}
	buildCard() {
		const iface = {
			url: `${this.baseUrl.replace(/\/$/, "")}${this.endpointPath}`,
			protocolBinding: "JSONRPC",
			protocolVersion: "1.0"
		};
		const skills = this.options.skills ?? [];
		const token = this.options.authToken;
		const card = {
			name: this.options.agentName,
			description: this.options.agentDescription,
			version: this.options.agentVersion,
			supportedInterfaces: [iface],
			provider: this.options.agentProvider ?? {
				url: "https://deepseek.com",
				organization: "DeepSeek"
			},
			capabilities: {
				streaming: true,
				pushNotifications: false,
				extensions: []
			},
			defaultInputModes: this.options.defaultInputModes ?? ["text/plain"],
			defaultOutputModes: this.options.defaultOutputModes ?? ["text/plain"],
			skills,
			...this.options.iconUrl ? { iconUrl: this.options.iconUrl } : {}
		};
		if (token) {
			card.securitySchemes = { bearerAuth: {
				type: "http",
				scheme: "bearer",
				bearerFormat: "opaque"
			} };
			card.securityRequirements = [{ schemes: { bearerAuth: [] } }];
		}
		return card;
	}
	/** True when the request carries the configured bearer token. */
	authorized(req) {
		const token = this.options.authToken;
		if (!token) return true;
		const h = req.headers ?? {};
		const auth = h["authorization"] ?? h["Authorization"];
		if (!auth) return false;
		const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
		return !!m && m[1] === token;
	}
	emit(ev) {
		for (const l of this.listeners) l(ev);
	}
	/** Route an inbound HTTP request; returns true when handled. */
	async handle(req, body) {
		const path = (req.url ?? "").split("?")[0];
		if (req.method === "GET" && (path === "/.well-known/agent-card.json" || path === this.endpointPath + "/card")) return {
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(this.card)
		};
		if (req.method === "POST" && path === this.endpointPath) {
			if (!this.authorized(req)) return {
				status: 401,
				contentType: "application/json",
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: null,
					error: {
						code: -32001,
						message: "Unauthorized"
					}
				}),
				headers: { "WWW-Authenticate": "Bearer" }
			};
			let payload;
			try {
				payload = JSON.parse(body);
			} catch {
				return this.jsonRpcError(null, A2A_ERROR_CODES.INVALID_REQUEST, "Invalid JSON", "Parse error");
			}
			const rpc = payload;
			if (!rpc || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") return this.jsonRpcError(rpc?.id ?? null, A2A_ERROR_CODES.INVALID_REQUEST, "Invalid JSON-RPC request");
			try {
				const result = await this.dispatch(rpc);
				this.options.onInbound?.({
					method: rpc.method,
					headers: req.headers,
					source: sourceOf(req),
					taskIds: extractTaskIds(result),
					streaming: false
				});
				return {
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: rpc.id,
						result
					})
				};
			} catch (err) {
				const e = err;
				return this.jsonRpcError(rpc.id ?? null, typeof e.code === "number" ? e.code : A2A_ERROR_CODES.INTERNAL_ERROR, e.message ?? String(err), e.data);
			}
		}
		return {
			status: 404,
			contentType: "text/plain",
			body: "Not Found"
		};
	}
	async handleStream(req, body, onEvent) {
		const path = (req.url ?? "").split("?")[0];
		if (req.method !== "POST" || path !== this.endpointPath) {
			onEvent(`event: error\ndata: ${JSON.stringify({
				code: 404,
				message: "Not Found"
			})}\n\n`);
			return { status: 200 };
		}
		if (!this.authorized(req)) {
			onEvent(`event: error\ndata: ${JSON.stringify({
				code: -32001,
				message: "Unauthorized"
			})}\n\n`);
			return { status: 401 };
		}
		let payload;
		try {
			payload = JSON.parse(body);
		} catch {
			onEvent(`event: error\ndata: ${JSON.stringify({
				code: A2A_ERROR_CODES.INVALID_REQUEST,
				message: "Parse error"
			})}\n\n`);
			return { status: 200 };
		}
		const rpc = payload;
		const method = rpc?.method;
		if (method === A2A_METHODS.sendStreamingMessage || method === A2A_METHODS.subscribeToTask) {
			const taskId = method === A2A_METHODS.subscribeToTask ? rpc.params?.id : await this.ensureTask(rpc.params);
			if (!taskId) {
				onEvent(`event: error\ndata: ${JSON.stringify({
					code: A2A_ERROR_CODES.INVALID_PARAMS,
					message: "Missing message"
				})}\n\n`);
				return { status: 200 };
			}
			const task = this.store.get(taskId);
			if (!task) {
				onEvent(`event: error\ndata: ${JSON.stringify({
					code: A2A_ERROR_CODES.TASK_NOT_FOUND,
					message: `Task ${taskId} not found`
				})}\n\n`);
				return { status: 200 };
			}
			const sub = (ev) => onEvent(`data: ${JSON.stringify(ev)}\n\n`);
			this.listeners.add(sub);
			this.options.onInbound?.({
				method,
				headers: req.headers,
				source: sourceOf(req),
				taskIds: taskId ? [taskId] : [],
				streaming: true
			});
			try {
				if (method === A2A_METHODS.sendStreamingMessage) {
					const msg = rpc.params.message;
					this.runTask(task.id, task.contextId, msg);
				}
				await this.waitTerminal(task.id);
				onEvent(`data: ${JSON.stringify({ task: this.store.get(taskId) })}\n\n`);
			} finally {
				this.listeners.delete(sub);
			}
			return { status: 200 };
		}
		onEvent(`event: error\ndata: ${JSON.stringify({
			code: A2A_ERROR_CODES.METHOD_NOT_FOUND,
			message: `Unknown method ${method}`
		})}\n\n`);
		return { status: 200 };
	}
	async ensureTask(params) {
		if (!params?.message) return void 0;
		const msg = params.message;
		if (msg.taskId && this.store.get(msg.taskId)) return msg.taskId;
		return this.store.create(msg).id;
	}
	async waitTerminal(taskId) {
		for (;;) {
			const t = this.store.get(taskId);
			if (t && isTerminal(t.status.state)) return;
			await new Promise((r) => setTimeout(r, 200));
		}
	}
	/** Execute a task in the background, streaming status/artifact updates. */
	async runTask(taskId, contextId, msg) {
		this.store.setStatus(taskId, "TASK_STATE_WORKING");
		this.emit({ statusUpdate: {
			taskId,
			contextId,
			status: this.store.get(taskId).status
		} });
		const signal = new AbortController().signal;
		try {
			const reply = await this.execute({
				message: msg,
				taskId,
				contextId,
				signal
			});
			this.store.addArtifact(taskId, {
				artifactId: "result",
				parts: reply.parts,
				lastChunk: true
			});
			this.store.setStatus(taskId, "TASK_STATE_COMPLETED", reply);
			this.options.onTaskSettled?.(taskId);
			const task = this.store.get(taskId);
			this.emit({ task });
			this.emit({ artifactUpdate: {
				taskId,
				contextId,
				artifact: task.artifacts[task.artifacts.length - 1],
				lastChunk: true
			} });
		} catch (err) {
			const message = {
				messageId: crypto.randomUUID(),
				role: "ROLE_AGENT",
				parts: [{ text: `Task failed: ${err.message ?? String(err)}` }]
			};
			this.store.setStatus(taskId, "TASK_STATE_FAILED", message);
			this.options.onTaskSettled?.(taskId);
			this.emit({ statusUpdate: {
				taskId,
				contextId,
				status: this.store.get(taskId).status
			} });
		}
	}
	async dispatch(rpc) {
		const method = rpc.method;
		const params = rpc.params ?? {};
		switch (method) {
			case A2A_METHODS.sendMessage: {
				const msg = params.message;
				if (!msg?.parts?.length) throw {
					code: A2A_ERROR_CODES.INVALID_PARAMS,
					message: "Missing message"
				};
				const taskId = await this.ensureTask(params);
				const task = this.store.get(taskId);
				this.runTask(task.id, task.contextId, msg);
				await this.waitTerminal(task.id);
				return { task: this.store.get(task.id) };
			}
			case A2A_METHODS.getTask: {
				const id = params.id;
				const task = this.store.get(id);
				if (!task) throw {
					code: A2A_ERROR_CODES.TASK_NOT_FOUND,
					message: `Task ${id} not found`
				};
				return task;
			}
			case A2A_METHODS.listTasks: {
				const tasks = this.store.list();
				return {
					tasks,
					nextPageToken: "",
					pageSize: tasks.length,
					totalSize: tasks.length
				};
			}
			case A2A_METHODS.cancelTask: {
				const id = params.id;
				const task = this.store.get(id);
				if (!task) throw {
					code: A2A_ERROR_CODES.TASK_NOT_FOUND,
					message: `Task ${id} not found`
				};
				if (isTerminal(task.status.state)) throw {
					code: A2A_ERROR_CODES.TASK_CANCEL_NOT_ALLOWED,
					message: `Task ${id} already in terminal state ${task.status.state}`
				};
				this.store.setStatus(id, "TASK_STATE_CANCELED");
				this.options.onTaskSettled?.(id);
				return this.store.get(id);
			}
			case A2A_METHODS.getExtendedAgentCard: return this.card;
			default: throw {
				code: A2A_ERROR_CODES.METHOD_NOT_FOUND,
				message: `Method ${method} not supported`
			};
		}
	}
	jsonRpcError(id, code, message, data) {
		const err = {
			jsonrpc: "2.0",
			id,
			error: {
				code,
				message,
				...data !== void 0 ? { data } : {}
			}
		};
		return {
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(err)
		};
	}
};
/** Pull task ids out of a dispatch result for inbound peer tracking. */
function extractTaskIds(result) {
	if (!result || typeof result !== "object") return [];
	const r = result;
	if (typeof r.task?.id === "string") return [r.task.id];
	if (Array.isArray(r.tasks)) return r.tasks.map((t) => t.id).filter((id) => typeof id === "string");
	return [];
}
const defaultSkills = [{
	id: "coding",
	name: "Coding",
	description: "Execute coding and shell tasks inside the DSH workspace.",
	tags: ["coding", "shell"],
	inputModes: ["text/plain"],
	outputModes: ["text/plain"]
}];
/**
* Safe default executor: refuses to act, telling the caller to inject a real
* executor. Used when an `A2AServer` is constructed without an `execute`
* option, so an inbound message never triggers arbitrary action (in particular
* never a shell command) unless the operator explicitly configured one.
*/
const notConfiguredExecutor = async ({ message }) => {
	const text = message.parts.map((p) => "text" in p ? p.text : "").filter(Boolean).join("\n").slice(0, 120);
	const detail = text ? ` (prompt: ${text}…)` : "";
	return {
		messageId: crypto.randomUUID(),
		role: "ROLE_AGENT",
		parts: [{ text: `no executor configured — inject one via the \`execute\` option${detail}` }]
	};
};
/**
* Shell executor: run the incoming prompt through the system shell and
* return the captured stdout/stderr as the task artifact. Honors the
* AbortSignal (task cancellation / shutdown) by killing the child process.
*
* This is local-testing-only: arbitrary text from an inbound message becomes
* a `/bin/sh -c` command, so only use it against a trusted client. It is
* deliberately NOT the default — pass it explicitly to opt in:
*
* ```ts
* const server = new A2AServer({ ..., execute: shellExecutor }, store);
* ```
*/
const shellExecutor = async ({ message, signal }) => {
	const text = message.parts.map((p) => "text" in p ? p.text : "").filter(Boolean).join("\n");
	if (!text.trim()) return {
		messageId: crypto.randomUUID(),
		role: "ROLE_AGENT",
		parts: [{ text: "No prompt provided." }]
	};
	try {
		const { execFile } = await import("node:child_process");
		const out = await new Promise((resolve, _reject) => {
			const child = execFile("/bin/sh", ["-c", text], {
				timeout: 3e4,
				maxBuffer: 1048576,
				signal
			}, (err, stdout, stderr) => {
				if (err) {
					if (err.killed || signal?.aborted) {
						resolve(`(aborted) ${stdout}${stderr}`.trim() || "(aborted)");
						return;
					}
					resolve(`(exit ${err.code ?? "?"}) ${stdout}\n${stderr}`);
					return;
				}
				resolve(`${stdout}\n${stderr}`.trim());
			});
			signal?.addEventListener("abort", () => child.kill(), { once: true });
		});
		return {
			messageId: crypto.randomUUID(),
			role: "ROLE_AGENT",
			parts: [{ text: out || "(no output)" }]
		};
	} catch (err) {
		return {
			messageId: crypto.randomUUID(),
			role: "ROLE_AGENT",
			parts: [{ text: `Executor error: ${err.message}` }]
		};
	}
};
/**
* Backwards-compatible alias for {@link shellExecutor}. Kept for code that
* explicitly opted into the shell executor before it was renamed; the safe
* default for `A2AServer` is now {@link notConfiguredExecutor}, so using
* this alias still requires an explicit opt-in.
*/
const defaultExecutor = shellExecutor;
//#endregion
//#region src/dashboard.ts
/** Registry of live A2A connections, both directions. */
var DashboardRegistry = class {
	peers = /* @__PURE__ */ new Map();
	agents = /* @__PURE__ */ new Map();
	hooks = {};
	seq = 0;
	setHooks(hooks) {
		this.hooks = {
			...this.hooks,
			...hooks
		};
	}
	/** Record one inbound request (or stream open). Returns the peer id. */
	touchInbound(req, taskIds = []) {
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const ua = req.headers?.["user-agent"] ?? req.headers?.["User-Agent"] ?? "unknown";
		const remote = req.source;
		const label = peerLabel(ua, remote);
		const key = `${label}|${remote?.replace(/:\d+$/, "") ?? ""}`;
		let peer;
		for (const p of this.peers.values()) {
			const pHost = p.source?.replace(/:\d+$/, "") ?? "";
			if (`${p.label}|${pHost}` === key) {
				peer = p;
				break;
			}
		}
		if (!peer) {
			const id = `in-${++this.seq}`;
			peer = {
				id,
				label,
				source: remote,
				firstSeen: now,
				lastSeen: now,
				taskCount: 0,
				activeTaskIds: [],
				streaming: false
			};
			this.peers.set(id, peer);
		}
		peer.source = remote ?? peer.source;
		peer.lastSeen = now;
		if (taskIds.length) {
			peer.taskCount += taskIds.length;
			for (const t of taskIds) if (!peer.activeTaskIds.includes(t)) peer.activeTaskIds.push(t);
		}
		return peer.id;
	}
	/** Mark a task finished for a peer (drops it from the active list). */
	finishTask(peerId, taskId) {
		const peer = this.peers.get(peerId);
		if (!peer) return;
		peer.activeTaskIds = peer.activeTaskIds.filter((t) => t !== taskId);
	}
	/** Mark a peer's streaming flag. */
	setStreaming(peerId, streaming) {
		const peer = this.peers.get(peerId);
		if (peer) peer.streaming = streaming;
	}
	/** Remove an inbound peer (the "关闭" action severs tracking). */
	removePeer(id) {
		this.peers.delete(id);
	}
	/** Register or refresh an outbound agent connection. */
	upsertAgent(agent) {
		const now = (/* @__PURE__ */ new Date()).toISOString();
		let id;
		if (agent.connectionId) {
			for (const [k, v] of this.agents) if (v.connectionId === agent.connectionId) {
				id = k;
				break;
			}
		}
		if (!id) {
			id = `out-${++this.seq}`;
			this.agents.set(id, {
				...agent,
				id,
				lastSeen: now
			});
		} else {
			const existing = this.agents.get(id);
			this.agents.set(id, {
				...existing,
				...agent,
				skillCount: agent.skillCount > 0 ? agent.skillCount : existing.skillCount,
				toolCount: agent.toolCount > 0 ? agent.toolCount : existing.toolCount,
				agentName: agent.agentName ?? existing.agentName,
				skills: agent.skills ? agent.skills : existing.skills,
				state: agent.state ?? existing.state,
				id,
				lastSeen: now
			});
		}
		return id;
	}
	/** Remove an outbound agent by id or connectionId. */
	removeAgent(connectionId) {
		for (const [k, v] of this.agents) if (v.connectionId === connectionId || k === connectionId) {
			this.agents.delete(k);
			return true;
		}
		return false;
	}
	/** Update one agent's state. */
	setAgentState(connectionId, state) {
		for (const v of this.agents.values()) if (v.connectionId === connectionId) {
			v.state = state;
			v.lastSeen = (/* @__PURE__ */ new Date()).toISOString();
		}
	}
	/** Touch one agent's last activity. */
	touchAgent(connectionId) {
		for (const v of this.agents.values()) if (v.connectionId === connectionId) v.lastSeen = (/* @__PURE__ */ new Date()).toISOString();
	}
	snapshot() {
		return {
			inbound: [...this.peers.values()].map((p) => ({
				...p,
				activeTaskIds: [...p.activeTaskIds]
			})),
			outbound: [...this.agents.values()].map((a) => ({ ...a })),
			at: Date.now()
		};
	}
	async control(action, target, payload) {
		switch (action) {
			case "reconnect-agent": return this.hooks.reconnectAgent ? this.hooks.reconnectAgent(target) : {
				ok: false,
				message: "reconnect-agent is not wired"
			};
			case "close-agent": return this.hooks.closeAgent ? this.hooks.closeAgent(target) : {
				ok: false,
				message: "close-agent is not wired"
			};
			case "disable-agent": return this.hooks.disableAgent ? this.hooks.disableAgent(target) : {
				ok: false,
				message: "disable-agent is not wired (client mode not mounted)"
			};
			case "enable-agent": return this.hooks.enableAgent ? this.hooks.enableAgent(target) : {
				ok: false,
				message: "enable-agent is not wired (client mode not mounted)"
			};
			case "reconnect-peer": return this.hooks.reconnectPeer ? this.hooks.reconnectPeer(target) : {
				ok: false,
				message: "reconnect-peer is not supported"
			};
			case "close-peer": return Promise.resolve(this.closePeerLocal(target));
			case "discover-agent": {
				const url = payload?.agentCardUrl ?? target;
				if (!url) return {
					ok: false,
					message: "discover-agent requires agentCardUrl"
				};
				return this.hooks.discoverAgent ? this.hooks.discoverAgent(url) : {
					ok: false,
					message: "discover-agent is not wired"
				};
			}
			case "add-agent": {
				const name = payload?.name ?? target;
				const url = payload?.agentCardUrl;
				if (!url) return {
					ok: false,
					message: "add-agent requires agentCardUrl"
				};
				return this.hooks.addAgent ? this.hooks.addAgent(name, url) : {
					ok: false,
					message: "add-agent is not wired (client mode not mounted)"
				};
			}
			case "remove-agent": return this.hooks.removeAgent ? this.hooks.removeAgent(target) : {
				ok: false,
				message: "remove-agent is not wired (client mode not mounted)"
			};
			case "server-enable": return this.hooks.setServerEnabled ? this.hooks.setServerEnabled(true) : {
				ok: false,
				message: "server control is not wired (server mode not mounted)"
			};
			case "server-disable": return this.hooks.setServerEnabled ? this.hooks.setServerEnabled(false) : {
				ok: false,
				message: "server control is not wired (server mode not mounted)"
			};
			case "server-status": return this.hooks.serverStatus ? Promise.resolve(this.hooks.serverStatus()) : {
				ok: false,
				message: "server-status is not wired (server mode not mounted)"
			};
			default: return {
				ok: false,
				message: `unknown action ${action}`
			};
		}
	}
	closePeerLocal(id) {
		if (!this.peers.has(id)) return {
			ok: false,
			message: `peer ${id} not found`
		};
		this.removePeer(id);
		return {
			ok: true,
			message: `peer ${id} closed`
		};
	}
};
function peerLabel(ua, remote) {
	const lower = ua.toLowerCase();
	if (lower.includes("python-requests") || lower.includes("a2a-python")) return "Python A2A client";
	if (lower.includes("node")) return "Node A2A client";
	if (lower.includes("curl")) return "curl";
	if (lower.includes("mozilla")) return "Browser";
	return ua.replace(/[^A-Za-z0-9._-]/g, " ").trim().split(/\s+/).slice(0, 3).join(" ") || (remote ?? "unknown");
}
let shared;
/** Get the process-wide dashboard registry (creating it on first use). */
function getSharedRegistry() {
	if (!shared) shared = new DashboardRegistry();
	return shared;
}
//#endregion
//#region src/a2a-config.ts
/**
* dsh-a2a — persisted configuration (`a2a.json`).
*
* Runtime-editable configuration lives in a per-profile `a2a.json`, so the
* plugin's UI changes survive restarts without touching the composition
* (`cordis.patch.yml` / `package.json` stay pure entry points).
*
* File resolution order:
*   1. `process.cwd()/a2a.json`            — profile dir when launched via `dsh --profile <x>`
*   2. `~/.dsh/profiles/<cwd-basename>/a2a.json` — fallback when cwd is not the profile dir
*   3. `$DSH_HOME/a2a.json`                — last-resort global location
*
* Shape (all fields optional):
* {
*   "mode": "both",                    // client | server | both (default both)
*   "timeoutMs": 8000,                 // client global default (ms)
*   "mapSkills": true,                 // per-skill tools vs one agent-wide tool
*   "agents": [{ "name", "agentCardUrl", "bearerToken?", "timeoutMs?", "mapSkills?", "enabled?" }],
*   "server": { "baseUrl"?, "agentName"?, "agentDescription"?, "agentVersion"?,
*               "endpointPath"?, "skills"?: [{ "id","name","description"?, "tags"? }] },
*   "dashboard": true
* }
*/
const A2A_CONFIG_FILENAME = "a2a.json";
/**
* Parse `--profile <name>` (or `--profile=<name>`) from the process argv.
*
* dsh keeps its launcher flags in the process command line (`node …/dsh
* --profile a2a-test --port 3083`), so the active profile name is directly
* observable no matter which directory the process was started from. This is
* the most reliable way to locate the per-profile config — far better than
* guessing from cwd's basename.
*/
function profileNameFromArgv() {
	const argv = process.argv ?? [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--profile" && i + 1 < argv.length) {
			const v = argv[i + 1];
			if (v && !v.startsWith("-")) return v;
		} else if (a.startsWith("--profile=")) {
			const v = a.slice(10);
			if (v) return v;
		}
	}
}
/**
* Resolve the a2a.json path for the current process, without depending on
* the launch directory. The plugin must work no matter where `dsh` was
* started from (dsh does NOT chdir into the profile directory), so this
* prefers the profile named in argv (`--profile <name>`), then walks
* outward from cwd, then falls back to the profile dir that matches cwd's
* basename, then the harness home.
*
* Order:
*   0. `$DSH_HOME/profiles/<argv --profile>/a2a.json` — the active profile
*      as named on the command line (most authoritative; works from ANY cwd)
*   1. `cwd/a2a.json` — explicit when launched inside a profile dir
*   2. outward from cwd: the nearest ancestor holding `a2a.json` — covers
*      launching from e.g. a repo checkout whose parent chain includes the
*      profile, or any subdir of the profile
*   3. `$DSH_HOME/profiles/<cwd-basename>/a2a.json` — started from the
*      profile's *parent* (e.g. `~/.dsh/profiles`) or when the profile dir
*      is cwd but the file hasn't been created yet
*   4. `$DSH_HOME/a2a.json` — last-resort global location
*
* Writes always go to the *resolved* path (the one we read), so a config
* loaded from any step is saved back to the same place, never re-resolved
* to cwd.
*/
function resolveConfigPath() {
	const cwd = process.cwd();
	const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	const base = cwd.split(/[\\/]/).pop() ?? "";
	const profileName = profileNameFromArgv();
	if (profileName && profileName !== "." && profileName !== ".." && !profileName.includes("/") && !profileName.includes("\\")) {
		const argvFile = join(home, "profiles", profileName, A2A_CONFIG_FILENAME);
		if (existsSync(argvFile)) return argvFile;
	}
	const cwdFile = join(cwd, A2A_CONFIG_FILENAME);
	if (existsSync(cwdFile)) return cwdFile;
	let dir = cwd;
	for (let i = 0; i < 12; i++) {
		const up = join(dir, A2A_CONFIG_FILENAME);
		if (existsSync(up)) return up;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	const profileFile = join(home, "profiles", base, A2A_CONFIG_FILENAME);
	if (base && existsSync(profileFile)) return profileFile;
	const globalFile = join(home, A2A_CONFIG_FILENAME);
	if (existsSync(globalFile)) return globalFile;
	return cwdFile;
}
/** Read the persisted config (empty object when absent or unreadable). */
function loadConfig() {
	const path = resolveConfigPath();
	if (!existsSync(path)) return {};
	try {
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch (err) {
		console.error(`[a2a] failed to read ${path}: ${err.message}`);
		return {};
	}
}
/** Atomically write the persisted config (creates the directory when needed). */
function saveConfig(config) {
	const path = resolveConfigPath();
	try {
		const dir = dirname(path);
		mkdirSync(dir, { recursive: true });
		const tmp = `${path}.tmp`;
		writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf8");
		renameSync(tmp, path);
		return {
			ok: true,
			path
		};
	} catch (err) {
		return {
			ok: false,
			path,
			message: err.message
		};
	}
}
/**
* Merge persisted config on top of the in-composition config, so the file
* (UI-editable, survives restart) wins over static defaults.
*/
function mergePersisted(base, persisted) {
	const merged = { ...base };
	if (persisted.mode) merged.mode = persisted.mode;
	if (persisted.timeoutMs !== void 0) merged.timeoutMs = persisted.timeoutMs;
	if (persisted.mapSkills !== void 0) merged.mapSkills = persisted.mapSkills;
	if (persisted.dashboard !== void 0) merged.dashboard = persisted.dashboard;
	const pServer = persisted.server;
	if (pServer) {
		if (pServer.enabled !== void 0) merged.serverEnabled = pServer.enabled;
		if (pServer.baseUrl) merged.baseUrl = pServer.baseUrl;
		if (pServer.agentName) merged.agentName = pServer.agentName;
		if (pServer.agentDescription) merged.agentDescription = pServer.agentDescription;
		if (pServer.agentVersion) merged.agentVersion = pServer.agentVersion;
		if (pServer.endpointPath) merged.endpointPath = pServer.endpointPath;
		if (pServer.authToken !== void 0) merged.authToken = pServer.authToken;
		if (pServer.skills) merged.skills = pServer.skills;
	}
	return merged;
}
//#endregion
//#region src/index.ts
const DEFAULT_ENDPOINT = "/a2a";
const DEFAULT_API_PATH = "/a2a/api";
/** Whether the shared dashboard API route is currently registered (once per process). */
let dashboardApiRegistered = false;
const name = "a2a";
/**
* Services this plugin may read as context properties. Declared so property
* reads inside `apply` never trip Cordis's "without inject" guard. The
* mode-specific wiring runs inside `ctx.inject(...)` for the single service it
* needs, so a composition lacking the other one simply idles that half.
*/
const inject = ["webServer", "tools"];
function apply(ctx, config = {}) {
	const persisted = loadConfig();
	const mergedConfig = mergePersisted(config, persisted);
	const configPath = resolveConfigPath();
	const mode = mergedConfig.mode ?? "client";
	const logger = ctx.logger;
	const dashboard = getSharedRegistry();
	const wantsClient = mode === "client" || mode === "both";
	const serverEnabled = mergedConfig.serverEnabled === true;
	const wantsServer = mode === "server" || mode === "both" || serverEnabled;
	if (mergedConfig.dashboard !== false) ctx.inject(["webServer"], (ctx) => {
		if (dashboardApiRegistered) return;
		dashboardApiRegistered = true;
		let apiRoute;
		apiRoute = ctx.webServer.register({
			kind: "prefix",
			path: DEFAULT_API_PATH,
			handler: async (req, res) => {
				if (!trustedLoopback(req)) {
					res.writeHead(403, { "content-type": "text/plain" });
					res.end("forbidden");
					return;
				}
				if (req.method === "GET") {
					res.writeHead(200, {
						"content-type": "application/json",
						"cache-control": "no-cache"
					});
					res.end(JSON.stringify(dashboard.snapshot()));
					return;
				}
				if (req.method === "POST") {
					let payload;
					try {
						payload = JSON.parse(await readBody(req));
					} catch {
						res.writeHead(400, { "content-type": "application/json" });
						res.end(JSON.stringify({
							ok: false,
							message: "invalid JSON body"
						}));
						return;
					}
					const { action, target, ...rest } = payload ?? {};
					if (!action) {
						res.writeHead(400, { "content-type": "application/json" });
						res.end(JSON.stringify({
							ok: false,
							message: "action is required"
						}));
						return;
					}
					const result = await dashboard.control(action, target ?? "", rest);
					res.writeHead(result.ok ? 200 : 409, { "content-type": "application/json" });
					res.end(JSON.stringify(result));
					return;
				}
				res.writeHead(405, { "content-type": "text/plain" });
				res.end("Method Not Allowed");
			}
		});
		ctx.effect(() => () => {
			dashboardApiRegistered = false;
			apiRoute?.();
		}, "a2a: dashboard api cleanup");
	});
	if (wantsClient) {
		const agentName = mergedConfig.name ?? "remote";
		const initialAgents = [];
		for (const a of persisted.agents ?? []) if (a.name && a.agentCardUrl) initialAgents.push({
			name: a.name,
			agentCardUrl: a.agentCardUrl,
			configured: true,
			enabled: a.enabled !== false,
			bearerToken: a.bearerToken,
			timeoutMs: a.timeoutMs,
			mapSkills: a.mapSkills
		});
		if (mergedConfig.agentCardUrl) initialAgents.push({
			name: agentName,
			agentCardUrl: mergedConfig.agentCardUrl,
			configured: true,
			enabled: true,
			bearerToken: mergedConfig.bearerToken,
			timeoutMs: mergedConfig.timeoutMs,
			mapSkills: mergedConfig.mapSkills
		});
		ctx.inject(["tools"], (ctx) => {
			const live = /* @__PURE__ */ new Map();
			const configuredAgents = /* @__PURE__ */ new Set();
			const connect = async (name, agentCardUrl, configured = false, agentOpts = {}) => {
				let disposers = [];
				let connectionId;
				try {
					const regs = await registerAgentTools(ctx.tools, {
						name,
						agentCardUrl,
						bearerToken: agentOpts.bearerToken ?? mergedConfig.bearerToken,
						timeoutMs: agentOpts.timeoutMs ?? mergedConfig.timeoutMs,
						mapSkills: agentOpts.mapSkills ?? mergedConfig.mapSkills,
						onReady: (info) => {
							connectionId = info.connectionId;
							dashboard.upsertAgent({
								connectionId: info.connectionId,
								name,
								agentCardUrl,
								agentName: info.card.name,
								skillCount: (info.card.skills ?? []).length,
								toolCount: 0,
								state: "connected",
								configured: configured ? true : void 0,
								skills: (info.card.skills ?? []).map((s) => ({
									id: s.id,
									name: s.name,
									description: s.description,
									tags: s.tags
								}))
							});
						},
						onDispose: (cid) => {
							dashboard.removeAgent(cid);
						}
					});
					disposers = regs.map((r) => r.dispose);
					if (connectionId) {
						dashboard.upsertAgent({
							connectionId,
							name,
							agentCardUrl,
							skillCount: 0,
							toolCount: regs.length,
							state: "connected",
							configured: configured ? true : void 0
						});
						live.set(connectionId, {
							disposeAll: () => disposers.forEach((d) => d()),
							name,
							agentCardUrl,
							configured,
							enabled: true
						});
						if (configured) configuredAgents.add(connectionId);
					}
					logger?.info?.(`[a2a] registered ${regs.length} tool(s) for agent "${name}"`);
					return connectionId;
				} catch (err) {
					logger?.error?.(`[a2a] failed to register agent "${name}": ${err.message}`);
					return;
				}
			};
			const persistAgents = () => {
				const next = {
					...loadConfig(),
					agents: []
				};
				for (const a of initialAgents) if (a.configured) next.agents.push({
					name: a.name,
					agentCardUrl: a.agentCardUrl,
					bearerToken: a.bearerToken,
					timeoutMs: a.timeoutMs,
					mapSkills: a.mapSkills,
					enabled: a.enabled === false ? false : void 0
				});
				const res = saveConfig(next);
				if (!res.ok) logger?.error?.(`[a2a] failed to save ${res.path}: ${res.message}`);
			};
			const findInitial = (entry) => {
				const idx = initialAgents.findIndex((a) => a.configured && a.name === entry.name && a.agentCardUrl === entry.agentCardUrl);
				if (idx < 0) return void 0;
				return {
					idx,
					item: initialAgents[idx]
				};
			};
			dashboard.setHooks({
				closeAgent: async (connectionId) => {
					const entry = live.get(connectionId);
					if (!entry) return {
						ok: false,
						message: `connection ${connectionId} not found`
					};
					entry.disposeAll();
					live.delete(connectionId);
					dashboard.removeAgent(connectionId);
					dashboard.setAgentState(connectionId, "disconnected");
					dashboard.upsertAgent({
						connectionId,
						name: entry.name,
						agentCardUrl: entry.agentCardUrl,
						skillCount: 0,
						toolCount: 0,
						state: "disconnected",
						enabled: false,
						configured: entry.configured ? true : void 0
					});
					return {
						ok: true,
						message: `connection ${connectionId} closed`
					};
				},
				disableAgent: async (connectionId) => {
					const entry = live.get(connectionId);
					let name = entry?.name;
					let url = entry?.agentCardUrl;
					let configured = entry?.configured ?? false;
					if (!entry) {
						const snap = dashboard.snapshot().outbound.find((o) => o.connectionId === connectionId);
						if (!snap) return {
							ok: false,
							message: `connection ${connectionId} not found`
						};
						name = snap.name;
						url = snap.agentCardUrl;
						configured = snap.configured ?? false;
					}
					if (entry) {
						entry.disposeAll();
						live.delete(connectionId);
						dashboard.setAgentState(connectionId, "disconnected");
					} else dashboard.setAgentState(connectionId, "disconnected");
					const found = name !== void 0 && url !== void 0 ? findInitial({
						name,
						agentCardUrl: url
					}) : void 0;
					if (found) {
						found.item.enabled = false;
						persistAgents();
					}
					const prevSnap = dashboard.snapshot().outbound.find((o) => o.connectionId === connectionId);
					dashboard.upsertAgent({
						connectionId,
						name: name ?? "unknown",
						agentCardUrl: url ?? "",
						agentName: prevSnap?.agentName ?? name,
						skillCount: 0,
						toolCount: 0,
						state: "disconnected",
						enabled: false,
						configured: configured ? true : void 0
					});
					return {
						ok: true,
						message: `agent ${connectionId} disabled (config kept)`
					};
				},
				enableAgent: async (connectionId) => {
					const snap = dashboard.snapshot().outbound.find((o) => o.connectionId === connectionId);
					if (!snap) return {
						ok: false,
						message: `connection ${connectionId} not found`
					};
					const found = findInitial({
						name: snap.name,
						agentCardUrl: snap.agentCardUrl
					});
					if (found) {
						found.item.enabled = true;
						persistAgents();
					}
					dashboard.setAgentState(connectionId, "reconnecting");
					const newId = await connect(snap.name, snap.agentCardUrl, snap.configured ?? false);
					if (!newId) return {
						ok: false,
						message: `enable of ${connectionId} failed to connect`
					};
					dashboard.removeAgent(connectionId);
					return {
						ok: true,
						message: `agent ${connectionId} enabled and reconnected as ${newId}`
					};
				},
				reconnectAgent: async (connectionId) => {
					const existing = live.get(connectionId);
					const prevName = existing?.name ?? agentName;
					const prevUrl = existing?.agentCardUrl ?? mergedConfig.agentCardUrl;
					const wasConfigured = !!existing?.configured || configuredAgents.has(connectionId);
					if (existing) existing.disposeAll();
					live.delete(connectionId);
					dashboard.setAgentState(connectionId, "reconnecting");
					const newId = await connect(prevName, prevUrl, wasConfigured);
					if (!newId) return {
						ok: false,
						message: `reconnect of ${connectionId} failed`
					};
					dashboard.removeAgent(connectionId);
					return {
						ok: true,
						message: `connection ${connectionId} reconnected as ${newId}`
					};
				},
				addAgent: async (name, agentCardUrl) => {
					const cid = await connect(name, agentCardUrl, true);
					if (!cid) return {
						ok: false,
						message: `failed to connect to ${agentCardUrl}`
					};
					initialAgents.push({
						name,
						agentCardUrl,
						configured: true,
						enabled: true
					});
					persistAgents();
					return {
						ok: true,
						message: `agent "${name}" connected as ${cid} (saved to ${configPath})`
					};
				},
				discoverAgent: async (agentCardUrl) => {
					try {
						const card = await fetchAgentCard(agentCardUrl, {
							timeoutMs: mergedConfig.timeoutMs ?? 8e3,
							bearerToken: mergedConfig.bearerToken
						});
						const iface = pickInterface(card);
						return {
							ok: true,
							message: JSON.stringify({
								name: card.name,
								description: card.description,
								version: card.version,
								agentCardUrl,
								endpoint: iface?.url,
								skills: (card.skills ?? []).map((s) => ({
									id: s.id,
									name: s.name,
									description: s.description
								})),
								capabilities: card.capabilities,
								defaultInputModes: card.defaultInputModes,
								defaultOutputModes: card.defaultOutputModes
							})
						};
					} catch (err) {
						return {
							ok: false,
							message: `discover failed: ${err.message}`
						};
					}
				},
				removeAgent: async (connectionId) => {
					const entry = live.get(connectionId);
					let name;
					let url;
					let configured = false;
					if (entry) {
						name = entry.name;
						url = entry.agentCardUrl;
						configured = entry.configured ?? false;
						entry.disposeAll();
						live.delete(connectionId);
					} else {
						const snap = dashboard.snapshot().outbound.find((o) => o.connectionId === connectionId);
						if (!snap) return {
							ok: false,
							message: `connection ${connectionId} not found`
						};
						name = snap.name;
						url = snap.agentCardUrl;
						configured = snap.configured ?? false;
					}
					if (configured && name !== void 0 && url !== void 0) {
						const found = findInitial({
							name,
							agentCardUrl: url
						});
						if (found) {
							initialAgents.splice(found.idx, 1);
							persistAgents();
						}
					}
					dashboard.removeAgent(connectionId);
					return {
						ok: true,
						message: `agent ${connectionId} removed`
					};
				}
			});
			ctx.effect(() => {
				for (const a of initialAgents) {
					if (a.enabled === false) {
						const phId = `out-cfg-${a.name}-${a.agentCardUrl}`;
						dashboard.upsertAgent({
							connectionId: phId,
							name: a.name,
							agentCardUrl: a.agentCardUrl,
							agentName: a.name,
							skillCount: 0,
							toolCount: 0,
							state: "disconnected",
							enabled: false,
							configured: true
						});
						continue;
					}
					connect(a.name, a.agentCardUrl, a.configured, {
						bearerToken: a.bearerToken,
						timeoutMs: a.timeoutMs,
						mapSkills: a.mapSkills
					});
				}
				return () => {
					for (const { disposeAll } of live.values()) disposeAll();
					live.clear();
				};
			}, "a2a: client tools");
		});
	}
	if (wantsServer) {
		const store = new TaskStore();
		const taskPeer = /* @__PURE__ */ new Map();
		const pendingSettled = /* @__PURE__ */ new Set();
		ctx.inject(["webServer"], (ctx) => {
			ctx.effect(() => {
				const webServer = ctx.webServer;
				const baseUrl = mergedConfig.baseUrl ?? `http://${webServer.host === "0.0.0.0" ? "127.0.0.1" : webServer.host}:${webServer.port}`;
				const endpointPath = mergedConfig.endpointPath ?? DEFAULT_ENDPOINT;
				const server = new A2AServer({
					baseUrl,
					agentName: mergedConfig.agentName ?? "DSH Agent",
					agentDescription: mergedConfig.agentDescription ?? "DeepSeek Harness agent exposed over A2A v1.0",
					agentVersion: mergedConfig.agentVersion ?? "0.1.0",
					skills: mergedConfig.skills,
					endpointPath,
					execute: mergedConfig.execute,
					authToken: mergedConfig.authToken,
					onInbound: (facts) => {
						const peerId = dashboard.touchInbound({
							headers: facts.headers,
							source: facts.source
						}, facts.taskIds);
						for (const taskId of facts.taskIds) {
							taskPeer.set(taskId, peerId);
							if (pendingSettled.delete(taskId)) dashboard.finishTask(peerId, taskId);
						}
					},
					onTaskSettled: (taskId) => {
						const peerId = taskPeer.get(taskId);
						if (peerId) {
							dashboard.finishTask(peerId, taskId);
							taskPeer.delete(taskId);
						} else pendingSettled.add(taskId);
					}
				}, store);
				let enabled = true;
				let disposers = [];
				const registerRoutes = () => {
					disposers.push(webServer.register({
						kind: "exact",
						path: "/.well-known/agent-card.json",
						handler: async (_req, res) => {
							res.writeHead(200, { "content-type": "application/json" });
							res.end(JSON.stringify(server.card));
						}
					}));
					disposers.push(webServer.register({
						kind: "prefix",
						path: server.endpointPath,
						handler: async (req, res) => {
							const isStream = (req.headers.accept ?? "").includes("text/event-stream");
							if (req.method === "GET" && (req.url ?? "").startsWith(server.endpointPath + "/card")) {
								res.writeHead(200, { "content-type": "application/json" });
								res.end(JSON.stringify(server.card));
								return;
							}
							if (req.method !== "POST") {
								res.writeHead(405, { "content-type": "text/plain" });
								res.end("Method Not Allowed");
								return;
							}
							const body = await readBody(req);
							if (isStream) {
								res.writeHead(200, {
									"content-type": "text/event-stream",
									"cache-control": "no-cache",
									connection: "keep-alive"
								});
								await server.handleStream(toServerReq(req), body, (frame) => res.write(frame));
								res.end();
								return;
							}
							const out = await server.handle(toServerReq(req), body);
							res.writeHead(out.status, {
								"content-type": out.contentType,
								...out.headers ?? {}
							});
							res.end(out.body);
						}
					}));
				};
				const unregisterRoutes = () => {
					for (const d of disposers) d();
					disposers = [];
				};
				registerRoutes();
				logger?.info?.(`[a2a] A2A server mounted: AgentCard at ${baseUrl}/.well-known/agent-card.json, JSON-RPC at ${server.endpointPath}`);
				const serverCard = () => ({
					baseUrl,
					agentName: server.card.name,
					agentDescription: server.card.description,
					agentVersion: server.card.version,
					endpoint: `${baseUrl}${server.endpointPath}`,
					agentCardUrl: `${baseUrl}/.well-known/agent-card.json`,
					skills: (server.card.skills ?? []).map((s) => ({
						id: s.id,
						name: s.name,
						description: s.description
					})),
					customExecutor: Boolean(mergedConfig.execute)
				});
				dashboard.setHooks({
					setServerEnabled: async (enable) => {
						if (enable === enabled) return {
							ok: true,
							message: `server already ${enable ? "enabled" : "disabled"}`
						};
						if (enable) {
							registerRoutes();
							enabled = true;
							logger?.info?.("[a2a] A2A server enabled");
							return {
								ok: true,
								message: "A2A server enabled"
							};
						}
						unregisterRoutes();
						enabled = false;
						logger?.info?.("[a2a] A2A server disabled");
						return {
							ok: true,
							message: "A2A server disabled"
						};
					},
					serverStatus: () => ({
						ok: true,
						message: JSON.stringify({
							enabled,
							...serverCard()
						})
					})
				});
				return () => {
					unregisterRoutes();
				};
			}, "a2a: server routes");
		});
	}
}
/** Drain the request body from a Node IncomingMessage. */
async function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.once("error", reject);
	});
}
/** Loopback/same-origin trust fence for the dashboard API (no remote write). */
function trustedLoopback(req) {
	const host = req.headers.host;
	if (!host) return false;
	const hostname = host.split(":")[0];
	if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "::1") return false;
	if (req.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = req.headers.origin;
	if (!origin) return true;
	try {
		return new URL(origin).host === host;
	} catch {
		return false;
	}
}
/** Adapt a Node IncomingMessage to the A2A server's structural request type. */
function toServerReq(req) {
	const headers = {};
	for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
	else if (Array.isArray(v)) headers[k] = v.join(", ");
	return {
		method: req.method,
		url: req.url,
		headers,
		socket: req.socket ? {
			remoteAddress: req.socket.remoteAddress,
			remotePort: req.socket.remotePort
		} : void 0
	};
}
//#endregion
export { A2AClient, A2AError, A2AServer, A2A_ERROR_CODES, A2A_METHODS, DashboardRegistry, Role, TaskState, TaskStore, apply, defaultExecutor, defaultSkills, fetchAgentCard, getSharedRegistry, inject, isTerminal, name, notConfiguredExecutor, registerAgentTools, shellExecutor };
