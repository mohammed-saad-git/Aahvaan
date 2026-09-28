import { Suspense } from "react";

import { PatientJoinForm } from "../../../components/patient/PatientJoinForm";
import {
  FriendlyMessage,
  LoadingBlock,
} from "../../../components/patient/States";
import {
  loadActiveDepartments,
  loadClinicSummary,
} from "../../../lib/patient/load.ts";
import { isUuid } from "../../../lib/patient/queue.ts";

// Queue membership changes constantly: never cache this page.
export const dynamic = "force-dynamic";

interface JoinPageProps {
  params: Promise<{ clinicId: string }>;
}

/**
 * Patient entry point (the QR destination: /join/<clinicId>).
 *
 * The clinic and its departments are loaded server-side because the anonymous
 * role cannot read `clinics` or `departments` — see lib/patient/load.ts.
 */
export default async function JoinPage({ params }: JoinPageProps) {
  const { clinicId } = await params;

  // Validate before touching the database, so a malformed link never produces a
  // raw Postgres error.
  if (!isUuid(clinicId)) {
    return (
      <FriendlyMessage
        title="Clinic not found"
        body="This queue link looks incomplete. Please scan the clinic's QR code again."
      />
    );
  }

  const clinic = await loadClinicSummary(clinicId);

  if (!clinic) {
    return (
      <FriendlyMessage
        title="Clinic not found"
        body="We couldn't find this clinic. Please scan the QR code at the clinic entrance."
      />
    );
  }

  return (
    <main className="mx-auto w-full max-w-md px-5 pb-16 pt-8">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-700">
          {clinic.name}
        </p>
        {clinic.address ? (
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {clinic.address}
          </p>
        ) : null}

        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-slate-900">
          How can we help you today?
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Join the queue from your phone and wait wherever you like.
        </p>
      </header>

      <div className="mt-7">
        <Suspense fallback={<LoadingBlock label="Loading departments…" />}>
          <DepartmentsSection clinicId={clinicId} />
        </Suspense>
      </div>
    </main>
  );
}

async function DepartmentsSection({ clinicId }: { clinicId: string }) {
  const departments = await loadActiveDepartments(clinicId);

  if (departments.length === 0) {
    return (
      <FriendlyMessage
        title="No departments are currently available."
        body="Please ask at the reception desk — a member of staff can help you join."
      />
    );
  }

  return <PatientJoinForm clinicId={clinicId} departments={departments} />;
}
