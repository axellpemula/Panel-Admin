import {
  Boxes,
  History,
  KeyRound,
  LayoutDashboard,
  Plus,
  ScrollText,
  ShieldAlert,
  Timer,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Menu ini hanya muncul untuk role yang tercantum. */
  roles: ("owner" | "reseller")[];
}

/** Menu sidebar — urutan & icon sesuai spesifikasi. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["owner", "reseller"] },
  { href: "/tools", label: "Tool Management", icon: Boxes, roles: ["owner"] },
  { href: "/durations", label: "Duration Setting", icon: Timer, roles: ["owner"] },
  { href: "/keys", label: "Key List", icon: KeyRound, roles: ["owner", "reseller"] },
  { href: "/generate", label: "Generate Key", icon: Plus, roles: ["owner", "reseller"] },
  { href: "/resellers", label: "Reseller", icon: Users, roles: ["owner"] },
  { href: "/credits", label: "Credit Log", icon: ScrollText, roles: ["owner", "reseller"] },
  { href: "/audit", label: "Audit Log", icon: History, roles: ["owner"] },
  { href: "/validation-attempts", label: "Validation Attempts", icon: ShieldAlert, roles: ["owner"] },
];

export function navItemsFor(role: "owner" | "reseller"): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
