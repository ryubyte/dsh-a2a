/**
 * A2A (Agent2Agent) Protocol v1.0 — TypeScript type definitions.
 *
 * These types mirror the normative source of truth `specification/a2a.proto`
 * (package `lf.a2a.v1`) from https://github.com/a2aproject/A2A, v1.0.0.
 * JSON wire names are camelCase per ProtoJSON serialization; enum values use
 * SCREAMING_SNAKE_CASE as mandated by A2A v1.0.
 */
/** The lifecycle states of a Task (a2a.proto `TaskState`). */
export declare enum TaskState {
    UNSPECIFIED = "TASK_STATE_UNSPECIFIED",
    SUBMITTED = "TASK_STATE_SUBMITTED",
    WORKING = "TASK_STATE_WORKING",
    COMPLETED = "TASK_STATE_COMPLETED",
    FAILED = "TASK_STATE_FAILED",
    CANCELED = "TASK_STATE_CANCELED",
    INPUT_REQUIRED = "TASK_STATE_INPUT_REQUIRED",
    REJECTED = "TASK_STATE_REJECTED",
    AUTH_REQUIRED = "TASK_STATE_AUTH_REQUIRED"
}
export type TerminalTaskState = TaskState.COMPLETED | TaskState.FAILED | TaskState.CANCELED | TaskState.REJECTED;
export type InterruptedTaskState = TaskState.INPUT_REQUIRED | TaskState.AUTH_REQUIRED;
export declare function isTerminal(state: TaskState): state is TerminalTaskState;
/** The sender of a Message (a2a.proto `Role`). */
export declare enum Role {
    UNSPECIFIED = "ROLE_UNSPECIFIED",
    USER = "ROLE_USER",
    AGENT = "ROLE_AGENT"
}
/**
 * A section of communication content (a2a.proto `Part`): exactly one of
 * text / raw / url / data.
 */
export type Part = {
    text: string;
    raw?: never;
    url?: never;
    data?: never;
    mediaType?: string;
    filename?: string;
    metadata?: Record<string, unknown>;
} | {
    raw: string;
    text?: never;
    url?: never;
    data?: never;
    mediaType?: string;
    filename?: string;
    metadata?: Record<string, unknown>;
} | {
    url: string;
    text?: never;
    raw?: never;
    data?: never;
    mediaType?: string;
    filename?: string;
    metadata?: Record<string, unknown>;
} | {
    data: unknown;
    text?: never;
    raw?: never;
    url?: never;
    mediaType?: string;
    filename?: string;
    metadata?: Record<string, unknown>;
};
/** One unit of communication between client and server (a2a.proto `Message`). */
export interface Message {
    messageId: string;
    /** Required for server (ROLE_AGENT) messages. */
    contextId?: string;
    taskId?: string;
    role: Role | string;
    parts: Part[];
    metadata?: Record<string, unknown>;
    extensions?: string[];
    referenceTaskIds?: string[];
}
/** Task output (a2a.proto `Artifact`). */
export interface Artifact {
    artifactId: string;
    name?: string;
    parts: Part[];
    metadata?: Record<string, unknown>;
    /** Only present in task-artifact-update events. */
    append?: boolean;
    lastChunk?: boolean;
}
/** Status of a task (a2a.proto `TaskStatus`). */
export interface TaskStatus {
    state: TaskState | string;
    message?: Message;
    /** ISO 8601 timestamp. */
    timestamp?: string;
}
/** The core unit of action for A2A (a2a.proto `Task`). */
export interface Task {
    id: string;
    contextId?: string;
    status: TaskStatus;
    artifacts?: Artifact[];
    history?: Message[];
    metadata?: Record<string, unknown>;
}
/** Configuration for a send request (a2a.proto `SendMessageConfiguration`). */
export interface SendMessageConfiguration {
    acceptedOutputModes?: string[];
    taskPushNotificationConfig?: TaskPushNotificationConfig;
    historyLength?: number;
    returnImmediately?: boolean;
}
/** Push notification registration (a2a.proto `TaskPushNotificationConfig`). */
export interface TaskPushNotificationConfig {
    tenant?: string;
    id?: string;
    taskId?: string;
    url: string;
    token?: string;
    authentication?: AuthenticationInfo;
}
/** Authentication details for push (a2a.proto `AuthenticationInfo`). */
export interface AuthenticationInfo {
    scheme: string;
    credentials?: string;
}
/** Discriminated stream payloads (a2a.proto `StreamResponse`). */
export type StreamResponse = {
    task: Task;
    message?: never;
    statusUpdate?: never;
    artifactUpdate?: never;
} | {
    message: Message;
    task?: never;
    statusUpdate?: never;
    artifactUpdate?: never;
} | {
    statusUpdate: TaskStatusUpdateEvent;
    task?: never;
    message?: never;
    artifactUpdate?: never;
} | {
    artifactUpdate: TaskArtifactUpdateEvent;
    task?: never;
    message?: never;
    statusUpdate?: never;
};
export interface TaskStatusUpdateEvent {
    taskId: string;
    contextId: string;
    status: TaskStatus;
    metadata?: Record<string, unknown>;
}
export interface TaskArtifactUpdateEvent {
    taskId: string;
    contextId: string;
    artifact: Artifact;
    append?: boolean;
    lastChunk?: boolean;
    metadata?: Record<string, unknown>;
}
/** Response payload of SendMessage (a2a.proto `SendMessageResponse`). */
export type SendMessageResponse = {
    task: Task;
    message?: never;
} | {
    message: Message;
    task?: never;
};
/** A declaration of a protocol extension (a2a.proto `AgentExtension`). */
export interface AgentExtension {
    uri: string;
    description?: string;
    required?: boolean;
    params?: Record<string, unknown>;
}
/** Optional capabilities (a2a.proto `AgentCapabilities`). */
export interface AgentCapabilities {
    streaming?: boolean;
    pushNotifications?: boolean;
    extensions?: AgentExtension[];
    extendedAgentCard?: boolean;
}
/** A distinct capability an agent can perform (a2a.proto `AgentSkill`). */
export interface AgentSkill {
    id: string;
    name: string;
    description: string;
    tags?: string[];
    examples?: string[];
    inputModes?: string[];
    outputModes?: string[];
    securityRequirements?: SecurityRequirement[];
}
/** OAuth flows supported by an agent (v1.0: code, client-credentials, device-code). */
export interface OAuthFlows {
    authorizationCode?: AuthorizationCodeOAuthFlow;
    clientCredentials?: ClientCredentialsOAuthFlow;
    deviceCode?: DeviceCodeOAuthFlow;
}
export interface AuthorizationCodeOAuthFlow {
    authorizationUrl: string;
    tokenUrl: string;
    scopes?: Record<string, string>;
    refreshUrl?: string;
    pkceRequired?: boolean;
}
export interface ClientCredentialsOAuthFlow {
    tokenUrl: string;
    scopes?: Record<string, string>;
}
export interface DeviceCodeOAuthFlow {
    deviceAuthorizationUrl: string;
    tokenUrl: string;
    scopes?: Record<string, string>;
}
/** Security scheme (v1.0 supports apiKey, http, oauth2, openIdConnect, mutualTls). */
export type SecurityScheme = {
    type: 'apiKey';
    name: string;
    in: 'header' | 'query' | 'cookie';
    description?: string;
} | {
    type: 'http';
    scheme: 'basic' | 'bearer' | 'digest';
    bearerFormat?: string;
    description?: string;
} | {
    type: 'oauth2';
    flows: OAuthFlows;
    description?: string;
} | {
    type: 'openIdConnect';
    openIdConnectUrl: string;
    description?: string;
} | {
    type: 'mutualTls';
    description?: string;
};
export interface SecurityRequirement {
    /** Map of scheme name → required scopes. */
    schemes: Record<string, string[]>;
}
/** The provider of an agent (a2a.proto `AgentProvider`). */
export interface AgentProvider {
    url: string;
    organization: string;
}
/** JWS signature of an AgentCard (RFC 7515). */
export interface AgentCardSignature {
    protected: string;
    signature: string;
    header?: Record<string, unknown>;
}
/** A target URL + transport + protocol version (a2a.proto `AgentInterface`). */
export interface AgentInterface {
    url: string;
    protocolBinding: 'JSONRPC' | 'GRPC' | 'HTTP+JSON' | string;
    /** Opaque routing value; clients MUST echo it in requests when set. */
    tenant?: string;
    protocolVersion: string;
}
/** Self-describing agent manifest (a2a.proto `AgentCard`). */
export interface AgentCard {
    name: string;
    description: string;
    version: string;
    supportedInterfaces: AgentInterface[];
    provider?: AgentProvider;
    documentationUrl?: string;
    capabilities: AgentCapabilities;
    securitySchemes?: Record<string, SecurityScheme>;
    securityRequirements?: SecurityRequirement[];
    defaultInputModes: string[];
    defaultOutputModes: string[];
    skills?: AgentSkill[];
    signatures?: AgentCardSignature[];
    iconUrl?: string;
}
/** JSON-RPC 2.0 request/response/error envelopes used by the JSONRPC binding. */
export interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: string | number | null;
    method: string;
    params?: unknown;
}
export interface JsonRpcSuccess {
    jsonrpc: '2.0';
    id: string | number | null;
    result: unknown;
}
export interface JsonRpcError {
    jsonrpc: '2.0';
    id: string | number | null;
    error: {
        code: number;
        message: string;
        data?: unknown;
    };
}
export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;
/** A2A JSON-RPC method names (v1.0 canonical PascalCase as in a2a.proto RPCs). */
export declare const A2A_METHODS: {
    readonly sendMessage: "SendMessage";
    readonly sendStreamingMessage: "SendStreamingMessage";
    readonly getTask: "GetTask";
    readonly listTasks: "ListTasks";
    readonly cancelTask: "CancelTask";
    readonly subscribeToTask: "SubscribeToTask";
    readonly getExtendedAgentCard: "GetExtendedAgentCard";
};
/** Standard error codes from the A2A JSON-RPC binding. */
export declare const A2A_ERROR_CODES: {
    readonly INVALID_REQUEST: -32600;
    readonly METHOD_NOT_FOUND: -32601;
    readonly INVALID_PARAMS: -32602;
    readonly INTERNAL_ERROR: -32603;
    readonly TASK_NOT_FOUND: -32001;
    readonly TASK_CANCEL_NOT_ALLOWED: -32002;
    readonly TASK_ALREADY_CANCELED: -32003;
    readonly AGENT_CARD_NOT_FOUND: -32004;
    readonly AGENT_CARD_SIGNATURE_INVALID: -32005;
    readonly CONTEXT_NOT_FOUND: -32006;
    readonly AUTHENTICATION_REQUIRED: -32007;
    readonly PUSH_NOTIFICATION_CONFIG_NOT_FOUND: -32008;
    readonly EXTENSION_NOT_SUPPORTED: -32009;
    readonly UNSUPPORTED_OPERATION: -32010;
    readonly VERSION_NOT_SUPPORTED: -32011;
};
//# sourceMappingURL=protocol.d.ts.map