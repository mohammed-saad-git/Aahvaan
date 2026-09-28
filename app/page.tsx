import Link from "next/link";

import { loadClinicOptions } from "../lib/patient/load.ts";

// The clinic list can change at any time; never cache this page.
export const dynamic = "force-dynamic";

/**
 * Aahvaan landing page.
 *
 * Deliberately minimal: it exists so someone entering the root URL meets the
 * product instead of a framework starter page, and can reach either surface.
 */
export default async function HomePage() {
  const clinics = await loadClinicOptions();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-[0.3em] text-teal-700">
        Aahvaan
      </p>

      <h1 className="mt-5 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
        Real-time patient flow, without the uncertainty.
      </h1>

      <p className="mt-5 max-w-xl text-base leading-7 text-slate-600">
        Patients join a clinic queue from their own phone and wait wherever they
        like. Staff run the queue from a live board. Every change reaches the
        patient&rsquo;s screen within a second, with no refresh.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <section className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Patient
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Scan the QR code at the clinic, or open a clinic below to join its
            queue.
          </p>

          <div className="mt-4 space-y-2">
            {clinics.length === 0 ? (
              <p className="text-sm text-slate-500">
                No clinics are configured yet.
              </p>
            ) : (
              clinics.map((clinic) => (
                <Link
                  key={clinic.id}
                  href={`/join/${clinic.id}`}
                  className="block rounded-xl bg-teal-700 px-4 py-3 text-center text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-800"
                >
                  Join a queue · {clinic.name}
                </Link>
              ))
            )}
          </div>
        </section>

        <section className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Staff
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Run the live queue: call the next patient, start and complete
            consultations, manage no-shows.
          </p>

          <Link
            href="/staff"
            className="mt-4 block rounded-xl bg-slate-900 px-4 py-3 text-center text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800"
          >
            Manage queue
          </Link>
        </section>
      </div>
    </main>
  );
}
