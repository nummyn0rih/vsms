import { SettingsTabs } from "@/components/settings/SettingsTabs";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Настройки</h1>
      <SettingsTabs />
      {children}
    </div>
  );
}
