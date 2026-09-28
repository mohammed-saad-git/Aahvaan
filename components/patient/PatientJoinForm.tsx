"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { joinQueueAction } from "../../lib/patient/actions.ts";
import {
  PATIENT_LANGUAGE_OPTIONS,
  type DepartmentSummary,
} from "../../lib/patient/queue.ts";
import { DepartmentSelector } from "./DepartmentSelector";

const inputClassName =
  "mt-1.5 block w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20";

/**
 * The whole patient entry experience: choose a department, enter a name, join.
 *
 * The token is issued by the database (see joinQueueAction); afterwards the
 * patient is redirected to a bookmarkable /queue/<id> page.
 */
export function PatientJoinForm({
  clinicId,
  departments,
}: {
  clinicId: string;
  departments: readonly DepartmentSummary[];
}) {
  const router = useRouter();
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<
    string | null
  >(departments.length === 1 ? departments[0].id : null);
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState<string>("en");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedDepartment =
    departments.find(
      (department) => department.id === selectedDepartmentId,
    ) ?? null;

  const canSubmit =
    selectedDepartment !== null && displayName.trim().length > 0 && !isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedDepartment) {
      setErrorMessage("Please choose a department first.");
      return;
    }

    setErrorMessage(null);

    startTransition(async () => {
      const result = await joinQueueAction({
        clinicId,
        departmentId: selectedDepartment.id,
        // Trimmed here as well as server-side (sanitizeDisplayName collapses
        // whitespace), so the enabled/disabled state and the stored value agree.
        displayName: displayName.trim(),
        phone,
        language,
      });

      if (result.ok) {
        router.push(`/queue/${result.queueEntryId}`);
        return;
      }

      setErrorMessage(result.message);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-7" noValidate>
      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Choose a department
        </h2>
        <div className="mt-3">
          <DepartmentSelector
            departments={departments}
            selectedId={selectedDepartmentId}
            onSelect={setSelectedDepartmentId}
            disabled={isPending}
          />
        </div>
      </section>

      {/*
        Always visible, whether or not a department has been chosen yet. Hiding
        this behind the department selection made the page instruct patients to
        "enter your name" while showing no name field at all.
      */}
      <section className="space-y-4">
        {selectedDepartment ? (
          <p className="text-sm font-medium text-slate-600">
            You’re joining{" "}
            <span className="font-semibold text-slate-900">
              {selectedDepartment.name}
            </span>
          </p>
        ) : (
          <p className="text-sm text-slate-500">
            Pick the department you need to see, then enter your name.
          </p>
        )}

        <div>
          <label
            htmlFor="patient-name"
            className="block text-sm font-medium text-slate-700"
          >
            Your name
          </label>
          <input
            id="patient-name"
            name="name"
            type="text"
            required
            autoComplete="name"
            maxLength={80}
            placeholder="Enter your name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            disabled={isPending}
            className={inputClassName}
          />
        </div>

        <div>
          <label
            htmlFor="patient-phone"
            className="block text-sm font-medium text-slate-700"
          >
            Phone number{" "}
            <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id="patient-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={20}
            placeholder="+91 90000 00000"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            disabled={isPending}
            className={inputClassName}
          />
        </div>

        <div>
          <label
            htmlFor="patient-language"
            className="block text-sm font-medium text-slate-700"
          >
            Preferred language
          </label>
          <select
            id="patient-language"
            name="language"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            disabled={isPending}
            className={inputClassName}
          >
            {PATIENT_LANGUAGE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      {errorMessage ? (
        <p
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-800"
        >
          {errorMessage}
        </p>
      ) : null}

      <div className="space-y-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-xl bg-teal-700 px-4 py-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-800 focus:ring-2 focus:ring-teal-600/40 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isPending ? "Joining queue…" : "Join Queue"}
        </button>
        <p className="text-center text-xs leading-5 text-slate-500">
          No account needed. You’ll get a token and a live position, and you can
          wait anywhere nearby.
        </p>
      </div>
    </form>
  );
}
