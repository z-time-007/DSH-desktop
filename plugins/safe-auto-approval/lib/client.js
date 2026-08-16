window.__ModuleLoader__.load({
  id: "@local/dsh-safe-auto-approval",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const h = React.createElement;
    const CSS_ID = "@local/dsh-safe-auto-approval/client.css";
    const css = `
.saa-page{display:grid;gap:14px;padding:4px 2px 24px;color:var(--dsw-alias-label-primary,#edf1f7)}
.saa-hero,.saa-card{padding:16px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:14px;background:var(--dsw-alias-bg-layer-2,#171b22)}
.saa-hero{background:linear-gradient(135deg,color-mix(in srgb,#36b37e 13%,transparent),var(--dsw-alias-bg-layer-2,#171b22))}
.saa-hero h3,.saa-card h4{margin:0 0 7px}.saa-hero p,.saa-card p{margin:0;color:var(--dsw-alias-label-secondary,#aab3c3);font-size:13px;line-height:1.6}
.saa-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.saa-list{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.saa-chip{padding:4px 8px;border-radius:999px;background:rgba(54,179,126,.13);color:#71d69b;font:11px ui-monospace,Consolas,monospace}.saa-chip-manual{background:rgba(255,166,87,.13);color:#ffb66e}.saa-ok{display:inline-block;margin-top:10px;padding:3px 9px;border-radius:999px;background:rgba(54,179,126,.16);color:#71d69b;font-size:12px}.saa-error{color:var(--dsw-alias-label-error,#ff7a7a)!important}
`;
    function installCss() {
      if (typeof document === "undefined" || document.querySelector(`style[data-plugin-css="${CSS_ID}"]`)) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = "@local/dsh-safe-auto-approval";
      tag.dataset.pluginCss = CSS_ID;
      tag.textContent = css;
      document.head.appendChild(tag);
    }
    function chips(values, manual = false) {
      return h("div", { className: "saa-list" }, ...(values || []).map((value) => h("span", { key: value, className: `saa-chip ${manual ? "saa-chip-manual" : ""}` }, value)));
    }
    function SafeAutoApprovalPage() {
      const [status, setStatus] = React.useState(null);
      const [error, setError] = React.useState("");
      React.useEffect(() => {
        let active = true;
        fetch("/local-safe-auto-approval/status.json", { cache: "no-store", credentials: "same-origin" })
          .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
          .then((value) => { if (active) setStatus(value); })
          .catch((reason) => { if (active) setError(String(reason.message || reason)); });
        return () => { active = false; };
      }, []);
      if (error) return h("div", { className: "saa-page" }, h("section", { className: "saa-card" }, h("h4", null, "自动审批未连接"), h("p", { className: "saa-error" }, error)));
      if (!status) return h("div", { className: "saa-page" }, h("section", { className: "saa-card" }, h("p", null, "正在读取自动审批策略…")));
      return h("div", { className: "saa-page" },
        h("section", { className: "saa-hero" }, h("h3", null, "安全自动审批"), h("p", null, "仅自动批准固定白名单中的低风险本地工作；沙箱和人工审批通道继续保留。"), h("span", { className: "saa-ok" }, "已启用 · 白名单模式")),
        h("div", { className: "saa-grid" },
          h("section", { className: "saa-card" }, h("h4", null, "自动放行：只读"), h("p", null, "状态、列表和本地检索。"), chips(status.safeReads)),
          h("section", { className: "saa-card" }, h("h4", null, "自动放行：本地工作"), h("p", null, "仍受工作区、禁止覆盖和文件格式边界约束。"), chips(status.safeLocalWrites)),
          h("section", { className: "saa-card" }, h("h4", null, "始终人工审批或拒绝"), h("p", null, "删除、系统变更、Shell、插件及所有未知工具不会自动放行。"), chips(status.neverAutoApprove, true))),
        h("section", { className: "saa-card" }, h("h4", null, "审计"), h("p", null, `自动审批日志：workspace/${status.audit}。只记录时间和工具名，不记录工作内容。`)));
    }
    const inject = ["slots"];
    function apply(ctx) {
      installCss();
      ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
        name: "settings.plugins.tab",
        id: "safe-auto-approval",
        order: 60,
        label: "自动审批",
      }, SafeAutoApprovalPage));
    }
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
