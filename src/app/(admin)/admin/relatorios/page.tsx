import { SeparationReportView } from "@/components/admin/reports/separation-report-view";
import { requireAdmin } from "@/lib/dal";
import { todayISO } from "@/lib/lots";
import { getSeparationReport } from "@/lib/reports-server";

export const metadata = { title: "Relatórios" };

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

const isISODate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export default async function RelatoriosPage({
  searchParams,
}: PageProps<"/admin/relatorios">) {
  await requireAdmin();

  // `?d=AAAA-MM-DD` permite linkar/direcionar um dia específico; sem isso,
  // abre no dia de hoje.
  const raw = first((await searchParams).d);
  const date = raw && isISODate(raw) ? raw : todayISO();
  const report = await getSeparationReport(date);

  return (
    <SeparationReportView initialDate={date} initialReport={report} />
  );
}
