/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Plugin: RoleplayProfiles
 * Author: YourName
 *
 * Allows users to create multiple RP character profiles, share them
 * as Discord messages, and have other plugin users see them as
 * rendered profile cards.
 *
 * ──────────────────────────────────────────────────────────────
 * INSTALL: Drop this folder into your Vencord `src/plugins/` dir
 * and rebuild. Requires the ChatButtons and MessageAccessories
 * APIs to be enabled (they are on by default in Vencord).
 * ──────────────────────────────────────────────────────────────
 */

import { addChatBarButton, removeChatBarButton } from "@api/ChatButtons";
import { addMessageAccessory, removeMessageAccessory } from "@api/MessageAccessories";
import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import {
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalProps,
    ModalRoot,
    ModalSize,
    openModal,
} from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import {
    Button,
    Forms,
    Menu,
    React,
    Text,
    TextArea,
    TextInput,
    Tooltip,
    useEffect,
    useState,
} from "@webpack/common";
import { getCurrentUser, sendMessage } from "@utils/discord";

// ══════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════

interface CustomField {
    key: string;
    value: string;
}

interface CharacterProfile {
    id: string;
    name: string;
    pronouns: string;
    species: string;
    age: string;
    height: string;
    occupation: string;
    description: string;
    personality: string;
    backstory: string;
    avatarUrl: string;
    accentColor: string;      // hex e.g. "#7B68EE"
    tags: string[];
    customFields: CustomField[];
    createdAt: number;
    updatedAt: number;
}

interface SavedProfile {
    userId: string;
    username: string;
    profile: CharacterProfile;
    savedAt: number;
}

interface PluginData {
    myProfiles: CharacterProfile[];
    activeProfileId: string | null;
    savedProfiles: SavedProfile[];   // profiles discovered from others
}

// ══════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════

/** Marker embedded in shared messages so the plugin can detect them. */
const RP_MARKER = "RP_CARD:";

const DEFAULT_DATA: PluginData = {
    myProfiles: [],
    activeProfileId: null,
    savedProfiles: [],
};

const DEFAULT_PROFILE: Omit<CharacterProfile, "id" | "createdAt" | "updatedAt"> = {
    name: "",
    pronouns: "",
    species: "",
    age: "",
    height: "",
    occupation: "",
    description: "",
    personality: "",
    backstory: "",
    avatarUrl: "",
    accentColor: "#7B68EE",
    tags: [],
    customFields: [],
};

// ══════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════

const settings = definePluginSettings({
    data: {
        type: OptionType.STRING,
        description: "Plugin data (profiles stored as JSON — do not edit manually)",
        default: JSON.stringify(DEFAULT_DATA),
        hidden: true,
    },
    showShareButton: {
        type: OptionType.BOOLEAN,
        description: "Show a share button on your own profile cards",
        default: true,
    },
    compactCards: {
        type: OptionType.BOOLEAN,
        description: "Show compact profile cards in chat (less scrolling)",
        default: false,
    },
});

// ══════════════════════════════════════════════════════════════
// DATA HELPERS
// ══════════════════════════════════════════════════════════════

function getData(): PluginData {
    try {
        return JSON.parse(settings.store.data) as PluginData;
    } catch {
        return { ...DEFAULT_DATA };
    }
}

function saveData(data: PluginData): void {
    settings.store.data = JSON.stringify(data);
}

function genId(): string {
    return `rp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function newProfile(): CharacterProfile {
    const now = Date.now();
    return { ...DEFAULT_PROFILE, id: genId(), createdAt: now, updatedAt: now, tags: [], customFields: [] };
}

// ══════════════════════════════════════════════════════════════
// SHARE / PARSE HELPERS
// ══════════════════════════════════════════════════════════════

/** Encode a profile into a shareable message string. */
function buildShareMessage(profile: CharacterProfile, username: string): string {
    const tagLine = profile.tags.length ? `\`${profile.tags.join("` `")}\`` : "";
    const customLines = profile.customFields
        .filter(f => f.key && f.value)
        .map(f => `**${f.key}:** ${f.value}`)
        .join("\n");

    const parts: string[] = [
        `━━━━━━━━━━━━ 🎭 Character Profile ━━━━━━━━━━━━`,
        `**${profile.name || "Unnamed"}**${profile.pronouns ? ` *(${profile.pronouns})*` : ""}`,
        [profile.species, profile.age, profile.height, profile.occupation]
            .filter(Boolean)
            .join(" · "),
        tagLine,
        profile.description ? `\n📖 **Description**\n${profile.description}` : "",
        profile.personality ? `\n💫 **Personality**\n${profile.personality}` : "",
        profile.backstory ? `\n📜 **Backstory**\n${profile.backstory}` : "",
        customLines ? `\n${customLines}` : "",
        `\n*Shared by ${username}*`,
        // Machine-readable data for plugin users ↓
        `\n${RP_MARKER}${btoa(unescape(encodeURIComponent(JSON.stringify({ profile, username }))))}`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ];

    return parts.filter(p => p !== "").join("\n");
}

/** Extract a profile from a message's raw content, if present. */
function extractProfile(content: string): { profile: CharacterProfile; username: string } | null {
    const idx = content.indexOf(RP_MARKER);
    if (idx === -1) return null;
    try {
        const raw = content.slice(idx + RP_MARKER.length).split(/\s/)[0];
        const json = decodeURIComponent(escape(atob(raw)));
        return JSON.parse(json);
    } catch {
        return null;
    }
}

// ══════════════════════════════════════════════════════════════
// STYLE HELPERS
// ══════════════════════════════════════════════════════════════

/** Convert hex colour to an rgba with given opacity. */
function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

// ══════════════════════════════════════════════════════════════
// COMPONENTS — INLINE STYLES (no external CSS needed)
// ══════════════════════════════════════════════════════════════

// ─── Profile Card (rendered in chat) ──────────────────────────

function ProfileCard({
    profile,
    username,
    compact = false,
    onSave,
    onShare,
    isOwn = false,
}: {
    profile: CharacterProfile;
    username: string;
    compact?: boolean;
    onSave?: () => void;
    onShare?: () => void;
    isOwn?: boolean;
}) {
    const accent = profile.accentColor || "#7B68EE";
    const [expanded, setExpanded] = useState(!compact);

    const cardStyle: React.CSSProperties = {
        background: `linear-gradient(135deg, ${hexToRgba(accent, 0.08)} 0%, var(--background-secondary) 100%)`,
        border: `1.5px solid ${hexToRgba(accent, 0.4)}`,
        borderRadius: "12px",
        padding: "14px 16px",
        marginTop: "6px",
        maxWidth: "520px",
        fontFamily: "var(--font-primary)",
        position: "relative",
        overflow: "hidden",
    };

    const accentBarStyle: React.CSSProperties = {
        position: "absolute",
        top: 0,
        left: 0,
        width: "4px",
        height: "100%",
        background: accent,
        borderRadius: "12px 0 0 12px",
    };

    const headerRowStyle: React.CSSProperties = {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        marginBottom: "8px",
    };

    const avatarStyle: React.CSSProperties = {
        width: "52px",
        height: "52px",
        borderRadius: "50%",
        border: `2px solid ${accent}`,
        objectFit: "cover",
        flexShrink: 0,
        background: hexToRgba(accent, 0.2),
    };

    const avatarPlaceholderStyle: React.CSSProperties = {
        ...avatarStyle,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "22px",
    };

    const nameStyle: React.CSSProperties = {
        color: "var(--header-primary)",
        fontWeight: 700,
        fontSize: "16px",
        lineHeight: 1.2,
    };

    const metaStyle: React.CSSProperties = {
        color: "var(--text-muted)",
        fontSize: "12px",
        marginTop: "2px",
    };

    const tagStyle: React.CSSProperties = {
        display: "inline-block",
        background: hexToRgba(accent, 0.18),
        color: accent,
        borderRadius: "4px",
        padding: "1px 7px",
        fontSize: "11px",
        fontWeight: 600,
        marginRight: "4px",
        marginTop: "4px",
    };

    const sectionStyle: React.CSSProperties = {
        marginTop: "10px",
        borderTop: `1px solid ${hexToRgba(accent, 0.15)}`,
        paddingTop: "10px",
    };

    const sectionLabelStyle: React.CSSProperties = {
        color: accent,
        fontSize: "11px",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        marginBottom: "3px",
    };

    const bodyTextStyle: React.CSSProperties = {
        color: "var(--text-normal)",
        fontSize: "13px",
        lineHeight: 1.5,
        whiteSpace: "pre-wrap",
    };

    const btnRowStyle: React.CSSProperties = {
        display: "flex",
        gap: "6px",
        marginTop: "10px",
        flexWrap: "wrap",
    };

    const metaItems = [profile.species, profile.age, profile.height, profile.occupation].filter(Boolean);

    return (
        <div style={cardStyle}>
            <div style={accentBarStyle} />
            {/* Header */}
            <div style={{ paddingLeft: "8px" }}>
                <div style={headerRowStyle}>
                    {profile.avatarUrl ? (
                        <img src={profile.avatarUrl} alt={profile.name} style={avatarStyle} />
                    ) : (
                        <div style={avatarPlaceholderStyle}>🎭</div>
                    )}
                    <div>
                        <div style={nameStyle}>
                            {profile.name || "Unnamed Character"}
                            {profile.pronouns && (
                                <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: "13px" }}>
                                    {" "}({profile.pronouns})
                                </span>
                            )}
                        </div>
                        {metaItems.length > 0 && (
                            <div style={metaStyle}>{metaItems.join(" · ")}</div>
                        )}
                        <div style={{ marginTop: "4px" }}>
                            {profile.tags.map(t => <span key={t} style={tagStyle}>{t}</span>)}
                        </div>
                    </div>
                </div>

                {/* Toggle expand */}
                {compact && (
                    <button
                        onClick={() => setExpanded(e => !e)}
                        style={{
                            background: "none",
                            border: `1px solid ${hexToRgba(accent, 0.3)}`,
                            color: accent,
                            borderRadius: "5px",
                            padding: "2px 8px",
                            fontSize: "11px",
                            cursor: "pointer",
                            marginBottom: "4px",
                        }}
                    >
                        {expanded ? "▲ Collapse" : "▼ View profile"}
                    </button>
                )}

                {expanded && (
                    <>
                        {profile.description && (
                            <div style={sectionStyle}>
                                <div style={sectionLabelStyle}>📖 Description</div>
                                <div style={bodyTextStyle}>{profile.description}</div>
                            </div>
                        )}
                        {profile.personality && (
                            <div style={sectionStyle}>
                                <div style={sectionLabelStyle}>💫 Personality</div>
                                <div style={bodyTextStyle}>{profile.personality}</div>
                            </div>
                        )}
                        {profile.backstory && (
                            <div style={sectionStyle}>
                                <div style={sectionLabelStyle}>📜 Backstory</div>
                                <div style={bodyTextStyle}>{profile.backstory}</div>
                            </div>
                        )}
                        {profile.customFields.filter(f => f.key && f.value).length > 0 && (
                            <div style={sectionStyle}>
                                <div style={sectionLabelStyle}>✦ Custom Fields</div>
                                {profile.customFields.filter(f => f.key && f.value).map((f, i) => (
                                    <div key={i} style={{ fontSize: "13px", color: "var(--text-normal)", marginTop: "2px" }}>
                                        <span style={{ color: accent, fontWeight: 600 }}>{f.key}:</span> {f.value}
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}

                {/* Action buttons */}
                <div style={btnRowStyle}>
                    {!isOwn && onSave && (
                        <button
                            onClick={onSave}
                            style={{
                                background: hexToRgba(accent, 0.18),
                                border: `1px solid ${hexToRgba(accent, 0.4)}`,
                                color: accent,
                                borderRadius: "6px",
                                padding: "4px 10px",
                                fontSize: "12px",
                                cursor: "pointer",
                                fontWeight: 600,
                            }}
                        >
                            ⭐ Save Profile
                        </button>
                    )}
                    {isOwn && onShare && settings.store.showShareButton && (
                        <button
                            onClick={onShare}
                            style={{
                                background: hexToRgba(accent, 0.18),
                                border: `1px solid ${hexToRgba(accent, 0.4)}`,
                                color: accent,
                                borderRadius: "6px",
                                padding: "4px 10px",
                                fontSize: "12px",
                                cursor: "pointer",
                                fontWeight: 600,
                            }}
                        >
                            📤 Share in Chat
                        </button>
                    )}
                </div>

                <div style={{ color: "var(--text-muted)", fontSize: "11px", marginTop: "6px" }}>
                    Shared by {username} · viewed via RoleplayProfiles plugin
                </div>
            </div>
        </div>
    );
}

// ─── Tag Input ─────────────────────────────────────────────────

function TagInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
    const [input, setInput] = useState("");

    function addTag() {
        const trimmed = input.trim().toLowerCase();
        if (trimmed && !tags.includes(trimmed)) onChange([...tags, trimmed]);
        setInput("");
    }

    return (
        <div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "6px" }}>
                {tags.map(t => (
                    <span
                        key={t}
                        style={{
                            background: "var(--background-modifier-selected)",
                            borderRadius: "4px",
                            padding: "2px 8px",
                            fontSize: "12px",
                            color: "var(--text-normal)",
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                        }}
                    >
                        {t}
                        <button
                            onClick={() => onChange(tags.filter(x => x !== t))}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "0", lineHeight: 1 }}
                        >
                            ×
                        </button>
                    </span>
                ))}
            </div>
            <div style={{ display: "flex", gap: "6px" }}>
                <TextInput
                    value={input}
                    onChange={setInput}
                    placeholder="Add tag…"
                    onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                    style={{ flex: 1 }}
                />
                <Button onClick={addTag} size={Button.Sizes.SMALL}>Add</Button>
            </div>
        </div>
    );
}

// ─── Custom Fields Editor ──────────────────────────────────────

function CustomFieldsEditor({
    fields,
    onChange,
}: {
    fields: CustomField[];
    onChange: (f: CustomField[]) => void;
}) {
    function update(idx: number, partial: Partial<CustomField>) {
        const next = fields.map((f, i) => i === idx ? { ...f, ...partial } : f);
        onChange(next);
    }
    function remove(idx: number) { onChange(fields.filter((_, i) => i !== idx)); }
    function add() { onChange([...fields, { key: "", value: "" }]); }

    return (
        <div>
            {fields.map((f, i) => (
                <div key={i} style={{ display: "flex", gap: "6px", marginBottom: "6px", alignItems: "center" }}>
                    <TextInput value={f.key} onChange={v => update(i, { key: v })} placeholder="Field name" style={{ flex: 1 }} />
                    <TextInput value={f.value} onChange={v => update(i, { value: v })} placeholder="Value" style={{ flex: 2 }} />
                    <Button
                        onClick={() => remove(i)}
                        size={Button.Sizes.SMALL}
                        color={Button.Colors.RED}
                    >×</Button>
                </div>
            ))}
            <Button onClick={add} size={Button.Sizes.SMALL} look={Button.Looks.LINK}>+ Add Field</Button>
        </div>
    );
}

// ─── Profile Editor Modal ──────────────────────────────────────

function ProfileEditorModal({
    modalProps,
    initial,
    onSave,
}: {
    modalProps: ModalProps;
    initial?: CharacterProfile;
    onSave: (p: CharacterProfile) => void;
}) {
    const [draft, setDraft] = useState<CharacterProfile>(() => initial ? { ...initial } : newProfile());
    const set = <K extends keyof CharacterProfile>(k: K, v: CharacterProfile[K]) =>
        setDraft(prev => ({ ...prev, [k]: v }));

    const fieldStyle: React.CSSProperties = { marginBottom: "14px" };
    const labelStyle: React.CSSProperties = {
        display: "block",
        fontSize: "11px",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--text-muted)",
        marginBottom: "4px",
    };

    const colorPairs = [
        "#7B68EE", "#E91E8C", "#00BFA5", "#FF6B35",
        "#4FC3F7", "#AB47BC", "#66BB6A", "#EF5350",
    ];

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" style={{ flex: 1 }}>
                    {initial ? "Edit Character" : "New Character"}: {draft.name || "…"}
                </Text>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>

            <ModalContent style={{ padding: "20px", overflowY: "auto" }}>
                {/* Preview */}
                <ProfileCard profile={draft} username="You" isOwn={true} />

                <hr style={{ border: "none", borderTop: "1px solid var(--background-modifier-accent)", margin: "20px 0" }} />

                {/* Basic Info */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div style={fieldStyle}>
                        <label style={labelStyle}>Name *</label>
                        <TextInput value={draft.name} onChange={v => set("name", v)} placeholder="Character name" />
                    </div>
                    <div style={fieldStyle}>
                        <label style={labelStyle}>Pronouns</label>
                        <TextInput value={draft.pronouns} onChange={v => set("pronouns", v)} placeholder="e.g. she/her" />
                    </div>
                    <div style={fieldStyle}>
                        <label style={labelStyle}>Species / Race</label>
                        <TextInput value={draft.species} onChange={v => set("species", v)} placeholder="Human, Elf, Dragon…" />
                    </div>
                    <div style={fieldStyle}>
                        <label style={labelStyle}>Age</label>
                        <TextInput value={draft.age} onChange={v => set("age", v)} placeholder="Age or age range" />
                    </div>
                    <div style={fieldStyle}>
                        <label style={labelStyle}>Height</label>
                        <TextInput value={draft.height} onChange={v => set("height", v)} placeholder="e.g. 5'9\"" />
                    </div>
                    <div style={fieldStyle}>
                        <label style={labelStyle}>Occupation</label>
                        <TextInput value={draft.occupation} onChange={v => set("occupation", v)} placeholder="Mage, Rogue, Engineer…" />
                    </div>
                </div>

                <div style={fieldStyle}>
                    <label style={labelStyle}>Avatar Image URL</label>
                    <TextInput value={draft.avatarUrl} onChange={v => set("avatarUrl", v)} placeholder="https://i.imgur.com/..." />
                </div>

                {/* Accent colour */}
                <div style={fieldStyle}>
                    <label style={labelStyle}>Accent Color</label>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                        {colorPairs.map(c => (
                            <div
                                key={c}
                                onClick={() => set("accentColor", c)}
                                style={{
                                    width: "24px", height: "24px", borderRadius: "50%",
                                    background: c, cursor: "pointer",
                                    outline: draft.accentColor === c ? `3px solid white` : "none",
                                    outlineOffset: "2px",
                                }}
                            />
                        ))}
                        <input
                            type="color"
                            value={draft.accentColor}
                            onChange={e => set("accentColor", e.target.value)}
                            style={{ width: "28px", height: "28px", border: "none", background: "none", cursor: "pointer", padding: 0 }}
                        />
                        <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{draft.accentColor}</span>
                    </div>
                </div>

                {/* Tags */}
                <div style={fieldStyle}>
                    <label style={labelStyle}>Tags</label>
                    <TagInput tags={draft.tags} onChange={v => set("tags", v)} />
                </div>

                {/* Long-form fields */}
                <div style={fieldStyle}>
                    <label style={labelStyle}>Physical Description</label>
                    <TextArea
                        value={draft.description}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set("description", e.target.value)}
                        placeholder="Describe your character's appearance…"
                        rows={3}
                    />
                </div>
                <div style={fieldStyle}>
                    <label style={labelStyle}>Personality</label>
                    <TextArea
                        value={draft.personality}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set("personality", e.target.value)}
                        placeholder="How does your character act and feel?"
                        rows={3}
                    />
                </div>
                <div style={fieldStyle}>
                    <label style={labelStyle}>Backstory</label>
                    <TextArea
                        value={draft.backstory}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set("backstory", e.target.value)}
                        placeholder="Their history, origins, important events…"
                        rows={4}
                    />
                </div>

                {/* Custom fields */}
                <div style={fieldStyle}>
                    <label style={labelStyle}>Custom Fields</label>
                    <CustomFieldsEditor fields={draft.customFields} onChange={v => set("customFields", v)} />
                </div>
            </ModalContent>

            <ModalFooter>
                <Button onClick={modalProps.onClose} look={Button.Looks.LINK} color={Button.Colors.PRIMARY}>Cancel</Button>
                <Button
                    onClick={() => {
                        if (!draft.name.trim()) return alert("Character must have a name!");
                        onSave({ ...draft, updatedAt: Date.now() });
                        modalProps.onClose();
                    }}
                    color={Button.Colors.BRAND}
                >
                    Save Character
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

// ─── Profile Manager Modal ─────────────────────────────────────
// Lists all "my profiles" and lets user CRUD them + switch active

function ProfileManagerModal({ modalProps }: { modalProps: ModalProps }) {
    const [data, setData] = useState<PluginData>(getData);
    const [tab, setTab] = useState<"mine" | "saved">("mine");

    function persist(next: PluginData) { setData(next); saveData(next); }

    function openEditor(profile?: CharacterProfile) {
        openModal(p => (
            <ProfileEditorModal
                modalProps={p}
                initial={profile}
                onSave={saved => {
                    const fresh = getData();
                    const existing = fresh.myProfiles.findIndex(x => x.id === saved.id);
                    if (existing !== -1) {
                        fresh.myProfiles[existing] = saved;
                    } else {
                        fresh.myProfiles.push(saved);
                    }
                    persist(fresh);
                    setData({ ...fresh });
                }}
            />
        ));
    }

    function deleteProfile(id: string) {
        if (!confirm("Delete this character permanently?")) return;
        const next = getData();
        next.myProfiles = next.myProfiles.filter(p => p.id !== id);
        if (next.activeProfileId === id) next.activeProfileId = null;
        persist(next);
        setData({ ...next });
    }

    function setActive(id: string | null) {
        const next = getData();
        next.activeProfileId = id;
        persist(next);
        setData({ ...next });
    }

    function shareProfile(profile: CharacterProfile, channelId: string | null) {
        if (!channelId) { alert("Open a channel first, then use the chat bar button to share."); return; }
        const user = getCurrentUser();
        const msg = buildShareMessage(profile, user?.username ?? "Unknown");
        sendMessage(channelId, { content: msg });
    }

    function removeSaved(userId: string, profileId: string) {
        const next = getData();
        next.savedProfiles = next.savedProfiles.filter(
            s => !(s.userId === userId && s.profile.id === profileId)
        );
        persist(next);
        setData({ ...next });
    }

    const tabStyle = (active: boolean): React.CSSProperties => ({
        padding: "6px 16px",
        borderRadius: "6px",
        border: "none",
        cursor: "pointer",
        fontWeight: active ? 700 : 400,
        background: active ? "var(--brand-experiment)" : "var(--background-modifier-hover)",
        color: active ? "white" : "var(--text-normal)",
        fontSize: "13px",
    });

    const cardWrap: React.CSSProperties = {
        background: "var(--background-secondary)",
        border: "1px solid var(--background-modifier-accent)",
        borderRadius: "10px",
        padding: "12px",
        marginBottom: "10px",
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" style={{ flex: 1 }}>🎭 Roleplay Profiles</Text>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>

            <ModalContent style={{ padding: "16px", overflowY: "auto" }}>
                {/* Tabs */}
                <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
                    <button style={tabStyle(tab === "mine")} onClick={() => setTab("mine")}>
                        My Characters ({data.myProfiles.length})
                    </button>
                    <button style={tabStyle(tab === "saved")} onClick={() => setTab("saved")}>
                        Saved Profiles ({data.savedProfiles.length})
                    </button>
                </div>

                {/* MY CHARACTERS */}
                {tab === "mine" && (
                    <>
                        <Button
                            onClick={() => openEditor()}
                            color={Button.Colors.BRAND}
                            style={{ marginBottom: "14px", width: "100%" }}
                        >
                            ✦ Create New Character
                        </Button>

                        {data.myProfiles.length === 0 && (
                            <Text style={{ color: "var(--text-muted)", textAlign: "center", marginTop: "30px" }}>
                                No characters yet — create your first one!
                            </Text>
                        )}

                        {data.myProfiles.map(p => (
                            <div key={p.id} style={cardWrap}>
                                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                                    <div
                                        style={{
                                            width: "10px", height: "10px", borderRadius: "50%",
                                            background: p.accentColor || "#7B68EE", flexShrink: 0,
                                        }}
                                    />
                                    <span style={{ fontWeight: 600, fontSize: "14px", flex: 1, color: "var(--header-primary)" }}>
                                        {p.name}
                                    </span>
                                    {data.activeProfileId === p.id && (
                                        <span style={{
                                            background: "var(--brand-experiment)",
                                            color: "white",
                                            fontSize: "10px",
                                            padding: "2px 7px",
                                            borderRadius: "999px",
                                            fontWeight: 700,
                                        }}>ACTIVE</span>
                                    )}
                                </div>
                                <div style={{ color: "var(--text-muted)", fontSize: "12px", marginBottom: "8px" }}>
                                    {[p.species, p.pronouns, p.age].filter(Boolean).join(" · ")}
                                    {p.tags.length > 0 && (
                                        <span style={{ marginLeft: "6px" }}>
                                            {p.tags.map(t => `#${t}`).join(" ")}
                                        </span>
                                    )}
                                </div>
                                {p.description && (
                                    <div style={{ fontSize: "12px", color: "var(--text-normal)", marginBottom: "8px", lineClamp: "2" }}>
                                        {p.description.slice(0, 120)}{p.description.length > 120 ? "…" : ""}
                                    </div>
                                )}
                                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                    {data.activeProfileId !== p.id ? (
                                        <Button size={Button.Sizes.SMALL} color={Button.Colors.GREEN} onClick={() => setActive(p.id)}>
                                            Set Active
                                        </Button>
                                    ) : (
                                        <Button size={Button.Sizes.SMALL} look={Button.Looks.OUTLINED} onClick={() => setActive(null)}>
                                            Deactivate
                                        </Button>
                                    )}
                                    <Button size={Button.Sizes.SMALL} onClick={() => openEditor(p)}>Edit</Button>
                                    <Button size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={() => deleteProfile(p.id)}>Delete</Button>
                                </div>
                            </div>
                        ))}
                    </>
                )}

                {/* SAVED PROFILES FROM OTHERS */}
                {tab === "saved" && (
                    <>
                        {data.savedProfiles.length === 0 && (
                            <Text style={{ color: "var(--text-muted)", textAlign: "center", marginTop: "30px" }}>
                                No saved profiles yet.<br />When other plugin users share a profile in chat, you can save it here.
                            </Text>
                        )}
                        {data.savedProfiles.map((s, i) => (
                            <div key={i} style={cardWrap}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                                        From: <strong>{s.username}</strong> · Saved {new Date(s.savedAt).toLocaleDateString()}
                                    </span>
                                    <Button
                                        size={Button.Sizes.SMALL}
                                        color={Button.Colors.RED}
                                        look={Button.Looks.LINK}
                                        onClick={() => removeSaved(s.userId, s.profile.id)}
                                    >Remove</Button>
                                </div>
                                <ProfileCard profile={s.profile} username={s.username} compact={settings.store.compactCards} />
                            </div>
                        ))}
                    </>
                )}
            </ModalContent>
        </ModalRoot>
    );
}

// ─── Message Accessory: renders profile cards in chat ──────────

function RPMessageAccessory({ message }: { message: any }) {
    const extracted = extractProfile(message.content);
    if (!extracted) return null;

    const { profile, username } = extracted;
    const me = getCurrentUser();
    const isOwn = me?.id === message.author.id;

    function handleSave() {
        const next = getData();
        const already = next.savedProfiles.find(
            s => s.userId === message.author.id && s.profile.id === profile.id
        );
        if (already) { alert("Profile already saved!"); return; }
        next.savedProfiles.push({
            userId: message.author.id,
            username: message.author.username,
            profile,
            savedAt: Date.now(),
        });
        saveData(next);
        alert(`✅ Saved profile: ${profile.name}`);
    }

    return (
        <ProfileCard
            profile={profile}
            username={username}
            isOwn={isOwn}
            compact={settings.store.compactCards}
            onSave={isOwn ? undefined : handleSave}
        />
    );
}

// ─── Chat Bar Button ───────────────────────────────────────────

function RPChatBarButton({ channelId }: { channelId: string }) {
    const data = getData();
    const activeProfile = data.myProfiles.find(p => p.id === data.activeProfileId);

    return (
        <Tooltip text={activeProfile ? `Share: ${activeProfile.name}` : "Roleplay Profiles"}>
            {({ onMouseEnter, onMouseLeave }: any) => (
                <button
                    onMouseEnter={onMouseEnter}
                    onMouseLeave={onMouseLeave}
                    style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: "4px",
                        borderRadius: "4px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: activeProfile ? (activeProfile.accentColor || "#7B68EE") : "var(--interactive-normal)",
                        fontSize: "20px",
                        lineHeight: 1,
                        transition: "color 0.15s",
                    }}
                    onClick={() => {
                        if (activeProfile) {
                            // Quick-share active profile
                            const user = getCurrentUser();
                            const msg = buildShareMessage(activeProfile, user?.username ?? "Unknown");
                            sendMessage(channelId, { content: msg });
                        } else {
                            openModal(p => <ProfileManagerModal modalProps={p} />);
                        }
                    }}
                    onContextMenu={e => {
                        e.preventDefault();
                        openModal(p => <ProfileManagerModal modalProps={p} />);
                    }}
                    title="Left-click to share active profile · Right-click to manage profiles"
                >
                    🎭
                </button>
            )}
        </Tooltip>
    );
}

// ─── User Context Menu Patch ───────────────────────────────────

const userCtxMenuPatch: NavContextMenuPatchCallback = (children, { user }: { user?: any }) => {
    if (!user) return;
    const data = getData();
    const userSaved = data.savedProfiles.filter(s => s.userId === user.id);
    if (userSaved.length === 0) return;

    children.push(
        <Menu.MenuSeparator key="rp-sep" />,
        <Menu.MenuItem
            key="rp-view"
            id="rp-view-profiles"
            label={`🎭 View RP Profiles (${userSaved.length})`}
        >
            {userSaved.map((s, i) => (
                <Menu.MenuItem
                    key={i}
                    id={`rp-profile-${i}`}
                    label={s.profile.name || "Unnamed"}
                    action={() => openModal(p => (
                        <ModalRoot {...p} size={ModalSize.MEDIUM}>
                            <ModalHeader>
                                <Text variant="heading-md/semibold" style={{ flex: 1 }}>
                                    {s.profile.name} — {s.username}
                                </Text>
                                <ModalCloseButton onClick={p.onClose} />
                            </ModalHeader>
                            <ModalContent style={{ padding: "16px" }}>
                                <ProfileCard profile={s.profile} username={s.username} />
                            </ModalContent>
                        </ModalRoot>
                    ))}
                />
            ))}
        </Menu.MenuItem>
    );
};

// ══════════════════════════════════════════════════════════════
// PLUGIN DEFINITION
// ══════════════════════════════════════════════════════════════

export default definePlugin({
    name: "RoleplayProfiles",
    description: "Create multiple RP character profiles, share them in chat, and view other plugin users' profiles as formatted cards.",
    authors: [
        { id: 0n, name: "YourName" }, // ← replace with your Devs entry
    ],
    dependencies: ["ChatButtonsAPI", "MessageAccessoriesAPI"],
    settings,

    start() {
        // Register the chat bar button
        addChatBarButton("RoleplayProfiles", RPChatBarButton);

        // Register the message accessory (renders profile cards in chat)
        addMessageAccessory("RoleplayProfiles", (props: { message: any }) => (
            <RPMessageAccessory message={props.message} />
        ), 1 /* priority */);

        // Context menu on users
        addContextMenuPatch("user-context", userCtxMenuPatch);
        addContextMenuPatch("user-profile-actions", userCtxMenuPatch);
    },

    stop() {
        removeChatBarButton("RoleplayProfiles");
        removeMessageAccessory("RoleplayProfiles");
        removeContextMenuPatch("user-context", userCtxMenuPatch);
        removeContextMenuPatch("user-profile-actions", userCtxMenuPatch);
    },
});