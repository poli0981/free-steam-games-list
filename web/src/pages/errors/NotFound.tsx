import { ErrorPage } from "./ErrorPage";

/** Catch-all route — replaces the old silent redirect-to-home. */
export function NotFoundPage() {
  return <ErrorPage code="404" />;
}
