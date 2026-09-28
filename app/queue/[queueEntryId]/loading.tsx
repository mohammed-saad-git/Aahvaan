import { LoadingBlock } from "../../../components/patient/States";

/**
 * Shown while the patient's queue position and ETA history are being loaded.
 */
export default function Loading() {
  return <LoadingBlock label="Loading your position…" />;
}
