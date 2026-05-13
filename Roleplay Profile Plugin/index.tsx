/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Plugin: RoleplayProfiles
 * Author: Magpie512
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
    useEffect,
    useState,
} from "@webpack/common";
import { getCurrentUser, sendMessage } from "@utils/discord";
import { findByProps } from "@webpack";

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

function saveData(data: PluginData) { settings.store.data = JSON.stringify(data); }

function buildShareMessage(profile: CharacterProfile, username: string): string {
    const dataPayload = btoa(unescape(encodeURIComponent(JSON.stringify({ profile, username }))));
    return `━━━━━━━━━━━━ 🎭 Character Profile ━━━━━━━━━━━━\n**${profile.name}**\n*Shared by ${username}*\n\n${RP_MARKER}${dataPayload}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

function extractProfile(content: string): { profile: CharacterProfile; username: string } | null {
    const idx = content.indexOf(RP_MARKER);
    if (idx === -1) return null;
    try {
        const raw = content.slice(idx + RP_MARKER.length).split(/\s/)[0];
        return JSON.parse(decodeURIComponent(escape(atob(raw))));
    } catch { return null; }
}

function hexToRgba(hex: string, alpha: number) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

// ══════════════════════════════════════════════════════════════
// COMPONENTS
// ══════════════════════════════════════════════════════════════

function ProfileCard({ profile, username, compact, onSave, onShare, isOwn }: any) {
    const accent = profile.accentColor || "#7B68EE";
    const [expanded, setExpanded] = useState(!compact);

    return (
        <div style={{
            background: `linear-gradient(135deg, ${hexToRgba(accent, 0.08)} 0%, var(--background-secondary) 100%)`,
            border: `1.5px solid ${hexToRgba(accent, 0.4)}`,
            borderRadius: "12px", padding: "14px 16px", marginTop: "6px", maxWidth: "520px", position: "relative", overflow: "hidden"
        }}>
            <div style={{ position: "absolute", top: 0, left: 0, width: "4px", height: "100%", background: accent }} />
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                {profile.avatarUrl ? <img src={profile.avatarUrl} style={{ width: "52px", height: "52px", borderRadius: "50%", border: `2px solid ${accent}`, objectFit: "cover" }} /> : <div style={{ width: "52px", height: "52px", borderRadius: "50%", background: hexToRgba(accent, 0.2), display: "flex", justifyContent: "center", alignItems: "center", fontSize: "22px" }}>🎭</div>}
                <div>
                    <div style={{ color: "var(--header-primary)", fontWeight: 700, fontSize: "16px" }}>{profile.name} {profile.pronouns && <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: "13px" }}>({profile.pronouns})</span>}</div>
                    <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>{[profile.species, profile.age, profile.occupation].filter(Boolean).join(" · ")}</div>
                </div>
            </div>
            
            {compact && <Button size={Button.Sizes.TINY} look={Button.Looks.LINK} onClick={() => setExpanded(!expanded)}>{expanded ? "Show Less" : "Show More"}</Button>}

            {expanded && (
                <div style={{ marginTop: "10px", borderTop: `1px solid ${hexToRgba(accent, 0.15)}`, paddingTop: "10px", fontSize: "13px" }}>
                    {profile.description && <div style={{ marginBottom: "8px" }}><strong>Description:</strong> {profile.description}</div>}
                    {profile.backstory && <div style={{ marginBottom: "8px" }}><strong>Backstory:</strong> {profile.backstory}</div>}
                    {profile.customFields.map((f: any, i: number) => f.key && <div key={i}><strong>{f.key}:</strong> {f.value}</div>)}
                </div>
            )}

            <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                {!isOwn && onSave && <Button size={Button.Sizes.TINY} onClick={onSave}>⭐ Save Profile</Button>}
                {isOwn && onShare && <Button size={Button.Sizes.TINY} onClick={onShare}>📤 Share</Button>}
            </div>
        </div>
    );
}

// ══════════════════════════════════════════════════════════════
// MODALS (Manager & Editor)
// ══════════════════════════════════════════════════════════════

function ProfileManagerModal({ modalProps }: { modalProps: ModalProps }) {
    const [data, setData] = useState(getData());
    const [tab, setTab] = useState<"mine" | "saved">("mine");

    const refresh = () => setData(getData());
    const setActive = (id: string | null) => {
        const d = getData(); d.activeProfileId = id; saveData(d); refresh();
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader><Text variant="heading-lg/semibold">🎭 Roleplay Profiles</Text><ModalCloseButton onClick={modalProps.onClose} /></ModalHeader>
            <ModalContent style={{ padding: "16px" }}>
                <div style={{ display: "flex", gap: "10px", marginBottom: "15px" }}>
                    <Button look={tab === "mine" ? Button.Looks.FILLED : Button.Looks.OUTLINED} onClick={() => setTab("mine")}>My Characters</Button>
                    <Button look={tab === "saved" ? Button.Looks.FILLED : Button.Looks.OUTLINED} onClick={() => setTab("saved")}>Library</Button>
                </div>
                {tab === "mine" && (
                    <>
                        <Button color={Button.Colors.BRAND} style={{ width: "100%", marginBottom: "10px" }} onClick={() => openModal(p => <ProfileEditorModal modalProps={p} onSave={() => { refresh(); }} />)}>+ Create New Character</Button>
                        {data.myProfiles.map(p => (
                            <div key={p.id} style={{ background: "var(--background-secondary)", padding: "10px", borderRadius: "8px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div><Text variant="text-md/bold">{p.name}</Text><Text variant="text-xs/normal" color="text-muted">{p.species}</Text></div>
                                <div style={{ display: "flex", gap: "5px" }}>
                                    <Button size={Button.Sizes.TINY} color={data.activeProfileId === p.id ? Button.Colors.GREEN : Button.Colors.PRIMARY} onClick={() => setActive(data.activeProfileId === p.id ? null : p.id)}>{data.activeProfileId === p.id ? "Active" : "Set Active"}</Button>
                                    <Button size={Button.Sizes.TINY} onClick={() => openModal(m => <ProfileEditorModal modalProps={m} initial={p} onSave={refresh} />)}>Edit</Button>
                                </div>
                            </div>
                        ))}
                    </>
                )}
            </ModalContent>
        </ModalRoot>
    );
}

// Logic for the ProfileEditorModal is condensed for brevity but follows the standard Vencord UI patterns for Inputs/TextAreas.
function ProfileEditorModal({ modalProps, initial, onSave }: any) {
    const [draft, setDraft] = useState(initial || { ...DEFAULT_PROFILE, id: `rp_${Date.now()}`, createdAt: Date.now(), updatedAt: Date.now(), tags: [], customFields: [] });
    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE}>
            <ModalHeader><Text variant="heading-lg/semibold">{initial ? "Edit" : "New"} Character</Text></ModalHeader>
            <ModalContent style={{ padding: "20px" }}>
                <TextInput value={draft.name} onChange={v => setDraft({ ...draft, name: v })} placeholder="Name" style={{ marginBottom: "10px" }} />
                <TextInput value={draft.avatarUrl} onChange={v => setDraft({ ...draft, avatarUrl: v })} placeholder="Avatar URL" style={{ marginBottom: "10px" }} />
                <TextArea value={draft.description} onChange={(e: any) => setDraft({ ...draft, description: e.target.value })} placeholder="Description" />
            </ModalContent>
            <ModalFooter>
                <Button onClick={() => {
                    const d = getData();
                    const idx = d.myProfiles.findIndex(p => p.id === draft.id);
                    if (idx > -1) d.myProfiles[idx] = draft; else d.myProfiles.push(draft);
                    saveData(d); onSave(); modalProps.onClose();
                }}>Save</Button>
            </ModalFooter>
        </ModalRoot>
    );
}

// ══════════════════════════════════════════════════════════════
// PLUGIN CORE
// ══════════════════════════════════════════════════════════════

export default definePlugin({
    name: "RoleplayProfiles",
    description: "Manage multiple RP profiles and override your avatar client-side.",
    authors: [Devs.YourName],
    onLoad() {
        // --- 1. Client-Side Avatar Override ---
        const UserStore = findByProps("getCurrentUser", "getUser");
        if (UserStore?.default?.prototype) {
            const original = UserStore.default.prototype.getAvatarURL;
            UserStore.default.prototype.getAvatarURL = function (guildId: any, size: any, canAnimate: any) {
                const data = getData();
                const active = data.myProfiles.find(p => p.id === data.activeProfileId);
                if (this.id === getCurrentUser()?.id && active?.avatarUrl) return active.avatarUrl;
                return original.call(this, guildId, size, canAnimate);
            };
        }

        // --- 2. Message Accessory (Card Rendering) ---
        addMessageAccessory(msg => {
            const extracted = extractProfile(msg.content);
            if (!extracted) return null;
            const currentUser = getCurrentUser();
            return (
                <ProfileCard 
                    profile={extracted.profile} 
                    username={extracted.username} 
                    isOwn={msg.author.id === currentUser?.id}
                    onSave={() => {
                        const d = getData();
                        if (!d.savedProfiles.find(s => s.profile.id === extracted.profile.id)) {
                            d.savedProfiles.push({ userId: msg.author.id, username: extracted.username, profile: extracted.profile, savedAt: Date.now() });
                            saveData(d);
                            alert("Profile saved to library!");
                        }
                    }}
                />
            );
        });

        // --- 3. Chat Bar Button ---
        addChatBarButton({
            id: "rp-profiles",
            icon: () => <span style={{ fontSize: "20px" }}>🎭</span>,
            tooltip: "Character Profiles",
            onClick: () => openModal(p => <ProfileManagerModal modalProps={p} />)
        });
    },
    onUnload() {
        removeMessageAccessory();
        removeChatBarButton("rp-profiles");
    },
    settings
});
