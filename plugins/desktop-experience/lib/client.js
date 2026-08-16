window.__ModuleLoader__.load({
  id: "@local/dsh-desktop-experience",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const h = React.createElement;
    const BASE = "/local-desktop-experience";
    const CSS_ID = "@local/dsh-desktop-experience/client.css";
    const NATIVE_PET_MODE = Boolean(window.location && new URLSearchParams(window.location.search || "").get("dshNativePet") === "1");
    const DEFAULTS = {
      dockVisible: true,
      petVisible: false,
      petSize: 112,
      petPosition: "bottom-right",
      petX: 0.86,
      petY: 0.82,
      petRefreshSeconds: 60,
      wallpaperEnabled: false,
      wallpaperOpacity: 0.14,
      inputOpacity: 100,
      sidebarOpacity: 100,
      wallpaperFit: "cover",
      wallpaperAsset: null,
      wallpaperPoster: null,
      wallpaperAnimated: false,
    };

    const css = `
.dxe-wallpaper{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;background:var(--dsw-alias-bg-layer-1,#0f1115)}
.dxe-wallpaper img{width:100%;height:100%;display:block;object-fit:cover}
.dxe-wallpaper-glass{position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,.30),rgba(255,255,255,.06) 40%,rgba(255,255,255,.18));backdrop-filter:blur(20px) saturate(140%) brightness(1.04)}
html.dxe-glass-input .uV2eYG_card{background:color-mix(in srgb,var(--dsw-specific-input-major,#ffffff) var(--dxe-input-alpha,100%),transparent)!important}
html.dxe-glass-sidebar .pI_x6G_sidebarCol{background:color-mix(in srgb,var(--dsw-specific-input-major,#ffffff) var(--dxe-sidebar-alpha,100%),transparent)!important}
html.dxe-glass-sidebar .hHd-Xa_root{background:color-mix(in srgb,var(--dsw-specific-input-major,#ffffff) var(--dxe-sidebar-alpha,100%),transparent)!important}
.dxe-dock{position:fixed;z-index:30;top:5px;left:50%;transform:translateX(-50%);display:flex;gap:3px;align-items:center;padding:4px 6px;border:1px solid rgba(255,255,255,.11);border-radius:12px;background:rgba(15,17,21,.94);box-shadow:0 8px 28px rgba(3,7,18,.28),inset 0 1px rgba(255,255,255,.05);backdrop-filter:blur(22px) saturate(145%);pointer-events:auto;isolation:isolate;transition:opacity .22s ease,transform .22s ease}
.dxe-dock-hidden{opacity:0;pointer-events:none;transform:translate(-50%,-12px)}
html.dsh-desktop-reserved .dxe-dock{top:50px}
.dxe-dock button,.dxe-btn,.dxe-upload{box-sizing:border-box;font:inherit;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));color:var(--dsw-alias-label-primary,#edf1f7);background:var(--dsw-alias-bg-layer-3,rgba(25,30,39,.88));border-radius:9px;padding:8px 12px;cursor:pointer;transition:transform .15s ease,border-color .15s ease,background .15s ease}
.dxe-dock button{display:flex;align-items:center;justify-content:center;gap:7px;min-width:78px;height:34px;border-color:transparent;background:transparent;padding:0 11px;color:rgba(247,249,252,.94);border-radius:8px;font-size:12px;line-height:1;white-space:nowrap}
.dxe-dock button>i{font-style:normal;font-size:14px;line-height:1}.dxe-dock button>span{display:inline;font-weight:500;letter-spacing:.02em}
.dxe-dock-divider{width:1px;height:22px;margin:0 5px;background:linear-gradient(transparent,rgba(255,255,255,.24),transparent);pointer-events:none}
.dxe-dock button:hover,.dxe-btn:hover,.dxe-upload:hover{transform:translateY(-1px);border-color:var(--dsw-alias-brand-primary,#4da3ff)}
.dxe-dock button:hover{transform:none;border-color:transparent;background:rgba(255,255,255,.1);color:#fff}
.dxe-dock button:focus-visible,.dxe-btn:focus-visible,.dxe-upload:focus-within{outline:2px solid rgba(125,211,252,.9);outline-offset:1px}
.dxe-btn:disabled{opacity:.55;cursor:wait;transform:none}.dxe-btn-danger{color:var(--dsw-alias-label-error,#ff7a7a)}
.dxe-upload{display:inline-flex;align-items:center;gap:7px}.dxe-upload input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.dxe-pet{position:fixed;z-index:40;pointer-events:auto;display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 10px 18px rgba(0,0,0,.42));touch-action:none;cursor:grab;will-change:left,top}
.dxe-pet-dragging{cursor:grabbing}.dxe-pet img{display:block;width:100%;height:100%;object-fit:contain;pointer-events:none;animation:dxe-bob 4.2s ease-in-out infinite;user-select:none;-webkit-user-drag:none}
.dxe-bubble{position:absolute;box-sizing:border-box;width:340px;min-width:0;max-width:340px;bottom:88%;padding:14px;border:1px solid rgba(255,255,255,.18);border-radius:20px;background:linear-gradient(145deg,rgba(15,19,28,.94),rgba(26,32,45,.9));box-shadow:0 18px 48px rgba(0,0,0,.4),inset 0 1px rgba(255,255,255,.07);backdrop-filter:blur(22px) saturate(145%);color:#edf3fb;font-size:12px;line-height:1.45;white-space:normal;cursor:default}
.dxe-balance-head{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;padding-bottom:11px;border-bottom:1px solid rgba(255,255,255,.1)}.dxe-balance-head span{display:block;color:#92a0b5;font-size:10px;letter-spacing:.16em}.dxe-balance-head strong{display:block;margin-top:3px;font-size:23px;line-height:1.1;background:linear-gradient(120deg,#7dd3fc,#a78bfa);-webkit-background-clip:text;background-clip:text;color:transparent;font-variant-numeric:tabular-nums}.dxe-balance-head small{color:#8b96a8;white-space:normal;min-width:0}
.dxe-token-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:11px}.dxe-token-stat{min-width:0;padding:8px 9px;border:1px solid rgba(255,255,255,.08);border-radius:11px;background:rgba(255,255,255,.045)}.dxe-token-stat span{display:block;color:#8f9aad;font-size:10px;white-space:normal}.dxe-token-stat strong{display:block;margin-top:2px;overflow:hidden;text-overflow:ellipsis;color:#f3f6fb;font-size:14px;font-variant-numeric:tabular-nums}
.dxe-cache{margin-top:10px}.dxe-cache-row{display:flex;justify-content:space-between;color:#aeb8c7}.dxe-cache-row strong{color:#7dd3fc;font-variant-numeric:tabular-nums}.dxe-cache-track{height:5px;margin-top:6px;overflow:hidden;border-radius:99px;background:rgba(255,255,255,.09)}.dxe-cache-track span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#38bdf8,#8b5cf6)}
@keyframes dxe-bob{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-8px) rotate(-1.5deg)}}
html.dxe-native-pet-mode,html.dxe-native-pet-mode body{width:100%!important;height:100%!important;margin:0!important;padding:0!important;overflow:hidden!important;background:transparent!important}
html.dxe-native-pet-mode #root{width:100%!important;height:100%!important;background:transparent!important}
html.dxe-native-pet-mode #root *{visibility:hidden!important}
html.dxe-native-pet-mode #root .dxe-pet,html.dxe-native-pet-mode #root .dxe-pet *{visibility:visible!important}
html.dxe-native-pet-mode .dxe-pet{left:50%!important;right:auto!important;top:50%!important;bottom:auto!important;transform:translate(-50%,-50%)!important}
.dxe-page{display:grid;gap:16px;min-width:0;padding:4px 2px 24px;color:var(--dsw-alias-label-primary,#edf1f7)}
.dxe-hero{min-width:0;padding:18px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:16px;background:linear-gradient(135deg,color-mix(in srgb,var(--dsw-alias-brand-primary,#4da3ff) 14%,transparent),var(--dsw-alias-bg-layer-2,#171b22))}
.dxe-hero h3,.dxe-card h4{margin:0 0 7px}.dxe-hero p,.dxe-card p{margin:0;color:var(--dsw-alias-label-secondary,#aab3c3);font-size:13px;line-height:1.6}
.dxe-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr));gap:12px;min-width:0}.dxe-page-single .dxe-grid{grid-template-columns:minmax(0,1fr)}
.dxe-card{box-sizing:border-box;min-width:0;overflow:hidden;padding:16px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:14px;background:var(--dsw-alias-bg-layer-2,#171b22)}
.dxe-status{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1));font-size:13px}.dxe-status:last-child{border-bottom:0}
.dxe-badge{flex:0 0 auto;padding:2px 8px;border-radius:999px;font-size:11px;background:rgba(72,187,120,.14);color:#71d69b}.dxe-badge-off{background:rgba(255,166,87,.14);color:#ffb66e}
.dxe-field{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);align-items:center;gap:14px;min-width:0;padding:11px 0;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1));font-size:13px}.dxe-field:last-child{border-bottom:0}.dxe-field>*{box-sizing:border-box;min-width:0;max-width:100%}
.dxe-field label{color:var(--dsw-alias-label-secondary,#aab3c3)}.dxe-field input[type=range]{width:100%;accent-color:var(--dsw-alias-brand-primary,#4da3ff)}
.dxe-field select{width:100%;font:inherit;color:var(--dsw-alias-label-primary,#edf1f7);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));background:var(--dsw-alias-bg-layer-3,#202631);border-radius:8px;padding:8px 9px}
.dxe-switch{box-sizing:border-box;justify-self:end;flex:0 0 auto;width:46px;height:25px;border:0;border-radius:99px;background:#5d6675;padding:3px;cursor:pointer}.dxe-switch span{display:block;width:19px;height:19px;border-radius:50%;background:white;transition:transform .16s ease}.dxe-switch-on{background:var(--dsw-alias-brand-primary,#4da3ff)}.dxe-switch-on span{transform:translateX(21px)}
.dxe-inbox{display:grid;gap:8px;margin-top:12px}.dxe-inbox-row{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0;padding:9px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:9px;font-size:12px}.dxe-inbox-row span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dxe-path{margin-top:10px;padding:9px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-3,#202631);font-family:ui-monospace,Consolas,monospace;font-size:11px;word-break:break-all;color:var(--dsw-alias-label-secondary,#aab3c3)}
.dxe-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.dxe-message{margin-top:10px!important;color:var(--dsw-alias-brand-primary,#7dd3fc)!important}.dxe-error{color:var(--dsw-alias-label-error,#ff7a7a)!important}
@media(max-width:860px){.dxe-grid{grid-template-columns:1fr}}
@media(max-width:620px){.dxe-dock button{min-width:34px;width:34px;padding:0}.dxe-dock button>span{display:none}.dxe-dock-divider{margin:0 2px}.dxe-field{grid-template-columns:1fr;gap:8px}.dxe-switch{justify-self:start}.dxe-token-grid{grid-template-columns:1fr 1fr}}
@media(prefers-reduced-motion:reduce){.dxe-pet img{animation:none}.dxe-dock button,.dxe-btn,.dxe-upload{transition:none}}
`;

    function installCss() {
      if (typeof document === "undefined" || document.querySelector(`style[data-plugin-css="${CSS_ID}"]`)) return;
      if (NATIVE_PET_MODE) document.documentElement.classList.add("dxe-native-pet-mode");
      const tag = document.createElement("style");
      tag.dataset.plugin = "@local/dsh-desktop-experience";
      tag.dataset.pluginCss = CSS_ID;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    let configSnapshot = { ...DEFAULTS };
    const configListeners = new Set();
    let petDragActive = false; // true while a native pet drag is in progress
    function publishConfig(value) {
      configSnapshot = { ...DEFAULTS, ...(value || {}) };
      for (const listener of configListeners) listener(configSnapshot);
    }
    // Direct inline fallback: set the background straight on the target
    // elements so the opacity sliders keep working even if the cascade or
    // theme overrides the stylesheet rule above.
    const GLASS_INLINE = [
      [".uV2eYG_card", "inputOpacity"],
      [".pI_x6G_sidebarCol", "sidebarOpacity"],
      [".hHd-Xa_root", "sidebarOpacity"],
    ];
    function applyGlassInline(config) {
      if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return;
      for (const [selector, key] of GLASS_INLINE) {
        const opacity = Number(config && config[key]);
        const alpha = Number.isFinite(opacity) ? Math.max(0, Math.min(100, Math.round(opacity))) : null;
        document.querySelectorAll(selector).forEach((el) => {
          if (alpha === null) el.style.removeProperty("background");
          else el.style.setProperty("background", `color-mix(in srgb, var(--dsw-specific-input-major,#ffffff) ${alpha}%,transparent)`, "important");
        });
      }
    }
    function startGlassObserver() {
      if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
      const observer = new MutationObserver(() => applyGlassInline(configSnapshot));
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    async function jsonRequest(url, options) {
      const response = await fetch(url, { cache: "no-store", credentials: "same-origin", ...options });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
      return payload;
    }
    async function refreshConfig() {
      const payload = await jsonRequest(`${BASE}/config.json`);
      publishConfig(payload.config);
      return payload;
    }
    async function patchConfig(patch) {
      const payload = await jsonRequest(`${BASE}/config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      publishConfig(payload.config);
      return payload.config;
    }
    function useConfig(pollMs = 15000) {
      const [config, setConfig] = React.useState(configSnapshot);
      React.useEffect(() => {
        const listener = (next) => setConfig(next);
        configListeners.add(listener);
        refreshConfig().catch(() => {});
        const timer = setInterval(() => refreshConfig().catch(() => {}), pollMs);
        return () => { configListeners.delete(listener); clearInterval(timer); };
      }, [pollMs]);
      return config;
    }
    function useReducedMotion() {
      const [reduced, setReduced] = React.useState(false);
      React.useEffect(() => {
        const media = window.matchMedia("(prefers-reduced-motion: reduce)");
        const update = () => setReduced(media.matches);
        update(); media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
      }, []);
      return reduced;
    }
    function formatTokens(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return "—";
      if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
      if (number >= 1000) return `${(number / 1000).toFixed(1)}k`;
      return String(Math.round(number));
    }
    function formatMoney(value, currency = "CNY") {
      const number = Number(value);
      const symbol = currency === "CNY" ? "¥" : currency === "USD" ? "$" : `${currency || ""} `;
      return `${symbol}${Number.isFinite(number) ? number.toFixed(2) : "—"}`;
    }
    function balanceDetails(balance) {
      if (!balance || balance.ok !== true || !balance.data) return { value: "不可用", granted: "—", toppedUp: "—", state: "余额服务未连接" };
      if (balance.data.available === false) return { value: "不可用", granted: "—", toppedUp: "—", state: "账户余额暂不可用" };
      const infos = Array.isArray(balance.data.infos) ? balance.data.infos : [];
      const info = infos.find((item) => item.currency === "CNY") || infos[0];
      if (!info) return { value: "¥0.00", granted: "¥0.00", toppedUp: "¥0.00", state: "当前账户" };
      return {
        value: formatMoney(info.total, info.currency),
        granted: formatMoney(info.granted, info.currency),
        toppedUp: formatMoney(info.toppedUp, info.currency),
        state: `${info.currency || "余额"} · 充值 ${formatMoney(info.toppedUp, info.currency)} · 赠送 ${formatMoney(info.granted, info.currency)}`,
      };
    }
    function tokenDetails(petData) {
      const summary = petData && petData.summary ? petData.summary : {};
      const input = Number(summary.input || 0);
      const output = Number(summary.output || 0);
      const cacheRead = Number(summary.cacheRead || 0);
      const cacheWrite = Number(summary.cacheWrite || 0);
      const total = Number(summary.total || input + output + cacheRead + cacheWrite);
      const eligible = input + cacheRead;
      const hitRate = eligible > 0 ? Math.min(100, Math.max(0, (cacheRead / eligible) * 100)) : 0;
      return { input, output, cacheRead, cacheWrite, total, hitRate };
    }

    function WallpaperOverlay() {
      const config = useConfig();
      const reduced = useReducedMotion();
      if (!config.wallpaperEnabled || !config.wallpaperAsset) return null;
      const source = reduced && config.wallpaperPoster ? `${BASE}/wallpaper/poster.png` : `${BASE}/wallpaper/current.webp`;
      const blur = Number(config.wallpaperBlur || 0);
      const glass = (Number(config.wallpaperGlass || 0)) / 100;
      const filter = `saturate(.92) contrast(.96)${blur > 0 ? ` blur(${blur}px)` : ""}`;
      return h("div", { className: "dxe-wallpaper", style: { opacity: config.wallpaperOpacity } },
        h("img", { src: source, alt: "", draggable: false, style: { objectFit: config.wallpaperFit, filter } }),
        glass > 0 ? h("div", { className: "dxe-wallpaper-glass", style: { opacity: glass } }) : null);
    }

    function PetOverlay() {
      const config = useConfig();
      const [open, setOpen] = React.useState(false);
      const [petData, setPetData] = React.useState(null);
      const [dragging, setDragging] = React.useState(false);
      const [livePosition, setLivePosition] = React.useState(null);
      const drag = React.useRef(null);
      React.useEffect(() => {
        if (!NATIVE_PET_MODE && !config.petVisible) return undefined;
        let active = true;
        const load = () => jsonRequest("/dsh-token-pet/data.json").then((value) => { if (active) setPetData(value); }).catch(() => { if (active) setPetData(null); });
        load();
        const timer = setInterval(load, Math.max(30, config.petRefreshSeconds) * 1000);
        const unsubscribe = NATIVE_PET_MODE && window.dshDesktop && window.dshDesktop.pet && typeof window.dshDesktop.pet.onRefresh === "function"
          ? window.dshDesktop.pet.onRefresh(load)
          : null;
        return () => { active = false; clearInterval(timer); if (typeof unsubscribe === "function") unsubscribe(); };
      }, [config.petVisible, config.petRefreshSeconds]);
      React.useEffect(() => {
        if (!NATIVE_PET_MODE || !window.dshDesktop || !window.dshDesktop.pet || typeof window.dshDesktop.pet.pointerInteractive !== "function") return undefined;
        let last = null;
        const setInteractive = (value) => {
          const next = Boolean(value);
          if (next === last) return;
          last = next;
          window.dshDesktop.pet.pointerInteractive(next);
        };
        const updatePointerRegion = (event) => {
          if (petDragActive) { setInteractive(true); return; }
          const target = document.elementFromPoint(event.clientX, event.clientY);
          setInteractive(Boolean(target && target.closest && target.closest(".dxe-pet")));
        };
        const leaveWindow = () => setInteractive(false);
        setInteractive(false);
        document.addEventListener("mousemove", updatePointerRegion, true);
        document.addEventListener("mouseleave", leaveWindow, true);
        return () => {
          document.removeEventListener("mousemove", updatePointerRegion, true);
          document.removeEventListener("mouseleave", leaveWindow, true);
          window.dshDesktop.pet.pointerInteractive(false);
        };
      }, []);
      if (!NATIVE_PET_MODE && !config.petVisible) return null;
      const size = config.petSize;
      const bounds = () => ({ minX: 18, minY: 54, maxX: Math.max(18, window.innerWidth - size - 18), maxY: Math.max(54, window.innerHeight - size - 18) });
      const position = { width: size, height: size };
      if (NATIVE_PET_MODE) {
        position.left = "50%"; position.bottom = 18;
      } else if (livePosition) {
        position.left = livePosition.left; position.top = livePosition.top;
      } else if (config.petPosition === "free") {
        const area = bounds();
        position.left = area.minX + (area.maxX - area.minX) * config.petX;
        position.top = area.minY + (area.maxY - area.minY) * config.petY;
      } else {
        if (config.petPosition.includes("bottom")) position.bottom = 18; else position.top = 54;
        if (config.petPosition.includes("right")) position.right = 18; else position.left = 18;
      }
      let bubbleStyle;
      if (NATIVE_PET_MODE) {
        // The whale is centered in its transparent window and the window may
        // extend off-screen. Keep the bubble on screen: center it over the whale
        // (clamped horizontally) and flip it below the whale in the top half.
        const screenW = window.screen.availWidth || window.screen.width || window.innerWidth
        const screenH = window.screen.availHeight || window.screen.height || window.innerHeight
        const whaleCenterScreenY = window.screenY + window.innerHeight / 2
        const whaleCenterScreenX = window.screenX + window.innerWidth / 2
        const bubbleW = 340
        const minCenter = bubbleW / 2 + 8
        const maxCenter = screenW - bubbleW / 2 - 8
        const centerX = Math.min(maxCenter, Math.max(minCenter, whaleCenterScreenX))
        const deltaX = centerX - whaleCenterScreenX
        bubbleStyle = { left: `${size / 2 + deltaX}px`, transform: "translateX(-50%)" }
        if (whaleCenterScreenY < screenH / 2) {
          bubbleStyle.top = "92%"; bubbleStyle.bottom = "auto"
        } else {
          bubbleStyle.bottom = "88%"; bubbleStyle.top = "auto"
        }
      } else {
        const resolvedLeft = Number.isFinite(position.left) ? position.left : Math.max(18, window.innerWidth - size - Number(position.right || 18));
        const resolvedTop = Number.isFinite(position.top) ? position.top : Math.max(54, window.innerHeight - size - Number(position.bottom || 18));
        bubbleStyle = resolvedTop < 270 ? { top: "88%", bottom: "auto" } : {};
        if (resolvedLeft < 180) Object.assign(bubbleStyle, { left: 0 });
        else if (resolvedLeft + size > window.innerWidth - 180) Object.assign(bubbleStyle, { right: 0 });
        else Object.assign(bubbleStyle, { left: "50%", transform: "translateX(-50%)" });
      }
      const details = balanceDetails(petData && petData.balance);
      const tokens = tokenDetails(petData);
      const pointerDown = (event) => {
        if (event.button !== 0) return;
        if (NATIVE_PET_MODE && window.dshDesktop && window.dshDesktop.pet) {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { pointerId: event.pointerId, startX: event.screenX, startY: event.screenY, moved: false };
          window.dshDesktop.pet.dragStart(size);
          if (typeof window.dshDesktop.pet.pointerInteractive === "function") window.dshDesktop.pet.pointerInteractive(true);
          petDragActive = true;
          setDragging(true);
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, currentLeft: rect.left, currentTop: rect.top, moved: false };
        setLivePosition({ left: rect.left, top: rect.top }); setDragging(true);
      };
      const pointerMove = (event) => {
        const state = drag.current;
        if (!state || state.pointerId !== event.pointerId) return;
        if (NATIVE_PET_MODE) {
          if (Math.hypot(event.screenX - state.startX, event.screenY - state.startY) > 4) state.moved = true;
          if (state.moved) window.dshDesktop.pet.dragMove();
          return;
        }
        const area = bounds();
        const dx = event.clientX - state.startX; const dy = event.clientY - state.startY;
        if (Math.hypot(dx, dy) > 4) state.moved = true;
        state.currentLeft = Math.min(area.maxX, Math.max(area.minX, state.left + dx));
        state.currentTop = Math.min(area.maxY, Math.max(area.minY, state.top + dy));
        setLivePosition({ left: state.currentLeft, top: state.currentTop });
      };
      const pointerUp = (event) => {
        const state = drag.current;
        if (!state || state.pointerId !== event.pointerId) return;
        if (NATIVE_PET_MODE) {
          window.dshDesktop.pet.dragEnd();
          petDragActive = false;
          drag.current = null; setDragging(false);
          if (!state.moved) setOpen((value) => !value);
          return;
        }
        const finalPosition = { left: state.currentLeft, top: state.currentTop };
        const area = bounds();
        drag.current = null; setDragging(false);
        if (state.moved) {
          const x = area.maxX === area.minX ? 0 : (finalPosition.left - area.minX) / (area.maxX - area.minX);
          const y = area.maxY === area.minY ? 0 : (finalPosition.top - area.minY) / (area.maxY - area.minY);
          patchConfig({ petPosition: "free", petX: x, petY: y }).catch(() => {});
        } else {
          setLivePosition(null); setOpen((value) => !value);
        }
      };
      const showMenu = (event) => {
        if (!NATIVE_PET_MODE || !window.dshDesktop || !window.dshDesktop.pet) return;
        event.preventDefault(); window.dshDesktop.pet.showMenu();
      };
      return h("div", { className: `dxe-pet ${dragging ? "dxe-pet-dragging" : ""}`, style: position, onPointerDown: pointerDown, onPointerMove: pointerMove, onPointerUp: pointerUp, onPointerCancel: pointerUp, onContextMenu: showMenu },
        open ? h("div", { className: "dxe-bubble", role: "status", style: bubbleStyle, onPointerDown: (event) => event.stopPropagation() },
          h("div", { className: "dxe-balance-head" },
            h("div", null, h("span", null, "DEEPSEEK 余额"), h("strong", null, details.value)),
            h("small", null, details.state)),
          h("div", { className: "dxe-token-grid" },
            h("div", { className: "dxe-token-stat" }, h("span", null, "总用量"), h("strong", null, formatTokens(tokens.total))),
            h("div", { className: "dxe-token-stat" }, h("span", null, "输入 / 输出"), h("strong", null, `${formatTokens(tokens.input)} / ${formatTokens(tokens.output)}`)),
            h("div", { className: "dxe-token-stat" }, h("span", null, "缓存写入"), h("strong", null, formatTokens(tokens.cacheWrite)))),
          h("div", { className: "dxe-cache" },
            h("div", { className: "dxe-cache-row" }, h("span", null, `缓存命中 ${formatTokens(tokens.cacheRead)} tokens`), h("strong", null, `${tokens.hitRate.toFixed(1)}%`)),
            h("div", { className: "dxe-cache-track", "aria-hidden": "true" }, h("span", { style: { width: `${tokens.hitRate}%` } })))) : null,
        h("img", {
          src: "/dsh-app-icon-512.png",
          alt: "DSH 黑鲸鱼桌宠",
          title: "拖动可自由移动，点击查看余额、Token 与缓存命中",
          draggable: false,
          onError: (event) => { event.currentTarget.style.display = "none"; },
        }));
    }

    function DockOverlay({ layout }) {
      const config = useConfig();
      const [hovered, setHovered] = React.useState(false);
      React.useEffect(() => {
        let hideTimer = null;
        const onMove = (event) => {
          if (event.clientY < 100) {
            clearTimeout(hideTimer);
            setHovered(true);
          } else {
            clearTimeout(hideTimer);
            hideTimer = setTimeout(() => setHovered(false), 500);
          }
        };
        document.addEventListener("mousemove", onMove);
        return () => { document.removeEventListener("mousemove", onMove); clearTimeout(hideTimer); };
      }, []);
      if (!config.dockVisible) return null;
      const button = (icon, label, onClick) => h("button", { type: "button", title: label, "aria-label": label, onClick }, h("i", { "aria-hidden": "true" }, icon), h("span", null, label));
      const toggleDesktopPet = async () => {
        if (!window.dshDesktop || !window.dshDesktop.pet) return;
        if (typeof window.dshDesktop.pet.toggle === "function") { await window.dshDesktop.pet.toggle(); }
        else if (typeof window.dshDesktop.pet.open === "function") { await window.dshDesktop.pet.open(); }
      };
      const toggleDetails = () => {
        const col = document.querySelector(".pI_x6G_detailsCol");
        const open = Boolean(col && col.getBoundingClientRect().width > 10);
        if (open) layout.closeDetails();
        else layout.openDetails();
      };
      return h("nav", { className: `dxe-dock ${hovered ? "" : "dxe-dock-hidden"}`, "aria-label": "DSH 桌面快捷栏" },
        button("☰", "侧边栏", () => layout.toggleSidebar()),
        button("◫", "详情", () => toggleDetails()),
        h("span", { className: "dxe-dock-divider", "aria-hidden": "true" }),
        button("🐋", "桌面桌宠", () => toggleDesktopPet().catch(() => {})),
        button("▧", "壁纸", () => patchConfig({ wallpaperEnabled: !config.wallpaperEnabled }).catch(() => {})));
    }

    function Toggle({ checked, onChange, label }) {
      return h("button", {
        type: "button",
        className: `dxe-switch ${checked ? "dxe-switch-on" : ""}`,
        role: "switch",
        "aria-checked": checked,
        "aria-label": label,
        onClick: () => onChange(!checked),
      }, h("span"));
    }
    function Field({ label, children }) { return h("div", { className: "dxe-field" }, h("label", null, label), children); }
    function StatusRow({ name, ok, detail }) {
      return h("div", { className: "dxe-status" }, h("span", null, name, detail ? h("small", { style: { display: "block", opacity: .68 } }, detail) : null), h("span", { className: `dxe-badge ${ok ? "" : "dxe-badge-off"}` }, ok ? "已加载" : "未连接"));
    }

    function LocalPluginsPage({ section = "overview" } = {}) {
      const config = useConfig(10000);
      const [wallpapers, setWallpapers] = React.useState({ inbox: [], inboxRoot: "", limits: {} });
      const [status, setStatus] = React.useState({ desktop: false, token: false, experience: true });
      const [busy, setBusy] = React.useState("");
      const [message, setMessage] = React.useState("");
      const [error, setError] = React.useState("");

      const loadWallpapers = React.useCallback(async () => {
        const value = await jsonRequest(`${BASE}/wallpapers.json`);
        setWallpapers(value);
      }, []);
      React.useEffect(() => {
        loadWallpapers().catch((reason) => setError(reason.message));
        Promise.allSettled([jsonRequest("/dsh-token-pet/data.json")]).then(([token]) => {
          setStatus({ desktop: Boolean(window.dshDesktop), token: token.status === "fulfilled", experience: true });
        });
      }, [loadWallpapers]);

      const update = async (patch) => {
        setError("");
        try { await patchConfig(patch); setMessage("设置已保存"); }
        catch (reason) { setError(reason.message); }
      };
      const importWallpaper = async (fileName) => {
        setBusy(fileName); setError(""); setMessage("");
        try {
          const result = await jsonRequest(`${BASE}/wallpaper/import`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileName }) });
          publishConfig(result.config); await loadWallpapers(); setMessage(`已安全导入：${fileName}`);
        } catch (reason) { setError(reason.message); }
        finally { setBusy(""); }
      };
      const clearWallpaper = async () => {
        setBusy("clear"); setError("");
        try {
          const result = await jsonRequest(`${BASE}/wallpaper/clear`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
          publishConfig(result.config); await loadWallpapers(); setMessage("壁纸已关闭；安全转码文件仍保留，可再次使用。");
        } catch (reason) { setError(reason.message); }
        finally { setBusy(""); }
      };
      const uploadWallpaper = async (file) => {
        if (!file) return;
        setBusy("upload"); setError(""); setMessage("");
        try {
          const response = await fetch(`${BASE}/wallpaper/upload`, {
            method: "POST",
            cache: "no-store",
            credentials: "same-origin",
            headers: { "content-type": "application/octet-stream", "x-dsh-file-name": encodeURIComponent(file.name) },
            body: file,
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok || result.ok === false) throw new Error(result.error || `HTTP ${response.status}`);
          publishConfig(result.config); await loadWallpapers(); setMessage(`已安全扫描并导入：${file.name}`);
        } catch (reason) { setError(reason.message); }
        finally { setBusy(""); }
      };
      const openStandalonePet = async () => {
        setError(""); setMessage("");
        try {
          if (!window.dshDesktop || !window.dshDesktop.pet || typeof window.dshDesktop.pet.open !== "function") {
            throw new Error("独立桌宠入口仅在 DeepSeek Harness 原生应用中可用。");
          }
          const result = await window.dshDesktop.pet.open();
          if (!result || result.ok === false) throw new Error((result && result.error) || "独立桌宠启动失败。");
          setMessage("独立桌宠已打开；可在 Windows 桌面自由拖动。");
        } catch (reason) { setError(reason.message); }
      };
      const resetPetPosition = async () => {
        setError(""); setMessage("");
        try {
          if (!window.dshDesktop || !window.dshDesktop.pet || typeof window.dshDesktop.pet.reset !== "function") {
            throw new Error("独立桌宠入口仅在 DeepSeek Harness 原生应用中可用。");
          }
          const result = await window.dshDesktop.pet.reset();
          if (!result || result.ok === false) throw new Error((result && result.error) || "桌宠位置复位失败。");
          setMessage("桌宠已回到主屏右下角。");
        } catch (reason) { setError(reason.message); }
      };

      const statusCard = h("section", { className: "dxe-card" },
        h("h4", null, "插件状态"),
        h(StatusRow, { name: "Desktop App", detail: window.dshDesktop ? "原生桌面应用" : "桌面启动能力", ok: status.desktop }),
        h(StatusRow, { name: "Token Pet", detail: "余额与 token 数据源", ok: status.token }),
        h(StatusRow, { name: "Desktop Experience", detail: "v0.1.23 · 布局、桌宠与壁纸", ok: status.experience }));
      const layoutCard = h("section", { className: "dxe-card" },
        h("h4", null, "桌面布局"),
        h("p", null, "保留 DSH 原生三栏结构，只增加轻量快捷栏，升级兼容性更好。"),
        h(Field, { label: "显示快捷栏" }, h(Toggle, { checked: config.dockVisible, label: "显示快捷栏", onChange: (value) => update({ dockVisible: value }) })));
      const petCard = h("section", { className: "dxe-card" },
        h("h4", null, "黑鲸鱼桌宠"),
        h("p", null, "桌宠是独立透明置顶窗口，可以离开 DSH 在 Windows 桌面自由移动；点击鲸鱼查看余额、Token 与缓存命中。"),
        h(Field, { label: "桌面桌宠" }, h("button", { type: "button", className: "dxe-btn", onClick: openStandalonePet }, "立即打开")),
        h(Field, { label: `大小 ${config.petSize}px` }, h("input", { type: "range", min: 72, max: 180, step: 4, value: config.petSize, onChange: (event) => update({ petSize: Number(event.target.value) }) })),
        h(Field, { label: "位置复位" }, h("button", { type: "button", className: "dxe-btn", onClick: () => resetPetPosition() }, "回到主屏右下角")),
        h(Field, { label: "数据刷新" }, h("select", { value: config.petRefreshSeconds, onChange: (event) => update({ petRefreshSeconds: Number(event.target.value) }) },
          h("option", { value: 30 }, "30 秒"), h("option", { value: 60 }, "60 秒"), h("option", { value: 120 }, "2 分钟"), h("option", { value: 300 }, "5 分钟"))));
      const inboxRows = wallpapers.inbox.length === 0
        ? h("p", null, "把图片复制到上面的文件夹，然后重新打开此页或点击刷新。")
        : wallpapers.inbox.map((fileName) => h("div", { className: "dxe-inbox-row", key: fileName },
          h("span", { title: fileName }, fileName),
          h("button", { type: "button", className: "dxe-btn", disabled: Boolean(busy), onClick: () => importWallpaper(fileName) }, busy === fileName ? "扫描中…" : "安全扫描并更换")));
      const wallpaperCard = h("section", { className: "dxe-card" },
        h("h4", null, "安全更换壁纸 · 插件 v0.1.23"),
        h("p", null, "支持 PNG、JPEG、WebP、GIF；动态图片会转成干净的 animated WebP，并为减少动画模式生成静态封面。SVG、网页、远程 URL 和视频一律拒绝。"),
        h("div", { className: "dxe-actions" },
          h("label", { className: "dxe-upload", title: "从电脑选择本地图片" },
            busy === "upload" ? "正在安全扫描…" : "从本地导入壁纸",
            h("input", { type: "file", accept: ".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif", disabled: Boolean(busy), onChange: (event) => { const file = event.target.files && event.target.files[0]; event.target.value = ""; uploadWallpaper(file); } }))),
        h(Field, { label: "启用壁纸" }, h(Toggle, { checked: config.wallpaperEnabled, label: "启用壁纸", onChange: (value) => update({ wallpaperEnabled: value }) })),
        h(Field, { label: `透明度 ${Math.round(config.wallpaperOpacity * 100)}%` }, h("input", { type: "range", min: .05, max: .35, step: .01, value: config.wallpaperOpacity, onChange: (event) => update({ wallpaperOpacity: Number(event.target.value) }) })),
        h(Field, { label: "显示方式" }, h("select", { value: config.wallpaperFit, onChange: (event) => update({ wallpaperFit: event.target.value }) }, h("option", { value: "cover" }, "铺满裁剪"), h("option", { value: "contain" }, "完整显示"))),
        h(Field, { label: `模糊 ${config.wallpaperBlur || 0}px` }, h("input", { type: "range", min: 0, max: 40, step: 1, value: config.wallpaperBlur || 0, onChange: (event) => update({ wallpaperBlur: Number(event.target.value) }) })),
        h(Field, { label: `玻璃质感 ${config.wallpaperGlass || 0}%` }, h("input", { type: "range", min: 0, max: 100, step: 1, value: config.wallpaperGlass || 0, onChange: (event) => update({ wallpaperGlass: Number(event.target.value) }) })),
        h(Field, { label: `对话框不透明度 ${config.inputOpacity ?? 100}%` }, h("input", { type: "range", min: 0, max: 100, step: 1, value: config.inputOpacity ?? 100, onChange: (event) => update({ inputOpacity: Number(event.target.value) }) })),
        h(Field, { label: `工作区不透明度 ${config.sidebarOpacity ?? 100}%` }, h("input", { type: "range", min: 0, max: 100, step: 1, value: config.sidebarOpacity ?? 100, onChange: (event) => update({ sidebarOpacity: Number(event.target.value) }) })),
        h("div", { className: "dxe-path" }, wallpapers.inboxRoot || "正在读取壁纸收件箱…"),
        h("div", { className: "dxe-inbox" }, inboxRows),
        h("div", { className: "dxe-actions" },
          h("button", { type: "button", className: "dxe-btn", disabled: Boolean(busy), onClick: () => loadWallpapers().catch((reason) => setError(reason.message)) }, "刷新列表"),
          h("button", { type: "button", className: "dxe-btn dxe-btn-danger", disabled: Boolean(busy), onClick: clearWallpaper }, "恢复默认背景")));
      const page = section === "pet"
        ? { title: "桌宠", description: "打开独立桌宠，并调整大小和刷新频率。", cards: [petCard] }
        : section === "wallpaper"
          ? { title: "壁纸", description: "从本地收件箱安全扫描并更换静态或动态壁纸。", cards: [wallpaperCard] }
          : { title: "桌面体验", description: "桌宠和壁纸已经作为设置中的独立入口，也可以在这里查看完整状态。", cards: [statusCard, layoutCard, petCard, wallpaperCard] };
      return h("div", { className: `dxe-page ${section === "overview" ? "" : "dxe-page-single"}` },
        h("section", { className: "dxe-hero" }, h("h3", null, page.title), h("p", null, page.description)),
        h("div", { className: "dxe-grid" }, ...page.cards),
        message ? h("p", { className: "dxe-message", role: "status" }, message) : null,
        error ? h("p", { className: "dxe-message dxe-error", role: "alert" }, error) : null);
    }

    const inject = ["slots", "layout"];
    function apply(ctx) {
      installCss();
      configListeners.add((config) => {
        const root = document.documentElement;
        const apply = (cls, value, prop) => {
          const opacity = Number(value);
          if (Number.isFinite(opacity)) {
            root.classList.add(cls);
            root.style.setProperty(prop, `${Math.round(opacity)}%`);
          } else {
            root.classList.remove(cls);
            root.style.removeProperty(prop);
          }
        };
        apply("dxe-glass-input", config.inputOpacity, "--dxe-input-alpha");
        apply("dxe-glass-sidebar", config.sidebarOpacity, "--dxe-sidebar-alpha");
        applyGlassInline(config);
      });
      startGlassObserver();
      // Apply glass styling immediately from the stored config, independent of
      // any React overlay mounting (the overlays are only injected when the
      // desktop bridge is present, which previously left the sliders dead).
      refreshConfig().catch(() => {});
      if (!window.dshDesktop) return;
      if (NATIVE_PET_MODE) {
        ctx.slots.inject("shell.overlay", function* () {
          yield ctx.slots.register({ name: "shell.overlay", id: "local-token-pet-native", order: 200 }, PetOverlay);
        });
        return;
      }
      ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
        name: "settings.plugins.tab",
        id: "local-plugins",
        order: 50,
        label: "桌面体验",
      }, LocalPluginsPage));
      ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
        name: "settings.plugins.tab",
        id: "local-token-pet-settings",
        order: 51,
        label: "桌宠",
      }, () => h(LocalPluginsPage, { section: "pet" })));
      ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
        name: "settings.plugins.tab",
        id: "local-wallpaper-settings",
        order: 52,
        label: "壁纸",
      }, () => h(LocalPluginsPage, { section: "wallpaper" })));
      ctx.slots.inject("shell.overlay", function* () {
        yield ctx.slots.register({ name: "shell.overlay", id: "local-wallpaper", order: -1000 }, WallpaperOverlay);
        yield ctx.slots.register({ name: "shell.overlay", id: "local-desktop-dock", order: 100 }, () => h(DockOverlay, { layout: ctx.layout }));
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
