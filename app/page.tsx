import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth";

/** Entry point: send staff to the panel and everyone else to the portal login. */
export default async function Home() {
  const session = await getStaffSession();
  redirect(session ? "/admin" : "/portal/login");
}
