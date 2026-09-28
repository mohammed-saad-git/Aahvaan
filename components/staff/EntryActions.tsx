"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { formatTokenNumber } from "../../lib/format.ts";
import { staffTransitionAction } from "../../lib/staff/actions.ts";
import {
  formatConfirmation,
  getPrimaryStaffAction,
  getStaffActions,
  type StaffActionDescriptor,
} from "../../lib/staff/queue.ts";
import type { QueueStatus } from "../../lib/types.ts";
import { ACTION_BUTTON_BASE, ACTION_TONE_CLASS } from "./staffTone";

/**
 * The action buttons for one patient.
 *
 * Which buttons exist comes from `getStaffActions()` in lib/staff/queue.ts, which
 * is validated against the shared state machine by unit tests — so an illegal
 * action can never be offered. Disruptive actions (no-show, requeue) swap the row
 * for an explicit Cancel / Confirm step so they cannot fire from a stray click.
 */
export function EntryActions({
  entryId,
  tokenNumber,
  status,
  variant = "row",
}: {
  entryId: string;
  tokenNumber: number;
  status: QueueStatus;
  variant?: "row" | "primary";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [confirmation, setConfirmation] =
    useState<StaffActionDescriptor | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const tokenLabel = formatTokenNumber(tokenNumber);
  const actions = getStaffActions(status);

  if (actions.length === 0) {
    return null;
  }

  const primaryAction = getPrimaryStaffAction(status);
  const secondaryActions = actions.filter(
    (action) => action.action !== primaryAction?.action,
  );

  function execute(descriptor: StaffActionDescriptor) {
    setConfirmation(null);
    setErrorMessage(null);
    setPendingAction(descriptor.action);

    startTransition(async () => {
      const result = await staffTransitionAction({
        entryId,
        action: descriptor.action,
      });
      setPendingAction(null);

      if (!result.ok) {
        setErrorMessage(
          result.message ?? "Something went wrong. Please try again.",
        );
        return;
      }

      // Server-rendered board: re-fetch the authoritative state.
      router.refresh();
    });
  }

  function request(descriptor: StaffActionDescriptor) {
    setErrorMessage(null);

    if (descriptor.confirmMessage) {
      setConfirmation(descriptor);
      return;
    }

    execute(descriptor);
  }

  if (confirmation) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold text-slate-800">
          {formatConfirmation(
            confirmation.confirmMessage ?? "",
            tokenLabel,
          )}
        </p>
        <button
          type="button"
          onClick={() => setConfirmation(null)}
          disabled={isPending}
          className={`${ACTION_BUTTON_BASE} ${ACTION_TONE_CLASS.neutral}`}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => execute(confirmation)}
          disabled={isPending}
          className={`${ACTION_BUTTON_BASE} ${ACTION_TONE_CLASS.dangerSolid}`}
        >
          {isPending ? "Working…" : "Confirm"}
        </button>
      </div>
    );
  }

  const primaryButton = primaryAction ? (
    <button
      type="button"
      onClick={() => request(primaryAction)}
      disabled={isPending}
      className={`${ACTION_BUTTON_BASE} ${ACTION_TONE_CLASS.primary} ${
        variant === "primary" ? "w-full px-5 py-3.5 text-base" : ""
      }`}
    >
      {pendingAction === primaryAction.action
        ? "Working…"
        : primaryAction.label}
    </button>
  ) : null;

  const secondaryButtons = secondaryActions.map((descriptor) => (
    <button
      key={descriptor.action}
      type="button"
      onClick={() => request(descriptor)}
      disabled={isPending}
      className={`${ACTION_BUTTON_BASE} ${ACTION_TONE_CLASS[descriptor.tone]}`}
    >
      {pendingAction === descriptor.action ? "Working…" : descriptor.label}
    </button>
  ));

  return (
    <div className={variant === "primary" ? "space-y-3" : "flex flex-col gap-2"}>
      {variant === "primary" ? (
        <>
          {primaryButton}
          <div className="flex flex-wrap gap-2">{secondaryButtons}</div>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {secondaryButtons}
          {primaryButton}
        </div>
      )}

      {errorMessage ? (
        <p role="alert" className="text-xs font-semibold text-rose-700">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
