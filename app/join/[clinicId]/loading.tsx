import { LoadingBlock } from "../../../components/ui/States";

/**
 * Shown while the clinic and its departments are being loaded, so the patient
 * never sees a blank screen.
 */
export default function Loading() {
  return <LoadingBlock label="Loading clinic…" />;
}
