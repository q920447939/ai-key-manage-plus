import { redirect } from "next/navigation";

import HomeClient from "@/app/home-client";
import { getServerSession } from "@/lib/auth";

export default async function Page() {
  const session = await getServerSession();
  if (!session) {
    redirect("/login");
  }

  return <HomeClient username={session.username} />;
}
