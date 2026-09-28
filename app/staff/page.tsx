import { CallNextPanel } from "../../components/staff/CallNextPanel";
import { CurrentPatientCard } from "../../components/staff/CurrentPatientCard";
import { DepartmentSelector } from "../../components/staff/DepartmentSelector";
import { StaffConnectionStatus } from "../../components/staff/StaffConnectionStatus";
import { StaffHeader, StatCards } from "../../components/staff/StaffHeader";
import { WaitingQueueList } from "../../components/staff/WaitingQueueList";
import { FriendlyMessage } from "../../components/ui/States";
import { loadStaffDashboard } from "../../lib/staff/load.ts";
import { buildStaffDashboardView } from "../../lib/staff/queue.ts";
import { isUuid } from "../../lib/validation.ts";

// Live queue board: never cache.
export const dynamic = "force-dynamic";

interface StaffPageProps {
  searchParams: Promise<{ department?: string }>;
}

/**
 * Staff queue board.
 *
 * The whole board is loaded server-side with the privileged client (staff may see
 * a department's full queue, which the anonymous role deliberately cannot). The
 * department lives in the URL so the view is shareable and survives a refresh.
 */
export default async function StaffPage({ searchParams }: StaffPageProps) {
  const { department } = await searchParams;
  const requestedDepartmentId = isUuid(department) ? department : null;

  const data = await loadStaffDashboard(requestedDepartmentId);

  if (!data) {
    return (
      <FriendlyMessage
        title="Staff dashboard needs a clinic"
        body="No active clinic with departments was found. Apply the demo seed (supabase/seed.sql) and reload."
      />
    );
  }

  const view = buildStaffDashboardView(data.entries);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 lg:px-8">
      <StaffHeader clinicName={data.clinic.name}>
        <StaffConnectionStatus departmentId={data.selectedDepartment.id} />
      </StaffHeader>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <DepartmentSelector
          departments={data.departments}
          selectedId={data.selectedDepartment.id}
        />
        {data.usedFallbackDepartment ? (
          <p className="text-xs font-medium text-amber-700">
            That department was unavailable — showing{" "}
            {data.selectedDepartment.name}.
          </p>
        ) : null}
      </div>

      <div className="mt-6">
        <StatCards stats={view.stats} />
      </div>

      {/* Hierarchy: current patient, then Call next, then the queue. */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="lg:col-start-1 lg:row-start-1">
          <CurrentPatientCard entry={view.currentPatient} />
        </div>

        <aside className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <CallNextPanel
            departmentId={data.selectedDepartment.id}
            waitingCount={view.stats.waiting}
          />
        </aside>

        <div className="lg:col-start-1 lg:row-start-2">
          <WaitingQueueList entries={view.waitingQueue} />
        </div>
      </div>

      <p className="mt-8 text-xs text-slate-400">
        Board day: {data.tokenDate ?? "no queue yet"} ·{" "}
        {view.stats.noShowToday} no-show
        {view.stats.noShowToday === 1 ? "" : "s"} today
      </p>
    </main>
  );
}
