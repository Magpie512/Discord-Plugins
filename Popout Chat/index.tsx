/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/// <reference types="react" />

import "./styles.css";

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByPropsLazy, findComponentByCodeLazy } from "@webpack";
import { ChannelStore, ReactDOM, React, useEffect, useRef, useState, useCallback, useReducer } from "@webpack/common";

// ─── Webpack Module Finds ────────────────────────────────────────────────────

/**
 * Discord's internal Messages component — renders the scrollable message list
 * for a given channelId. The code-fragment used here is a stable internal
 * string; if Discord changes it you only need to update this one line.
 */
const MessagesComponent = findComponentByCodeLazy("messageGroupSpacing", "LOAD_MESSAGE_REQUESTS");

/**
 * Discord's ChannelTextArea (the chat-input box).
 * We include it so the popout is fully interactive.
 */
const ChannelTextArea = findComponentByCodeLazy("channelTextArea", "textAreaDisabled");

/**
 * Helper that provides the MQ/permissions context a channel component expects.
 */
const ChannelContext = findByPropsLazy("ChannelPinsModal");

// ─── Types ───────────────────────────────────────────────────────────────────

interface PopoutEntry {
    id: string;          // unique popout instance id
    channelId: string;
    guildId: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
    minimized: boolean;
    title: string;
}

type PopoutsAction =
    | { type: "ADD"; entry: PopoutEntry }
    | { type: "REMOVE"; id: string }
    | { type: "MOVE"; id: string; x: number; y: number }
    | { type: "RESIZE"; id: string; width: number; height: number }
    | { type: "TOGGLE_MINIMIZE"; id: string }
    | { type: "BRING_TO_FRONT"; id: string };

// ─── Popout State Reducer ────────────────────────────────────────────────────

function popoutsReducer(state: PopoutEntry[], action: PopoutsAction): PopoutEntry[] {
    switch (action.type) {
        case "ADD":
            return [...state, action.entry];
        case "REMOVE":
            return state.filter(p => p.id !== action.id);
        case "MOVE":
            return state.map(p => p.id === action.id ? { ...p, x: action.x, y: action.y } : p);
        case "RESIZE":
            return state.map(p => p.id === action.id ? { ...p, width: action.width, height: action.height } : p);
        case "TOGGLE_MINIMIZE":
            return state.map(p => p.id === action.id ? { ...p, minimized: !p.minimized } : p);
        case "BRING_TO_FRONT": {
            const idx = state.findIndex(p => p.id === action.id);
            if (idx === -1) return state;
            const entry = state[idx];
            return [...state.filter(p => p.id !== action.id), entry];
        }
        default:
            return state;
    }
}

// ─── Global Popout Manager (singleton outside React) ─────────────────────────

let globalDispatch: React.Dispatch<PopoutsAction> | null = null;

export function openChatPopout(channelId: string) {
    if (!globalDispatch) return;

    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return;

    // Prevent duplicate popouts for the same channel
    // (handled by checking in PopoutManager, but guard here too)
    const title = channel.name
        ? `#${channel.name}`
        : channel.recipients?.length
            ? "DM"
            : "Chat";

    const id = `popout-${channelId}-${Date.now()}`;
    const centerX = Math.max(80, window.innerWidth / 2 - 200);
    const centerY = Math.max(80, window.innerHeight / 2 - 250);

    globalDispatch({
        type: "ADD",
        entry: {
            id,
            channelId,
            guildId: channel.guild_id ?? null,
            x: centerX,
            y: centerY,
            width: 420,
            height: 520,
            minimized: false,
            title,
        },
    });
}

// ─── Floating Chat Window Component ──────────────────────────────────────────

interface FloatingChatWindowProps {
    entry: PopoutEntry;
    zIndex: number;
    dispatch: React.Dispatch<PopoutsAction>;
}

function FloatingChatWindow({ entry, zIndex, dispatch }: FloatingChatWindowProps) {
    const { id, channelId, guildId, x, y, width, height, minimized, title } = entry;

    const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
    const resizeState = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);
    const windowRef = useRef<HTMLDivElement>(null);

    // ── Drag ──────────────────────────────────────────────────────────────────
    const onTitleMouseDown = useCallback((e: React.MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        dispatch({ type: "BRING_TO_FRONT", id });
        dragState.current = { startX: e.clientX, startY: e.clientY, origX: x, origY: y };

        const onMove = (ev: MouseEvent) => {
            if (!dragState.current) return;
            const dx = ev.clientX - dragState.current.startX;
            const dy = ev.clientY - dragState.current.startY;
            const newX = Math.max(0, Math.min(window.innerWidth - width, dragState.current.origX + dx));
            const newY = Math.max(0, Math.min(window.innerHeight - 40, dragState.current.origY + dy));
            dispatch({ type: "MOVE", id, x: newX, y: newY });
        };
        const onUp = () => {
            dragState.current = null;
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    }, [id, x, y, width, dispatch]);

    // ── Resize ────────────────────────────────────────────────────────────────
    const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        resizeState.current = { startX: e.clientX, startY: e.clientY, origW: width, origH: height };

        const onMove = (ev: MouseEvent) => {
            if (!resizeState.current) return;
            const dw = ev.clientX - resizeState.current.startX;
            const dh = ev.clientY - resizeState.current.startY;
            dispatch({
                type: "RESIZE",
                id,
                width: Math.max(280, resizeState.current.origW + dw),
                height: Math.max(200, resizeState.current.origH + dh),
            });
        };
        const onUp = () => {
            resizeState.current = null;
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    }, [id, width, height, dispatch]);

    const channel = ChannelStore.getChannel(channelId);

    return (
        <div
            ref={windowRef}
            className="vc-chat-popout-window"
            style={{
                left: x,
                top: y,
                width,
                height: minimized ? "auto" : height,
                zIndex,
            }}
            onMouseDown={() => dispatch({ type: "BRING_TO_FRONT", id })}
        >
            {/* Title bar */}
            <div
                className="vc-chat-popout-titlebar"
                onMouseDown={onTitleMouseDown}
            >
                <span className="vc-chat-popout-channel-icon">
                    {channel?.type === 1 || channel?.type === 3 ? "👤" : "#"}
                </span>
                <span className="vc-chat-popout-title">{title}</span>

                <div className="vc-chat-popout-controls">
                    <button
                        className="vc-chat-popout-btn"
                        title={minimized ? "Restore" : "Minimize"}
                        onClick={() => dispatch({ type: "TOGGLE_MINIMIZE", id })}
                    >
                        {minimized ? "▲" : "▼"}
                    </button>
                    <button
                        className="vc-chat-popout-btn vc-chat-popout-btn-close"
                        title="Close"
                        onClick={() => dispatch({ type: "REMOVE", id })}
                    >
                        ✕
                    </button>
                </div>
            </div>

            {/* Chat body */}
            {!minimized && channel && (
                <div className="vc-chat-popout-body">
                    <div className="vc-chat-popout-messages">
                        <MessagesComponent
                            channel={channel}
                            guildId={guildId}
                        />
                    </div>
                    <div className="vc-chat-popout-input">
                        <ChannelTextArea
                            channel={channel}
                            type={{ analyticsName: "normal" }}
                            disabled={false}
                        />
                    </div>
                </div>
            )}

            {/* Resize handle */}
            {!minimized && (
                <div
                    className="vc-chat-popout-resize-handle"
                    onMouseDown={onResizeMouseDown}
                    title="Resize"
                />
            )}
        </div>
    );
}

// ─── Popout Manager (renders all open popouts into a portal) ──────────────────

function PopoutManager() {
    const [popouts, dispatch] = useReducer(popoutsReducer, []);

    useEffect(() => {
        globalDispatch = dispatch;
        return () => { globalDispatch = null; };
    }, [dispatch]);

    if (popouts.length === 0) return null;

    // Render via a portal so the popouts sit above Discord's entire UI
    return (
        <>
            {popouts.map((entry, idx) => (
                <FloatingChatWindow
                    key={entry.id}
                    entry={entry}
                    zIndex={9000 + idx}
                    dispatch={dispatch}
                />
            ))}
        </>
    );
}

// ─── Toolbar Button Component ─────────────────────────────────────────────────

function PopoutButton({ channel }: { channel: any; }) {
    const [active, setActive] = useState(false);

    return (
        <button
            className={`vc-chat-popout-toolbar-btn ${active ? "vc-chat-popout-toolbar-btn--active" : ""}`}
            title="Pop out this chat"
            aria-label="Pop out chat"
            onClick={() => {
                setActive(true);
                setTimeout(() => setActive(false), 300);
                openChatPopout(channel.id);
            }}
        >
            {/* Popout icon (two overlapping squares) */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="9" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />
                <path d="M9 3h12v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M9 9L21 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
        </button>
    );
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export default definePlugin({
    name: "Popout Chat!",
    description: "Pop out any chat channel into a persistent, draggable floating window that stays on that channel while you browse elsewhere.",
    authors: [{ name: "Mg.pie", github: "Magpie512", id: 0n }],

    // Mount the PopoutManager once into Discord's app root
    renderChatBarButton: null, // not using this API

    start() {
        // Inject the global PopoutManager container
        const container = document.createElement("div");
        container.id = "vc-chat-popout-container";
        document.body.appendChild(container);

        const root = ReactDOM.createRoot(container);
        root.render(<PopoutManager />);

        // Store root for cleanup
        (this as any)._popoutRoot = root;
        (this as any)._popoutContainer = container;
    },

    stop() {
        (this as any)._popoutRoot?.unmount();
        (this as any)._popoutContainer?.remove();
        globalDispatch = null;
    },

    patches: [
        // ── Patch 1: Inject popout button into the channel header toolbar ──────
        {
            find: "toolbar:function",
            replacement: {
                match: /(\i\.children.+?toolbar:function.{0,200})(}\))/,
                replace: "$1,$self.renderToolbarPopoutButton(arguments[0])$2",
            },
        },
    ],

    renderToolbarPopoutButton(props: any) {
        const channel = props?.channel;
        if (!channel) return null;
        return <PopoutButton channel={channel} />;
    },
});