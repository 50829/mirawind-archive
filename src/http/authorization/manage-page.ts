import { applyResponsePolicy } from "../cache/policies";

export function redirectToAdministratorLogin(pathname: string): Response {
  const headers = new Headers({
    Location: `/login?next=${encodeURIComponent(pathname)}`,
  });
  applyResponsePolicy(headers, "manage");
  return new Response(null, { headers, status: 303 });
}

export function hiddenManagementPage(): Response {
  const headers = new Headers({
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  applyResponsePolicy(headers, "hidden-or-missing");
  return new Response("Not found", { headers, status: 404 });
}
