import { PatientQueueScreen } from "../../../components/patient/PatientQueueScreen";
import { FriendlyMessage } from "../../../components/ui/States";
import { loadPatientQueueSnapshot } from "../../../lib/patient/load.ts";
import { isUuid } from "../../../lib/patient/queue.ts";

// Live queue state: never cache this page.
export const dynamic = "force-dynamic";

interface QueuePageProps {
  params: Promise<{ queueEntryId: string }>;
}

/**
 * The patient's live queue page.
 *
 * The whole snapshot (token, queue, department, clinic, ETA history) is loaded
 * server-side, then kept fresh by a Realtime subscription in PatientQueueScreen.
 */
export default async function QueuePage({ params }: QueuePageProps) {
  const { queueEntryId } = await params;

  if (!isUuid(queueEntryId)) {
    return (
      <FriendlyMessage
        title="We couldn't find your queue entry"
        body="Please scan the clinic's QR code again to join the queue."
      />
    );
  }

  const snapshot = await loadPatientQueueSnapshot(queueEntryId);

  if (!snapshot) {
    return (
      <FriendlyMessage
        title="We couldn't find your queue entry"
        body="This link may have expired or the entry was removed. Please scan the clinic's QR code again to rejoin."
      />
    );
  }

  return <PatientQueueScreen initialSnapshot={snapshot} />;
}
