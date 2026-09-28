"use client";

import type { DepartmentSummary } from "../../lib/patient/queue.ts";

/**
 * Department picker. Presentational only — selection state lives in the parent
 * form so there is a single source of truth.
 *
 * The `code` from the database (GOPD, CARD, ...) doubles as the visual chip, so
 * no extra configuration is needed to add a department.
 */
export function DepartmentSelector({
  departments,
  selectedId,
  onSelect,
  disabled = false,
}: {
  departments: readonly DepartmentSummary[];
  selectedId: string | null;
  onSelect: (departmentId: string) => void;
  disabled?: boolean;
}) {
  return (
    <ul className="grid gap-2.5">
      {departments.map((department) => {
        const isSelected = department.id === selectedId;

        return (
          <li key={department.id}>
            <button
              type="button"
              onClick={() => onSelect(department.id)}
              disabled={disabled}
              aria-pressed={isSelected}
              className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3.5 text-left transition-colors disabled:opacity-60 ${
                isSelected
                  ? "border-teal-600 bg-teal-50/70 ring-1 ring-teal-600/20"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[10px] font-semibold tracking-wide ${
                    isSelected
                      ? "bg-teal-700 text-white"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {department.code.slice(0, 4)}
                </span>
                <span className="truncate text-sm font-medium text-slate-900">
                  {department.name}
                </span>
              </span>
              <span
                aria-hidden="true"
                className={`shrink-0 text-xs font-medium ${
                  isSelected ? "text-teal-700" : "text-slate-300"
                }`}
              >
                {isSelected ? "Selected" : "›"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
