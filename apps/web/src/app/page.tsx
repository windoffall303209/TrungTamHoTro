import { redirect } from "next/navigation";

/** Chuyển entry route về màn hình đăng nhập. */
export default function Home() {
  redirect("/login");
}
