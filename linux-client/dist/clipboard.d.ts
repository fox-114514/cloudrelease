export interface ClipboardCommand {
    command: "wl-copy" | "xclip";
    args: string[];
}
export interface ClipboardResult {
    tool: ClipboardCommand["command"];
}
/**
 * Prefer the clipboard implementation native to the active desktop session,
 * while retaining the other implementation as a fallback for mixed
 * Wayland/XWayland sessions.
 */
export declare function clipboardCommands(mimeType: string, env?: NodeJS.ProcessEnv): ClipboardCommand[];
export declare function copyImageToClipboard(filePath: string, mimeType: string): Promise<ClipboardResult>;
//# sourceMappingURL=clipboard.d.ts.map