/**
 * Daftar aksi Activity Log + labelnya untuk UI.
 *
 * Dipisah dari `lib/api/activity.ts` (yang berisi query server) supaya komponen
 * client bisa memakai label & tipe aksinya tanpa ikut menarik modul server.
 */

export type ActivityAction =
  | "password_change"
  | "sessions_revoke"
  | "api_key_create"
  | "api_key_revoke"
  | "settings_update"
  | "credit_topup"
  | "credit_adjust"
  | "telegram_connect"
  | "telegram_disconnect"
  | "telegram_webhook"
  | "telegram_link"
  | "telegram_unlink"
  /** Kejadian keamanan lain: percobaan ganti password dengan password lama salah, dsb. */
  | "security";

export const ACTIVITY_ACTIONS: readonly ActivityAction[] = [
  "password_change",
  "sessions_revoke",
  "api_key_create",
  "api_key_revoke",
  "settings_update",
  "credit_topup",
  "credit_adjust",
  "telegram_connect",
  "telegram_disconnect",
  "telegram_webhook",
  "telegram_link",
  "telegram_unlink",
  "security",
] as const;

/** Label aksi untuk tabel & export CSV. */
export const ACTIVITY_ACTION_LABEL: Record<string, string> = {
  password_change: "Ganti password",
  sessions_revoke: "Putus sesi",
  api_key_create: "Buat API key",
  api_key_revoke: "Cabut API key",
  settings_update: "Ubah pengaturan sistem",
  credit_topup: "Topup credit",
  credit_adjust: "Penyesuaian credit",
  telegram_connect: "Hubungkan bot Telegram",
  telegram_disconnect: "Putuskan bot Telegram",
  telegram_webhook: "Pasang webhook Telegram",
  telegram_link: "Tautkan akun Telegram",
  telegram_unlink: "Lepas tautan Telegram",
  security: "Kejadian keamanan",
};

