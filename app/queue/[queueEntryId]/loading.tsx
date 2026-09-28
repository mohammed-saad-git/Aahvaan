import { LoadingBlock } from "../../../components/ui/States";

/**
 * Shown while the patient's queue position and ETA history are being loaded.
 */
export default function Loading() {
  return <LoadingBlock label="Loading your position…" />;
}
