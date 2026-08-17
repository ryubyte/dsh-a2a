/**
 * A2A (Agent2Agent) Protocol v1.0 — TypeScript type definitions.
 *
 * These types mirror the normative source of truth `specification/a2a.proto`
 * (package `lf.a2a.v1`) from https://github.com/a2aproject/A2A, v1.0.0.
 * JSON wire names are camelCase per ProtoJSON serialization; enum values use
 * SCREAMING_SNAKE_CASE as mandated by A2A v1.0.
 */
/** The lifecycle states of a Task (a2a.proto `TaskState`). */
export var TaskState;
(function (TaskState) {
    TaskState["UNSPECIFIED"] = "TASK_STATE_UNSPECIFIED";
    TaskState["SUBMITTED"] = "TASK_STATE_SUBMITTED";
    TaskState["WORKING"] = "TASK_STATE_WORKING";
    TaskState["COMPLETED"] = "TASK_STATE_COMPLETED";
    TaskState["FAILED"] = "TASK_STATE_FAILED";
    TaskState["CANCELED"] = "TASK_STATE_CANCELED";
    TaskState["INPUT_REQUIRED"] = "TASK_STATE_INPUT_REQUIRED";
    TaskState["REJECTED"] = "TASK_STATE_REJECTED";
    TaskState["AUTH_REQUIRED"] = "TASK_STATE_AUTH_REQUIRED";
})(TaskState || (TaskState = {}));
export function isTerminal(state) {
    return (state === TaskState.COMPLETED ||
        state === TaskState.FAILED ||
        state === TaskState.CANCELED ||
        state === TaskState.REJECTED);
}
/** The sender of a Message (a2a.proto `Role`). */
export var Role;
(function (Role) {
    Role["UNSPECIFIED"] = "ROLE_UNSPECIFIED";
    Role["USER"] = "ROLE_USER";
    Role["AGENT"] = "ROLE_AGENT";
})(Role || (Role = {}));
/** A2A JSON-RPC method names (v1.0 canonical PascalCase as in a2a.proto RPCs). */
export const A2A_METHODS = {
    sendMessage: 'SendMessage',
    sendStreamingMessage: 'SendStreamingMessage',
    getTask: 'GetTask',
    listTasks: 'ListTasks',
    cancelTask: 'CancelTask',
    subscribeToTask: 'SubscribeToTask',
    getExtendedAgentCard: 'GetExtendedAgentCard',
};
/** Standard error codes from the A2A JSON-RPC binding. */
export const A2A_ERROR_CODES = {
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
    VERSION_NOT_SUPPORTED: -32011,
};
