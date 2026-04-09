import { redirect } from "next/navigation";

import LoginClient from "@/app/login/login-client";
import { getServerSession } from "@/lib/auth";

export default async function LoginPage() {
  const session = await getServerSession();
  if (session) {
    redirect("/");
  }

  return <LoginClient />;
}
