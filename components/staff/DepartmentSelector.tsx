"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import type { StaffDepartmentOption } from "../../lib/staff/queue.ts";

/**
 * Department context for the board.
 *
 * Selection lives in the URL (`/staff?department=<id>`) rather than in component
 * state, so the view is server-rendered, shareable, and survives a refresh.
 */
export function DepartmentSelector({
  departments,
  selectedId,
}: {
  departments: readonly StaffDepartmentOption[];
  selectedId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label
        htmlFor="staff-department"
        className="text-[11px] font-semibold uppercase tracking-wider text-slate-500"
      >
        Department
      </label>

      <select
        id="staff-department"
        value={selectedId}
        disabled={isPending}
        onChange={(event) => {
          const nextDepartmentId = event.target.value;
          startTransition(() => {
            router.push(`/staff?department=${nextDepartmentId}`);
          });
        }}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 disabled:opacity-60"
      >
        {departments.map((department) => (
          <option key={department.id} value={department.id}>
            {department.name} ({department.code})
          </option>
        ))}
      </select>

      {isPending ? (
        <span className="text-xs font-medium text-slate-400">Switching…</span>
      ) : null}
    </div>
  );
}
