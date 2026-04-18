/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Menu } from "@webpack/common";

const settings = definePluginSettings({
    width: {
        type: OptionType.SLIDER,
        description: "Default popout width (px)",
        default: 480,
        markers: [240, 320, 400, 480, 560, 640, 720, 800, 960, 1280],
    },
    height: {
        type: OptionType.SLIDER,
        description: "Default popout height (px)",
        default: 270,
        markers: [135, 180, 225, 270, 360, 450, 540, 720],
    },
    opacity: {
        type: OptionType.SLIDER,
        description: "Popout background opacity (0–100)",
        default: 100,
        markers: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    },
    alwaysOnTop: {
        type: OptionType.BOOLEAN,
        description: "Keep popout window always on top",
        default: true,
    },
    showUsername: {
        type: OptionType.BOOLEAN,
        description: "Show username overlay on popout",
        default: true,
    },
});

// ─── Popout Window Manager ────────────────────────────────────────────────────

interface PopoutEntry {
    win: Window;
    userId: string;
    username: string;
}

const openPopouts = new Map<string, PopoutEntry>();

function buildPopoutHTML(userId: string, username: string, streamKey: string, opts: {
    width: number;
    height: number;
    opacity: number;
    alwaysOnTop: boolean;
    showUsername: boolean;
}): string {
    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${username} – Video Popout</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --accent: #5865f2;
    --bg: rgba(0, 0, 0, ${opts.opacity / 100});
    --radius: 8px;
    --handle-h: 28px;
  }

  html, body {
    width: 100%; height: 100%;
    overflow: hidden;
    background: transparent;
    font-family: "gg sans", "Noto Sans", Whitney, "Helvetica Neue", sans-serif;
    user-select: none;
    -webkit-user-select: none;
  }

  #container {
    position: relative;
    width: 100%; height: 100%;
    background: var(--bg);
    border-radius: var(--radius);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    border: 1px solid rgba(255,255,255,0.08);
    box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  }

  #titlebar {
    flex: 0 0 var(--handle-h);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    background: rgba(0,0,0,0.45);
    backdrop-filter: blur(6px);
    -webkit-app-region: drag;
    cursor: grab;
  }
  #titlebar:active { cursor: grabbing; }

  .dot {
    width: 10px; height: 10px;
    border-radius: 50%;
    -webkit-app-region: no-drag;
    cursor: pointer;
    opacity: 0.85;
    transition: opacity 0.15s, transform 0.15s;
    border: none;
    outline: none;
  }
  .dot:hover { opacity: 1; transform: scale(1.15); }
  #btn-close  { background: #ff5f57; }
  #btn-pin    { background: #ffbd2e; }
  #btn-expand { background: #28c940; }

  #tb-title {
    flex: 1;
    font-size: 11px;
    font-weight: 600;
    color: rgba(255,255,255,0.6);
    letter-spacing: 0.03em;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    pointer-events: none;
  }

  #tb-aot {
    -webkit-app-region: no-drag;
    font-size: 10px;
    color: rgba(255,255,255,0.45);
    cursor: pointer;
    padding: 2px 5px;
    border-radius: 4px;
    transition: background 0.15s, color 0.15s;
    border: none;
    outline: none;
    background: transparent;
  }
  #tb-aot:hover { background: rgba(255,255,255,0.1); color: #fff; }
  #tb-aot.active { color: var(--accent); }

  #video-wrap {
    flex: 1;
    position: relative;
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  #username-tag {
    position: absolute;
    bottom: 8px; left: 8px;
    display: flex;
    align-items: center;
    gap: 5px;
    background: rgba(0,0,0,0.65);
    backdrop-filter: blur(4px);
    padding: 3px 8px 3px 5px;
    border-radius: 20px;
    pointer-events: none;
  }
  #username-tag svg { color: #fff; flex-shrink: 0; }
  #username-tag span {
    font-size: 12px;
    font-weight: 600;
    color: #fff;
    letter-spacing: 0.02em;
  }
  ${opts.showUsername ? "" : "#username-tag { display: none; }"}

  #resize-corner {
    position: absolute;
    bottom: 0; right: 0;
    width: 16px; height: 16px;
    cursor: nwse-resize;
    -webkit-app-region: no-drag;
    display: flex;
    align-items: flex-end;
    justify-content: flex-end;
    padding: 2px;
    opacity: 0.4;
    transition: opacity 0.15s;
  }
  #resize-corner:hover { opacity: 0.9; }

  #status {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: rgba(255,255,255,0.5);
    font-size: 13px;
    pointer-events: none;
    background: #111;
  }
  .spinner {
    width: 28px; height: 28px;
    border: 3px solid rgba(255,255,255,0.12);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.75s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div id="container">
  <div id="titlebar">
    <button class="dot" id="btn-close"  title="Close"></button>
    <button class="dot" id="btn-pin"    title="Toggle Always-on-Top"></button>
    <button class="dot" id="btn-expand" title="Fit to screen"></button>
    <span id="tb-title">🎥 ${username}</span>
    <button id="tb-aot" title="Toggle always on top" class="${opts.alwaysOnTop ? "active" : ""}">
      📌 AOT
    </button>
  </div>

  <div id="video-wrap">
    <div id="status">
      <div class="spinner"></div>
      <span>Connecting to stream…</span>
    </div>
    <div id="video-slot"></div>

    <div id="username-tag">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm0 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 14c-2.48 0-4.688-1.008-6.3-2.634A7.95 7.95 0 0 1 12 15c2.13 0 4.07.833 5.52 2.193A7.96 7.96 0 0 1 12 20z"/>
      </svg>
      <span>${username}</span>
    </div>

    <div id="resize-corner">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="rgba(255,255,255,0.7)">
        <path d="M10 0 L10 10 L0 10 Z"/>
      </svg>
    </div>
  </div>
</div>

<script>
  const userId    = ${JSON.stringify(userId)};
  const streamKey = ${JSON.stringify(streamKey)};
  let aot = ${opts.alwaysOnTop};

  document.getElementById("btn-close").addEventListener("click", () => window.close());

  function setAOT(val) {
    aot = val;
    document.getElementById("tb-aot").classList.toggle("active", val);
    try { window.DiscordNative?.window?.setAlwaysOnTop?.(val); } catch (_) {}
    try { window.opener?.postMessage({ type: "UVP_AOT", userId, val }, "*"); } catch (_) {}
  }

  document.getElementById("btn-pin").addEventListener("click",  () => setAOT(!aot));
  document.getElementById("tb-aot").addEventListener("click",   () => setAOT(!aot));

  if (aot) setAOT(true);

  document.getElementById("btn-expand").addEventListener("click", () => {
    window.resizeTo(screen.availWidth, screen.availHeight);
    window.moveTo(0, 0);
  });

  window.addEventListener("message", e => {
    if (!e.data) return;
    if (e.data.type === "UVP_STREAM_READY")
      document.getElementById("status").style.display = "none";
    if (e.data.type === "UVP_STREAM_ERROR")
      document.getElementById("status").innerHTML = "<span>⚠️ Stream unavailable</span>";
    if (e.data.type === "UVP_CLOSE" && e.data.userId === userId)
      window.close();
  });

  window.addEventListener("load", () => {
    window.opener?.postMessage({ type: "UVP_READY", userId }, "*");
  });
</script>
</body>
</html>`;
}

// ─── Stream injection ─────────────────────────────────────────────────────────

function findVideoElement(userId: string): HTMLVideoElement | null {
    const selectors = [
        `[data-user-id="${userId}"] video`,
        `[data-userid="${userId}"] video`,
        `.video-${userId} video`,
    ];
    for (const sel of selectors) {
        const el = document.querySelector<HTMLVideoElement>(sel);
        if (el) return el;
    }
    return Array.from(document.querySelectorAll<HTMLVideoElement>("video"))
        .find(v => v.srcObject instanceof MediaStream &&
            (v.srcObject as MediaStream).getVideoTracks().length > 0) ?? null;
}

function injectStream(popoutWin: Window, userId: string) {
    const video = findVideoElement(userId);
    if (!video?.srcObject) {
        popoutWin.postMessage({ type: "UVP_STREAM_ERROR" }, "*");
        return;
    }

    const slot = popoutWin.document.getElementById("video-slot");
    if (!slot) return;

    const pv = popoutWin.document.createElement("video");
    pv.autoplay    = true;
    pv.playsInline = true;
    pv.muted       = true;
    pv.style.cssText = "width:100%;height:100%;object-fit:contain;display:block;";
    pv.srcObject   = video.srcObject as MediaStream;
    slot.appendChild(pv);
    pv.play().catch(() => { /* autoplay policy */ });

    popoutWin.postMessage({ type: "UVP_STREAM_READY" }, "*");
}

// ─── Open / focus a popout ────────────────────────────────────────────────────

function openPopout(userId: string, username: string) {
    const existing = openPopouts.get(userId);
    if (existing && !existing.win.closed) { existing.win.focus(); return; }

    const { width, height, opacity, alwaysOnTop, showUsername } = settings.store;
    const streamKey = `${userId}:video`;

    const html = buildPopoutHTML(userId, username, streamKey, {
        width, height, opacity, alwaysOnTop, showUsername,
    });

    const features = [
        `width=${width}`,
        `height=${height + 28}`,
        "resizable=yes",
        "scrollbars=no",
        "toolbar=no",
        "menubar=no",
        "location=no",
        "status=no",
    ].join(",");

    const win = window.open("about:blank", `uvp_${userId}`, features);
    if (!win) {
        console.error("[UserVideoPopout] Popup blocked – allow popups for Discord.");
        return;
    }

    win.document.open();
    win.document.write(html);
    win.document.close();

    openPopouts.set(userId, { win, userId, username });

    const onMessage = (e: MessageEvent) => {
        if (e.source !== win) return;
        if (e.data?.type === "UVP_READY" && e.data.userId === userId) {
            injectStream(win, userId);
            window.removeEventListener("message", onMessage);
        }
    };
    window.addEventListener("message", onMessage);

    const pollClose = setInterval(() => {
        if (win.closed) { clearInterval(pollClose); openPopouts.delete(userId); }
    }, 1000);
}

// ─── Context Menu Patch ───────────────────────────────────────────────────────

const userContextPatch: NavContextMenuPatchCallback = (children, { user, userId: rawId }) => {
    if (!user) return;

    const uid   = user.id ?? rawId;
    const uname = user.globalName ?? user.username ?? uid;

    children.push(
        <Menu.MenuSeparator key="uvp-sep" />,
        <Menu.MenuItem
            key="uvp-open"
            id="uvp-open"
            label="📹 Pop Out Video"
            action={() => openPopout(uid, uname)}
        />
    );
};

// ─── Plugin Definition ────────────────────────────────────────────────────────

export default definePlugin({
    name: "User Video Poput",
    description: "Pop out any user's video stream into a floating always-on-top window during calls.",
    authors: [{ name: "Mg.pie", github: "Magpie512", id: 0n }],
    settings,

    start() {
        addContextMenuPatch("user-context",              userContextPatch);
        addContextMenuPatch("user-context-modal-user",   userContextPatch);
        addContextMenuPatch("channel-call-user-context", userContextPatch);
    },

    stop() {
        removeContextMenuPatch("user-context",              userContextPatch);
        removeContextMenuPatch("user-context-modal-user",   userContextPatch);
        removeContextMenuPatch("channel-call-user-context", userContextPatch);

        for (const { win } of openPopouts.values())
            if (!win.closed) win.close();
        openPopouts.clear();
    },
});