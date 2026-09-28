import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Next.js blocks cross-origin requests to dev-only assets/endpoints by default
   * ("Blocked cross-origin request to Next.js dev resource /_next/hmr").
   *
   * The patient experience is demonstrated from a phone via the machine's LAN
   * address (http://<LAN-IP>:3000/join/<clinicId>), which is a different origin
   * than localhost. Without these entries the phone receives the server-rendered
   * HTML but its client JS is refused, so the page never hydrates: tapping a
   * department does nothing and the name field never appears.
   *
   * Entries are hostnames only — no scheme, no port. The dev server already
   * allows localhost and the hostname it was started with. Development only;
   * this has no effect on a production build.
   */
  allowedDevOrigins: [
    "10.1.14.166", // this workstation's current LAN address
    "10.*.*.*", // typical office/private ranges, so a DHCP change is survivable
    "192.168.*.*",
  ],
};

export default nextConfig;
