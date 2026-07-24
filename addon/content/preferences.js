/* Prefs pane script (loaded by PreferencePanes.register `scripts`): keeps
 * the MCP status line live and wires the copy buttons through a guarded
 * plugin-api lookup (the api may be absent while the plugin loads or after
 * it is disabled). Runs in the Zotero settings window scope. */
/* global Zotero, document, window */
(function () {
  function api() {
    return Zotero.__addonInstance__?.api?.mcp;
  }

  function byId(suffix) {
    return document.getElementById(`zotero-prefpane-__addonRef__-${suffix}`);
  }

  function refresh() {
    const label = byId("mcp-status-value");
    const mcp = api();
    if (!label || !mcp) return;
    const status = mcp.status();
    // status.message outside the error state carries advisory notes (e.g.
    // an out-of-range port pref falling back to the default)
    const note = status.message ? ` (${status.message})` : "";
    label.value =
      status.state === "running"
        ? `Running on 127.0.0.1:${status.port}${note}`
        : status.state === "error"
          ? status.message || "Error"
          : `Off${note}`;
  }

  const buttons = {
    "mcp-copy-claude-code": (mcp) => mcp.copyClaudeCodeCommand(),
    "mcp-copy-config": (mcp) => mcp.copyMcpConfig(),
    "mcp-copy-token": (mcp) => mcp.copyToken(),
  };
  for (const [suffix, action] of Object.entries(buttons)) {
    byId(suffix)?.addEventListener("command", () => {
      const mcp = api();
      if (!mcp) {
        Zotero.debug("__addonRef__: MCP api unavailable (plugin loading?)");
        return;
      }
      action(mcp);
    });
  }

  // The server module signals status changes itself (start/stop/bind
  // failure); no timing guesses. Unsubscribes on window unload — without
  // it a closed settings window's closure stays registered until the next
  // status event (or plugin shutdown). refresh() already no-ops when the
  // label is gone.
  const mcp = api();
  if (mcp) {
    const unsubscribe = mcp.onStatusChange(refresh);
    window.addEventListener("unload", unsubscribe, { once: true });
  }
  refresh();
})();
