import { ReferenceTabs } from "@/components/reference/ReferenceTabs";

export default function ReferenceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Справочники</h1>
      <ReferenceTabs />
      {children}
    </div>
  );
}
