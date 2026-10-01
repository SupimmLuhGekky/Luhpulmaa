import { redirect } from "next/navigation";

/**
 * Return address configured for Flinks Connect. The connection itself is finished from
 * the Connect dialog (it receives the result from Flinks' window), so anyone landing
 * here directly is sent back to the connect screen. Nothing is completed from the URL.
 */
export default function ConnectReturnPage() {
  redirect("/accounts/new?method=connect");
}
