/**
 * Penggabung className sederhana (tanpa dependency tambahan).
 * Menerima string, array, atau object kondisional.
 */
type ClassValue =
  | string
  | number
  | false
  | null
  | undefined
  | ClassValue[]
  | Record<string, boolean | undefined | null>;

export function cn(...values: ClassValue[]): string {
  const out: string[] = [];

  const walk = (value: ClassValue): void => {
    if (!value) return;
    if (typeof value === "string" || typeof value === "number") {
      out.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === "object") {
      Object.entries(value).forEach(([key, enabled]) => {
        if (enabled) out.push(key);
      });
    }
  };

  values.forEach(walk);
  return out.join(" ");
}
