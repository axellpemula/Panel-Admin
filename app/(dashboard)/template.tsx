/**
 * Page transition: fade tipis 150ms (opacity saja), tanpa slide besar.
 * `prefers-reduced-motion` dimatikan lewat aturan global di globals.css.
 */
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-fade-in">{children}</div>;
}
