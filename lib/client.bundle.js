window.__ModuleLoader__.load({
	id: "dsh-a2a",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
		    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
		  }) : x)(function(x) {
		    if (typeof require !== "undefined") return require.apply(this, arguments);
		    throw Error('Dynamic require of "' + x + '" is not supported');
		  });

		  // src/client/index.ts
		  var import_react = __require("react");
		  var inject = ["slots"];
		  function apply(ctx) {
		    ctx.effect(() => {
		      try {
		        const off = ctx.slots.register(
		          {
		            name: "settings.section",
		            id: "a2a",
		            order: 90,
		            label: () => "A2A \u8FDE\u63A5",
		            inject: () => ({})
		          },
		          DashboardSection
		        );
		        return () => off();
		      } catch (err) {
		        console.error("[dsh-a2a] failed to register settings section:", err);
		        return () => {
		        };
		      }
		    }, "dsh-a2a: settings section");
		  }
		  async function fetchSnapshot() {
		    const res = await fetch("/a2a/api", { headers: { accept: "application/json" } });
		    if (!res.ok) throw new Error(`GET /a2a/api \u2192 HTTP ${res.status}`);
		    return await res.json();
		  }
		  async function postControl(action, target) {
		    const res = await fetch("/a2a/api", {
		      method: "POST",
		      headers: { "content-type": "application/json" },
		      body: JSON.stringify({ action, target })
		    });
		    const body = await res.json();
		    return body;
		  }
		  function DashboardSection(props) {
		    const [snap, setSnap] = (0, import_react.useState)(null);
		    const [error, setError] = (0, import_react.useState)(null);
		    const [busy, setBusy] = (0, import_react.useState)(null);
		    const [notice, setNotice] = (0, import_react.useState)(null);
		    const refresh = async () => {
		      try {
		        setError(null);
		        setSnap(await fetchSnapshot());
		      } catch (err) {
		        setError(err instanceof Error ? err.message : String(err));
		      }
		    };
		    (0, import_react.useEffect)(() => {
		      void refresh();
		      const timer = setInterval(() => void refresh(), 3e3);
		      return () => clearInterval(timer);
		    }, []);
		    const act = async (action, target) => {
		      setBusy(`${action}:${target}`);
		      setNotice(null);
		      try {
		        const result = await postControl(action, target);
		        setNotice(`${result.ok ? "\u2713" : "\u2717"} ${result.message}`);
		      } catch (err) {
		        setNotice(`\u2717 ${err instanceof Error ? err.message : String(err)}`);
		      } finally {
		        setBusy(null);
		        await refresh();
		      }
		    };
		    const inbound = snap?.inbound ?? [];
		    const outbound = snap?.outbound ?? [];
		    return (0, import_react.createElement)(
		      "div",
		      { style: { display: "flex", flexDirection: "column", gap: 20 } },
		      (0, import_react.createElement)(
		        "div",
		        { style: { color: "var(--dsw-alias-label-secondary, #666)", fontSize: 13, lineHeight: 1.6 } },
		        "\u67E5\u770B A2A \u8FDE\u63A5\u7684\u5B9E\u65F6\u72B6\u6001\uFF1A\u8C01\u5728\u8FDE\u63A5\u672C DSH\uFF08\u5165\u7AD9\uFF09\uFF0C\u4EE5\u53CA\u672C DSH \u8FDE\u63A5\u4E86\u54EA\u4E9B\u8FDC\u7A0B Agent\uFF08\u51FA\u7AD9\uFF09\u3002\u53EF\u5BF9\u6BCF\u6761\u8FDE\u63A5\u6267\u884C\u91CD\u8FDE\u6216\u5173\u95ED\u3002"
		      ),
		      error ? (0, import_react.createElement)(
		        "div",
		        { style: { color: "var(--dsw-danger, #c62828)", fontSize: 13, background: "var(--dsw-alias-fill-l2, rgba(127,127,127,.08))", borderRadius: 8, padding: "8px 12px" } },
		        `\u52A0\u8F7D\u5931\u8D25\uFF1A${error}`
		      ) : null,
		      notice ? (0, import_react.createElement)(
		        "div",
		        { style: { color: "var(--dsw-alias-label-primary, #222)", fontSize: 13, background: "var(--dsw-alias-fill-l2, rgba(127,127,127,.08))", borderRadius: 8, padding: "8px 12px" } },
		        notice
		      ) : null,
		      sec("\u5165\u7AD9\u8FDE\u63A5\uFF08\u8C01\u5728\u8FDE\u63A5\u672C DSH\uFF09", inbound.length),
		      inbound.length === 0 ? emptyRow("\u6682\u65E0\u5165\u7AD9\u8FDE\u63A5\u3002\u5176\u4ED6 A2A \u5BA2\u6237\u7AEF\u8C03\u7528\u672C DSH \u7684 JSON-RPC \u7AEF\u70B9\u540E\u4F1A\u663E\u793A\u5728\u8FD9\u91CC\u3002") : (0, import_react.createElement)("table", tblStyle, (0, import_react.createElement)("thead", null, headRow(["\u6765\u6E90", "\u5730\u5740", "\u9996\u6B21\u8FDE\u63A5", "\u6700\u8FD1\u6D3B\u52A8", "\u4EFB\u52A1", "\u6D41", "\u64CD\u4F5C"])), (0, import_react.createElement)("tbody", null, ...inbound.map((p) => inboundRow(p, busy, act)))),
		      sec("\u51FA\u7AD9\u8FDE\u63A5\uFF08\u672C DSH \u8FDE\u63A5\u4E86\u8C01\uFF09", outbound.length),
		      outbound.length === 0 ? emptyRow("\u6682\u65E0\u51FA\u7AD9\u8FDE\u63A5\u3002\u5728 profile \u4E2D\u914D\u7F6E mode: client \u7684 dsh-a2a \u5B9E\u4F8B\u540E\u4F1A\u663E\u793A\u5728\u8FD9\u91CC\u3002") : (0, import_react.createElement)("table", tblStyle, (0, import_react.createElement)("thead", null, headRow(["Agent", "\u72B6\u6001", "\u5730\u5740", "\u6280\u80FD", "\u5DE5\u5177", "\u6700\u8FD1\u6D3B\u52A8", "\u64CD\u4F5C"])), (0, import_react.createElement)("tbody", null, ...outbound.map((a) => outboundRow(a, busy, act)))),
		      (0, import_react.createElement)(
		        "div",
		        { style: { color: "var(--dsw-alias-label-tertiary, #999)", fontSize: 12 } },
		        `\u5FEB\u7167\u65F6\u95F4 ${snap ? new Date(snap.at).toLocaleTimeString() : "\u2014"} \xB7 \u6BCF 3 \u79D2\u81EA\u52A8\u5237\u65B0`
		      )
		    );
		  }
		  function sec(title, count) {
		    return (0, import_react.createElement)(
		      "h3",
		      { style: { margin: 0, fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary, #222)", display: "flex", alignItems: "center", gap: 8 } },
		      title,
		      (0, import_react.createElement)("span", { style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary, #999)", background: "var(--dsw-alias-fill-l2, rgba(127,127,127,.1))", borderRadius: 10, padding: "1px 8px" } }, String(count))
		    );
		  }
		  function emptyRow(text) {
		    return (0, import_react.createElement)(
		      "div",
		      { style: { color: "var(--dsw-alias-label-tertiary, #999)", fontSize: 13, background: "var(--dsw-alias-fill-l2, rgba(127,127,127,.06))", borderRadius: 8, padding: "12px 14px" } },
		      text
		    );
		  }
		  var tblStyle = { borderCollapse: "collapse", width: "100%", fontSize: 13 };
		  var thStyle = { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.18))", color: "var(--dsw-alias-label-secondary, #666)", fontWeight: 600, whiteSpace: "nowrap" };
		  var tdStyle = { padding: "6px 8px", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.1))", color: "var(--dsw-alias-label-primary, #222)", verticalAlign: "top", fontSize: 12.5 };
		  function headRow(cols) {
		    return (0, import_react.createElement)("tr", null, ...cols.map((c) => (0, import_react.createElement)("th", { style: thStyle }, c)));
		  }
		  var stateColor = {
		    connected: "#2e7d32",
		    disconnected: "#9e9e9e",
		    reconnecting: "#f57c00"
		  };
		  function stateDot(state) {
		    return (0, import_react.createElement)("span", { style: { display: "inline-block", width: 8, height: 8, borderRadius: 4, marginRight: 6, background: stateColor[state] ?? "#9e9e9e" } });
		  }
		  function actionBtn(label, primary, onClick, disabled) {
		    return (0, import_react.createElement)(
		      "button",
		      {
		        onClick,
		        disabled,
		        style: {
		          marginRight: 6,
		          padding: "3px 10px",
		          fontSize: 12,
		          lineHeight: "18px",
		          borderRadius: 6,
		          border: `1px solid ${primary ? "var(--dsw-brand, #4a7dff)" : "var(--dsw-alias-border-l2, rgba(127,127,127,.3))"}`,
		          background: primary ? "var(--dsw-brand, #4a7dff)" : "transparent",
		          color: primary ? "#fff" : "var(--dsw-alias-label-primary, #222)",
		          cursor: disabled ? "default" : "pointer",
		          opacity: disabled ? 0.5 : 1
		        }
		      },
		      label
		    );
		  }
		  function inboundRow(p, busy, act) {
		    return (0, import_react.createElement)(
		      "tr",
		      { key: p.id },
		      (0, import_react.createElement)("td", { style: tdStyle }, p.label),
		      (0, import_react.createElement)("td", { style: { ...tdStyle, fontFamily: "monospace", fontSize: 12 } }, p.source ?? "\u2014"),
		      (0, import_react.createElement)("td", { style: tdStyle }, new Date(p.firstSeen).toLocaleTimeString()),
		      (0, import_react.createElement)("td", { style: tdStyle }, new Date(p.lastSeen).toLocaleTimeString()),
		      (0, import_react.createElement)("td", { style: tdStyle }, String(p.taskCount)),
		      (0, import_react.createElement)("td", { style: tdStyle }, p.streaming ? "\u25CF \u6D41" : "\u2014"),
		      (0, import_react.createElement)(
		        "td",
		        { style: tdStyle },
		        actionBtn("\u5173\u95ED", false, () => void act("close-peer", p.id), busy === `close-peer:${p.id}`)
		      )
		    );
		  }
		  function outboundRow(a, busy, act) {
		    const target = a.connectionId ?? a.id;
		    return (0, import_react.createElement)(
		      "tr",
		      { key: a.id },
		      (0, import_react.createElement)("td", { style: tdStyle }, a.agentName ?? a.name),
		      (0, import_react.createElement)("td", { style: tdStyle }, stateDot(a.state), a.state),
		      (0, import_react.createElement)("td", { style: { ...tdStyle, fontFamily: "monospace", fontSize: 12, wordBreak: "break-all" } }, a.agentCardUrl),
		      (0, import_react.createElement)("td", { style: tdStyle }, String(a.skillCount)),
		      (0, import_react.createElement)("td", { style: tdStyle }, String(a.toolCount)),
		      (0, import_react.createElement)("td", { style: tdStyle }, new Date(a.lastSeen).toLocaleTimeString()),
		      (0, import_react.createElement)(
		        "td",
		        { style: tdStyle },
		        actionBtn("\u91CD\u8FDE", true, () => void act("reconnect-agent", target), busy === `reconnect-agent:${target}`),
		        actionBtn("\u5173\u95ED", false, () => void act("close-agent", target), busy === `close-agent:${target}`)
		      )
		    );
		  }
		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
