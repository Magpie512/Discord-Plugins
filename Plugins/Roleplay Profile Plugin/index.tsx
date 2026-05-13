/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Plugin: RoleplayProfiles
 * Author: mg.pie
 *
 * Allows users to create multiple RP character profiles, share them
 * as Discord messages, and have other plugin users see them as
 * rendered profile cards.
 */

import { addChatBarButton, removeChatBarButton } from "@api/ChatButtons";
import { addMessageAccessory, removeMessageAccessory } from "@api/MessageAccessories";
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
    React,
    Text,
    TextArea,
    TextInput,
    Toasts,
    useCallback,
    useEffect,
    useState,
} from "@webpack/common";
import { getCurrentUser } from "@webpack/common";
import { findByProps } from "@webpack";
import { instead } from "@utils/monkeyPatch";

// ══════════════════════════════════════════════════════════════
// TYPES & CONSTANTS
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
    accentColor: string;
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
    savedProfiles: SavedProfile[];
}

const RP_MARKER = "RP_CARD:";
const ACCESSORY_KEY = "rp-profile-card";
const DEFAULT_DATA: PluginData = { myProfiles: [], activeProfileId: null, savedProfiles: [] };
const DEFAULT_PROFILE: Omit<CharacterProfile, "id" | "createdAt" | "updatedAt"> = {
    name: "", pronouns: "", species: "", age: "", height: "", occupation: "",
    description: "", personality: "", backstory: "", avatarUrl: "",
    accentColor: "#7B68EE", tags: [], customFields: [],
};

// ══════════════════════════════════════════════════════════════
// SETTINGS & DATA HELPERS
// ══════════════════════════════════════════════════════════════

const settings = definePluginSettings({
    data: {
        type: OptionType.STRING,
        description: "JSON Data",
        default: JSON.stringify(DEFAULT_DATA),
        hidden: true,
    },
    showShareButton: {
        type: OptionType.BOOLEAN,
        description: "Show share button on your own cards",
        default: true,
    },
    compactCards: {
        type: OptionType.BOOLEAN,
        description: "Use compact view by default",
        default: false,
    },
});

function getData(): PluginData {
    try { return JSON.parse(settings.store.data); }
    catch { return { ...DEFAULT_DATA }; }
}

function saveData(data: PluginData) {
    settings.store.data = JSON.stringify(data);
}

/**
 * Read-modify-write helper. Accepts an updater function so callers
 * never have to remember to call saveData() themselves.
 */
function updateData(updater: (d: PluginData) => void): PluginData {
    const d = getData();
    updater(d);
    saveData(d);
    return d;
}

function newProfileId() { return `rp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

function buildShareMessage(profile: CharacterProfile, username: string): string {
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ profile, username }))));
    return `━━━━━━━━━━━━ 🎭 Character Profile ━━━━━━━━━━━━\n**${profile.name}**\n*Shared by ${username}*\n\n${RP_MARKER}${payload}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

function extractProfile(content: string): { profile: CharacterProfile; username: string } | null {
    const idx = content.indexOf(RP_MARKER);
    if (idx === -1) return null;
    try {
        const raw = content.slice(idx + RP_MARKER.length).split(/\s/)[0];
        return JSON.parse(decodeURIComponent(escape(atob(raw))));
    } catch { return null; }
}

function hexToRgba(hex: string, alpha: number): string {
    const n = parseInt(hex.replace("#", ""), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// ══════════════════════════════════════════════════════════════
// COMPONENTS
// ══════════════════════════════════════════════════════════════

interface ProfileCardProps {
    profile: CharacterProfile;
    username: string;
    compact?: boolean;
    onSave?: () => void;
    onShare?: () => void;
    isOwn: boolean;
}

function ProfileCard({ profile, username, compact, onSave, onShare, isOwn }: ProfileCardProps) {
    const accent = profile.accentColor || "#7B68EE";
    const [expanded, setExpanded] = useState(!compact);

    return (
        <div style={{
            background: `linear-gradient(135deg, ${hexToRgba(accent, 0.08)} 0%, var(--background-secondary) 100%)`,
            border: `1.5px solid ${hexToRgba(accent, 0.4)}`,
            borderRadius: "12px", padding: "14px 16px", marginTop: "6px",
            maxWidth: "520px", position: "relative", overflow: "hidden",
        }}>
            {/* Accent bar */}
            <div style={{ position: "absolute", top: 0, left: 0, width: "4px", height: "100%", background: accent }} />

            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                {profile.avatarUrl
                    ? <img src={profile.avatarUrl} alt={profile.name} style={{ width: "52px", height: "52px", borderRadius: "50%", border: `2px solid ${accent}`, objectFit: "cover" }} />
                    : <div style={{ width: "52px", height: "52px", borderRadius: "50%", background: hexToRgba(accent, 0.2), display: "flex", justifyContent: "center", alignItems: "center", fontSize: "22px" }}>🎭</div>
                }
                <div>
                    <div style={{ color: "var(--header-primary)", fontWeight: 700, fontSize: "16px" }}>
                        {profile.name}{" "}
                        {profile.pronouns && <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: "13px" }}>({profile.pronouns})</span>}
                    </div>
                    <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>
                        {[profile.species, profile.age && `Age ${profile.age}`, profile.height, profile.occupation].filter(Boolean).join(" · ")}
                    </div>
                    <div style={{ color: "var(--text-muted)", fontSize: "11px", marginTop: "2px" }}>Shared by {username}</div>
                </div>
            </div>

            {compact && (
                <Button size={Button.Sizes.TINY} look={Button.Looks.LINK} onClick={() => setExpanded(e => !e)}>
                    {expanded ? "▲ Show Less" : "▼ Show More"}
                </Button>
            )}

            {expanded && (
                <div style={{ marginTop: "10px", borderTop: `1px solid ${hexToRgba(accent, 0.15)}`, paddingTop: "10px", fontSize: "13px", display: "flex", flexDirection: "column", gap: "6px" }}>
                    {profile.description && <div><strong>Description:</strong> {profile.description}</div>}
                    {profile.personality && <div><strong>Personality:</strong> {profile.personality}</div>}
                    {profile.backstory && <div><strong>Backstory:</strong> {profile.backstory}</div>}
                    {profile.customFields.filter(f => f.key).map((f, i) => (
                        <div key={i}><strong>{f.key}:</strong> {f.value}</div>
                    ))}
                    {profile.tags.length > 0 && (
                        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "4px" }}>
                            {profile.tags.map((tag, i) => (
                                <span key={i} style={{ background: hexToRgba(accent, 0.2), color: accent, borderRadius: "999px", padding: "1px 8px", fontSize: "11px" }}>{tag}</span>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                {!isOwn && onSave && <Button size={Button.Sizes.TINY} onClick={onSave}>⭐ Save Profile</Button>}
                {isOwn && onShare && settings.store.showShareButton && <Button size={Button.Sizes.TINY} onClick={onShare}>📤 Re-share</Button>}
            </div>
        </div>
    );
}

// ══════════════════════════════════════════════════════════════
// MODALS
// ══════════════════════════════════════════════════════════════

function ProfileManagerModal({ modalProps }: { modalProps: ModalProps }) {
    const [data, setData] = useState(getData());
    const [tab, setTab] = useState<"mine" | "saved">("mine");

    const refresh = useCallback(() => setData(getData()), []);

    const setActive = (id: string | null) => {
        updateData(d => { d.activeProfileId = id; });
        refresh();
    };

    const deleteProfile = (id: string) => {
        updateData(d => { d.myProfiles = d.myProfiles.filter(p => p.id !== id); if (d.activeProfileId === id) d.activeProfileId = null; });
        refresh();
    };

    const deleteSaved = (profileId: string) => {
        updateData(d => { d.savedProfiles = d.savedProfiles.filter(s => s.profile.id !== profileId); });
        refresh();
    };

    const openEditor = (initial?: CharacterProfile) =>
        openModal(p => <ProfileEditorModal modalProps={p} initial={initial} onSave={refresh} />);

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader>
                <Text variant="heading-lg/semibold">🎭 Roleplay Profiles</Text>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent style={{ padding: "16px" }}>
                <div style={{ display: "flex", gap: "10px", marginBottom: "15px" }}>
                    <Button look={tab === "mine" ? Button.Looks.FILLED : Button.Looks.OUTLINED} onClick={() => setTab("mine")}>My Characters</Button>
                    <Button look={tab === "saved" ? Button.Looks.FILLED : Button.Looks.OUTLINED} onClick={() => setTab("saved")}>Library ({data.savedProfiles.length})</Button>
                </div>

                {tab === "mine" && (
                    <>
                        <Button color={Button.Colors.BRAND} style={{ width: "100%", marginBottom: "10px" }} onClick={() => openEditor()}>
                            + Create New Character
                        </Button>
                        {data.myProfiles.length === 0 && (
                            <Text variant="text-sm/normal" color="text-muted" style={{ textAlign: "center", padding: "20px 0" }}>
                                No characters yet. Create one above!
                            </Text>
                        )}
                        {data.myProfiles.map(p => (
                            <div key={p.id} style={{ background: "var(--background-secondary)", padding: "10px 12px", borderRadius: "8px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", borderLeft: `3px solid ${p.accentColor || "#7B68EE"}` }}>
                                <div>
                                    <Text variant="text-md/bold">{p.name || "(Unnamed)"}</Text>
                                    <Text variant="text-xs/normal" color="text-muted">{[p.species, p.pronouns].filter(Boolean).join(" · ") || "No details"}</Text>
                                </div>
                                <div style={{ display: "flex", gap: "5px" }}>
                                    <Button
                                        size={Button.Sizes.TINY}
                                        color={data.activeProfileId === p.id ? Button.Colors.GREEN : Button.Colors.PRIMARY}
                                        onClick={() => setActive(data.activeProfileId === p.id ? null : p.id)}
                                    >
                                        {data.activeProfileId === p.id ? "✓ Active" : "Set Active"}
                                    </Button>
                                    <Button size={Button.Sizes.TINY} onClick={() => openEditor(p)}>Edit</Button>
                                    <Button size={Button.Sizes.TINY} color={Button.Colors.RED} onClick={() => deleteProfile(p.id)}>Delete</Button>
                                </div>
                            </div>
                        ))}
                    </>
                )}

                {tab === "saved" && (
                    <>
                        {data.savedProfiles.length === 0 && (
                            <Text variant="text-sm/normal" color="text-muted" style={{ textAlign: "center", padding: "20px 0" }}>
                                No saved profiles yet. Save profiles from chat cards!
                            </Text>
                        )}
                        {data.savedProfiles.map(s => (
                            <div key={s.profile.id} style={{ background: "var(--background-secondary)", padding: "10px 12px", borderRadius: "8px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", borderLeft: `3px solid ${s.profile.accentColor || "#7B68EE"}` }}>
                                <div>
                                    <Text variant="text-md/bold">{s.profile.name || "(Unnamed)"}</Text>
                                    <Text variant="text-xs/normal" color="text-muted">by {s.username}</Text>
                                </div>
                                <Button size={Button.Sizes.TINY} color={Button.Colors.RED} onClick={() => deleteSaved(s.profile.id)}>Remove</Button>
                            </div>
                        ))}
                    </>
                )}
            </ModalContent>
        </ModalRoot>
    );
}

function ProfileEditorModal({ modalProps, initial, onSave }: { modalProps: ModalProps; initial?: CharacterProfile; onSave: () => void; }) {
    const makeBlank = (): CharacterProfile => ({
        ...DEFAULT_PROFILE,
        id: newProfileId(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tags: [],
        customFields: [{ key: "", value: "" }],
    });

    const [draft, setDraft] = useState<CharacterProfile>(initial ? { ...initial } : makeBlank());
    const [tagInput, setTagInput] = useState(draft.tags.join(", "));

    const set = <K extends keyof CharacterProfile>(key: K, value: CharacterProfile[K]) =>
        setDraft(d => ({ ...d, [key]: value, updatedAt: Date.now() }));

    const addCustomField = () => setDraft(d => ({ ...d, customFields: [...d.customFields, { key: "", value: "" }] }));
    const removeCustomField = (i: number) => setDraft(d => ({ ...d, customFields: d.customFields.filter((_, idx) => idx !== i) }));
    const updateCustomField = (i: number, part: Partial<CustomField>) =>
        setDraft(d => ({ ...d, customFields: d.customFields.map((f, idx) => idx === i ? { ...f, ...part } : f) }));

    const handleSave = () => {
        const final = { ...draft, tags: tagInput.split(",").map(t => t.trim()).filter(Boolean) };
        updateData(d => {
            const idx = d.myProfiles.findIndex(p => p.id === final.id);
            if (idx > -1) d.myProfiles[idx] = final; else d.myProfiles.push(final);
        });
        onSave();
        modalProps.onClose();
    };

    const field = (label: string, key: keyof CharacterProfile, placeholder?: string) => (
        <div style={{ marginBottom: "10px" }}>
            <Text variant="text-xs/semibold" color="text-muted" style={{ marginBottom: "4px" }}>{label.toUpperCase()}</Text>
            <TextInput value={String(draft[key] ?? "")} onChange={(v: string) => set(key, v as any)} placeholder={placeholder ?? label} />
        </div>
    );

    const textarea = (label: string, key: keyof CharacterProfile, rows = 3) => (
        <div style={{ marginBottom: "10px" }}>
            <Text variant="text-xs/semibold" color="text-muted" style={{ marginBottom: "4px" }}>{label.toUpperCase()}</Text>
            <TextArea value={String(draft[key] ?? "")} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set(key, e.target.value as any)} placeholder={label} rows={rows} />
        </div>
    );

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE}>
            <ModalHeader>
                <Text variant="heading-lg/semibold">{initial ? "Edit" : "New"} Character</Text>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "2px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
                    {field("Name", "name")}
                    {field("Pronouns", "pronouns", "e.g. she/her")}
                    {field("Species / Race", "species")}
                    {field("Age", "age")}
                    {field("Height", "height", "e.g. 5'8\"")}
                    {field("Occupation", "occupation")}
                </div>

                {field("Avatar URL", "avatarUrl", "https://...")}

                <div style={{ marginBottom: "10px" }}>
                    <Text variant="text-xs/semibold" color="text-muted" style={{ marginBottom: "4px" }}>ACCENT COLOR</Text>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <input type="color" value={draft.accentColor} onChange={e => set("accentColor", e.target.value)} style={{ width: "40px", height: "32px", border: "none", cursor: "pointer", background: "none" }} />
                        <TextInput value={draft.accentColor} onChange={(v: string) => set("accentColor", v)} style={{ flex: 1 }} />
                    </div>
                </div>

                {textarea("Description", "description")}
                {textarea("Personality", "personality")}
                {textarea("Backstory", "backstory", 4)}

                <div style={{ marginBottom: "10px" }}>
                    <Text variant="text-xs/semibold" color="text-muted" style={{ marginBottom: "4px" }}>TAGS (comma-separated)</Text>
                    <TextInput value={tagInput} onChange={(v: string) => setTagInput(v)} placeholder="e.g. mage, tragic, loner" />
                </div>

                <div style={{ marginBottom: "10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                        <Text variant="text-xs/semibold" color="text-muted">CUSTOM FIELDS</Text>
                        <Button size={Button.Sizes.TINY} onClick={addCustomField}>+ Add Field</Button>
                    </div>
                    {draft.customFields.map((f, i) => (
                        <div key={i} style={{ display: "flex", gap: "6px", marginBottom: "6px", alignItems: "center" }}>
                            <TextInput value={f.key} onChange={(v: string) => updateCustomField(i, { key: v })} placeholder="Field name" style={{ flex: "0 0 35%" }} />
                            <TextInput value={f.value} onChange={(v: string) => updateCustomField(i, { value: v })} placeholder="Value" style={{ flex: 1 }} />
                            <Button size={Button.Sizes.TINY} color={Button.Colors.RED} onClick={() => removeCustomField(i)}>✕</Button>
                        </div>
                    ))}
                </div>
            </ModalContent>
            <ModalFooter>
                <Button color={Button.Colors.BRAND} onClick={handleSave}>Save Character</Button>
                <Button look={Button.Looks.LINK} onClick={modalProps.onClose}>Cancel</Button>
            </ModalFooter>
        </ModalRoot>
    );
}

// ══════════════════════════════════════════════════════════════
// CHAT BAR BUTTON COMPONENT
// ══════════════════════════════════════════════════════════════

function RpChatBarButton() {
    const data = getData();
    const hasActive = data.activeProfileId != null;
    return (
        <Button
            look={Button.Looks.BLANK}
            size={Button.Sizes.NONE}
            tooltip="Character Profiles"
            onClick={() => openModal(p => <ProfileManagerModal modalProps={p} />)}
            style={{ opacity: hasActive ? 1 : 0.6, transition: "opacity 0.15s" }}
        >
            <span style={{ fontSize: "20px" }}>🎭</span>
        </Button>
    );
}

// ══════════════════════════════════════════════════════════════
// PLUGIN CORE
// ══════════════════════════════════════════════════════════════

let avatarPatch: (() => void) | undefined;

export default definePlugin({
    name: "RoleplayProfiles",
    description: "Manage multiple RP profiles, render character cards in chat, and override your avatar client-side.",
    authors: [{ name: "mg.pie", id: 0n }],

    onLoad() {
        // --- 1. Client-Side Avatar Override (via monkeyPatch instead of prototype mutation) ---
        const UserStore = findByProps("getCurrentUser", "getUser");
        if (UserStore) {
            avatarPatch = instead("getAvatarURL", UserStore, function (args, original) {
                const data = getData();
                const active = data.myProfiles.find(p => p.id === data.activeProfileId);
                // @ts-ignore – `this` is the User object
                if (this?.id === getCurrentUser()?.id && active?.avatarUrl) return active.avatarUrl;
                return original.apply(this, args);
            });
        }

        // --- 2. Message Accessory (Card Rendering) ---
        addMessageAccessory(ACCESSORY_KEY, msg => {
            const extracted = extractProfile(msg.content);
            if (!extracted) return null;
            const currentUser = getCurrentUser();
            const isOwn = msg.author.id === currentUser?.id;

            return (
                <ProfileCard
                    profile={extracted.profile}
                    username={extracted.username}
                    compact={settings.store.compactCards}
                    isOwn={isOwn}
                    onSave={isOwn ? undefined : () => {
                        const alreadySaved = getData().savedProfiles.some(s => s.profile.id === extracted.profile.id);
                        if (alreadySaved) {
                            Toasts.show({ message: "Already in your library.", type: Toasts.Type.MESSAGE });
                            return;
                        }
                        updateData(d => {
                            d.savedProfiles.push({
                                userId: msg.author.id,
                                username: extracted.username,
                                profile: extracted.profile,
                                savedAt: Date.now(),
                            });
                        });
                        Toasts.show({ message: `Saved "${extracted.profile.name}" to library!`, type: Toasts.Type.SUCCESS });
                    }}
                    onShare={isOwn ? () => {
                        const chan = findByProps("getChannelId")?.getChannelId?.();
                        if (!chan) return;
                        const msg = buildShareMessage(extracted.profile, getCurrentUser()?.username ?? "Unknown");
                        findByProps("sendMessage")?.sendMessage(chan, { content: msg });
                    } : undefined}
                />
            );
        });

        // --- 3. Chat Bar Button ---
        addChatBarButton("rp-profiles", RpChatBarButton);
    },

    onUnload() {
        avatarPatch?.();
        removeMessageAccessory(ACCESSORY_KEY);
        removeChatBarButton("rp-profiles");
    },

    settings,
});
