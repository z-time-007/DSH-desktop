/**
 * @local/dsh-office-docs client patch: an upload button in the chat composer
 * tool row (slot `conversation.input.left`). Selecting a Word / PPT / Excel
 * (or txt/md/csv/pdf) file POSTs it to the loopback-only upload endpoint and
 * inserts a workspace-relative reference into the composer draft, ready for
 * the `office_read` tool to process.
 */

window.__ModuleLoader__.load({
  id: "@local/dsh-office-docs",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const h = React.createElement;
    const CSS_ID = "@local/dsh-office-docs/client.css";

    const ACCEPT = ".docx,.pptx,.xlsx,.doc,.ppt,.xls,.txt,.md,.csv,.pdf";

    const css = `
.dod-upload-btn{display:inline-grid;place-items:center;width:30px;height:30px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#aab3c3);cursor:pointer;transition:color .15s ease,background .15s ease,border-color .15s ease}
.dod-upload-btn:hover{color:var(--dsw-alias-brand-primary,#4da3ff);background:rgba(255,255,255,.06)}
.dod-upload-btn:disabled{opacity:.55;cursor:wait}
.dod-upload-btn:focus-visible{outline:2px solid rgba(125,211,252,.9);outline-offset:1px}
.dod-upload-btn svg{width:17px;height:17px;display:block}
.dod-upload-error{position:fixed;left:50%;bottom:86px;transform:translateX(-50%);z-index:60;max-width:min(480px,calc(100vw - 32px));padding:9px 13px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:10px;background:rgba(20,23,30,.95);color:var(--dsw-alias-label-error,#ff7a7a);font-size:12px;line-height:1.5;box-shadow:0 10px 28px rgba(0,0,0,.3)}
`;

    function installCss() {
      if (typeof document === "undefined" || document.querySelector(`style[data-plugin-css="${CSS_ID}"]`)) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = "@local/dsh-office-docs";
      tag.dataset.pluginCss = CSS_ID;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    const PaperclipIcon = () => h("svg", {
      viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg",
      "aria-hidden": true,
    },
      h("path", {
        d: "M9.5 3.5 5 8a2 2 0 0 0 2.83 2.83l4.5-4.5a3.5 3.5 0 0 0-4.95-4.95L3.1 5.66a5 5 0 0 0 7.07 7.07l3.9-3.9",
        stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round",
      }));

    function UploadButton({ useInput, inputActions }) {
      const inputRef = React.useRef(null);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState("");
      const draft = typeof useInput === "function" ? useInput((state) => state.draft) : "";

      const onPick = React.useCallback(async (event) => {
        const file = event.target.files && event.target.files[0];
        event.target.value = "";
        if (!file) return;
        setBusy(true);
        setError("");
        try {
          const response = await fetch("/dsh-office-docs/upload", {
            method: "POST",
            cache: "no-store",
            credentials: "same-origin",
            headers: {
              "x-file-name": encodeURIComponent(file.name),
              "content-type": "application/octet-stream",
            },
            body: file,
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
          const marker = `【已上传：${payload.file.relativePath}】`;
          const next = draft && String(draft).trim() !== "" ? `${draft}\n${marker}` : marker;
          if (typeof inputActions === "object" && typeof inputActions.setDraft === "function") inputActions.setDraft(next);
        } catch (reason) {
          setError(String(reason && reason.message ? reason.message : reason));
        } finally {
          setBusy(false);
        }
      }, [draft, inputActions]);

      React.useEffect(() => {
        if (!error) return undefined;
        const timer = setTimeout(() => setError(""), 6000);
        return () => clearTimeout(timer);
      }, [error]);

      return h(React.Fragment, null,
        h("button", {
          type: "button",
          className: "dod-upload-btn",
          title: "上传文件（Word / PPT / Excel）",
          "aria-label": "上传文件",
          disabled: busy,
          onClick: () => { if (inputRef.current) inputRef.current.click(); },
        }, busy ? h("span", null, "…") : h(PaperclipIcon)),
        h("input", {
          ref: inputRef,
          type: "file",
          accept: ACCEPT,
          multiple: false,
          style: { display: "none" },
          onChange: onPick,
        }),
        error ? h("div", { className: "dod-upload-error", role: "alert" }, error) : null);
    }

    const inject = ["slots"];
    function apply(ctx) {
      installCss();
      ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
        name: "conversation.input.left",
        id: "office-docs-upload",
        order: 500,
        label: "上传文件",
      }, UploadButton));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
